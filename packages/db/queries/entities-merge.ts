import { sql } from "drizzle-orm";
import { db } from "../client";

/**
 * POST /entities/merge helper (backend-gaps wave).
 *
 * Remaps every durable reference from `duplicateId` onto `primaryId`, unions
 * aliases, folds mention statistics, then deletes the duplicate row — all in
 * ONE transaction. Tables remapped:
 *   memory_entities · facts.subject_id + facts.object_id ·
 *   open_loops.entity_id · entity_edges (both endpoints)
 *
 * entity_edges is DERIVED-OF-DERIVED (rebuilt nightly by consolidation, see
 * materializeEntityEdges) and carries a unique natural key
 * (user, a_id, b_id, rel_type) with normalized a < b. Rather than risk
 * unique-violations remapping both endpoints, edges touching the duplicate are
 * DELETED; the nightly rebuild regenerates the merged edges from the already-
 * remapped facts. Flags on primary-side edges are preserved untouched; flags
 * on duplicate-side links are dropped (the merge itself asserts they were the
 * same person). The primary's consolidated profile/profile_embedding is left
 * stale on purpose — tonight's rebuild refreshes it.
 */

const asRows = (rows: unknown): Array<Record<string, unknown>> =>
  rows as unknown as Array<Record<string, unknown>>;

export interface MergeEntitiesResult {
  primary: {
    id: string;
    type: string;
    canonicalName: string;
    aliases: string[];
    mentionCount: number;
    firstSeen: string | null;
    lastSeen: string | null;
  };
  remapped: {
    memoryEntities: number;
    factsAsSubject: number;
    factsAsObject: number;
    openLoops: number;
    edgesDeleted: number;
  };
}

/**
 * Merge `duplicateId` into `primaryId`. Returns null when either id is not an
 * owned entity of this user or both ids are identical.
 */
export async function mergeEntities(
  userId: string,
  primaryId: string,
  duplicateId: string,
): Promise<MergeEntitiesResult | null> {
  if (primaryId === duplicateId) return null;

  return db.transaction(async (tx) => {
    // Lock both rows and verify ownership.
    const owned = asRows(
      await tx.execute(sql`
        SELECT id, type, canonical_name, aliases, mention_count,
               first_seen, last_seen
        FROM entities
        WHERE user_id = ${userId}
          AND id IN (${primaryId}::uuid, ${duplicateId}::uuid)
        FOR UPDATE
      `),
    );
    if (owned.length !== 2) return null;

    const primary = owned.find((r) => String(r.id) === primaryId)!;
    const dup = owned.find((r) => String(r.id) === duplicateId)!;

    // memory_entities: drop rows that would collide with primary's existing
    // mention edge for the same memory, then move the rest.
    await tx.execute(sql`
      DELETE FROM memory_entities me
       WHERE me.entity_id = ${duplicateId}::uuid
         AND EXISTS (
           SELECT 1 FROM memory_entities keep
            WHERE keep.memory_id = me.memory_id
              AND keep.entity_id = ${primaryId}::uuid
         )
    `);
    const movedMentions = asRows(
      await tx.execute(sql`
        WITH moved AS (
          UPDATE memory_entities SET entity_id = ${primaryId}::uuid
           WHERE entity_id = ${duplicateId}::uuid
          RETURNING 1
        )
        SELECT count(*)::int AS n FROM moved
      `),
    )[0]!.n as number;

    const movedSubject = asRows(
      await tx.execute(sql`
        WITH moved AS (
          UPDATE facts SET subject_id = ${primaryId}::uuid
           WHERE user_id = ${userId} AND subject_id = ${duplicateId}::uuid
          RETURNING 1
        ) SELECT count(*)::int AS n FROM moved
      `),
    )[0]!.n as number;

    const movedObject = asRows(
      await tx.execute(sql`
        WITH moved AS (
          UPDATE facts SET object_id = ${primaryId}::uuid
           WHERE user_id = ${userId} AND object_id = ${duplicateId}::uuid
          RETURNING 1
        ) SELECT count(*)::int AS n FROM moved
      `),
    )[0]!.n as number;

    const movedLoops = asRows(
      await tx.execute(sql`
        WITH moved AS (
          UPDATE open_loops SET entity_id = ${primaryId}::uuid
           WHERE user_id = ${userId} AND entity_id = ${duplicateId}::uuid
          RETURNING 1
        ) SELECT count(*)::int AS n FROM moved
      `),
    )[0]!.n as number;

    // See header: derived edges touching the duplicate are dropped; the
    // nightly rebuild re-derives merged edges from the remapped facts.
    const deletedEdges = asRows(
      await tx.execute(sql`
        WITH deleted AS (
          DELETE FROM entity_edges
           WHERE user_id = ${userId}
             AND (${duplicateId}::uuid IN (a_id, b_id))
          RETURNING 1
        ) SELECT count(*)::int AS n FROM deleted
      `),
    )[0]!.n as number;

    // Union aliases, fold mention stats, extend the observed lifetime.
    const dupAliases = (dup.aliases as string[] | null) ?? [];
    const primaryAliases = (primary.aliases as string[] | null) ?? [];
    const unionAliases = Array.from(new Set([...primaryAliases, ...dupAliases]));

    await tx.execute(sql`
      UPDATE entities
      SET aliases = ${unionAliases},
          mention_count = mention_count + ${Number(dup.mention_count ?? 0)}::int,
          first_seen = LEAST(first_seen, ${dup.first_seen ?? null}::timestamptz),
          last_seen = GREATEST(last_seen, ${dup.last_seen ?? null}::timestamptz)
      WHERE id = ${primaryId}::uuid AND user_id = ${userId}
    `);

    await tx.execute(sql`
      DELETE FROM entities
       WHERE id = ${duplicateId}::uuid AND user_id = ${userId}
    `);

    const [fresh] = asRows(
      await tx.execute(sql`
        SELECT id, type, canonical_name, aliases, mention_count,
               first_seen, last_seen
        FROM entities WHERE id = ${primaryId}::uuid
      `),
    );

    return {
      primary: {
        id: String(fresh!.id),
        type: String(fresh!.type),
        canonicalName: String(fresh!.canonical_name),
        aliases: ((fresh!.aliases as string[] | null) ?? []) as string[],
        mentionCount: Number(fresh!.mention_count ?? 0),
        firstSeen: fresh!.first_seen
          ? new Date(fresh!.first_seen as string).toISOString()
          : null,
        lastSeen: fresh!.last_seen
          ? new Date(fresh!.last_seen as string).toISOString()
          : null,
      },
      remapped: {
        memoryEntities: Number(movedMentions ?? 0),
        factsAsSubject: Number(movedSubject ?? 0),
        factsAsObject: Number(movedObject ?? 0),
        openLoops: Number(movedLoops ?? 0),
        edgesDeleted: Number(deletedEdges ?? 0),
      },
    };
  });
}
