import { db, openLoops, eq, and, inArray, sql, toVectorLiteral } from "@repo/db";
import type { Extraction } from "./extraction";
import { resolveEntity, type EntityResolution } from "./linking";
import { parseDate } from "./temporal";

/**
 * Open loops (spec 02 §2, spec 03 P4, spec 04 §3.1) — the unfinished threads a
 * memory opens ("equity split with Rahul is unresolved") and the later memory
 * that closes one. Loops drive proactive check-ins, so a wrong resolution here
 * silences the system; the thresholds below are deliberately conservative.
 */

// A resolution changes lifecycle state, so it has a considerably stricter gate
// than ordinary retrieval. This is cosine distance (lower is closer).
export const LOOP_RESOLUTION_MAX_DISTANCE = 0.12;

/**
 * Commitment loops are self-scoped (spec 02 §2.3) — "I'm done with consulting"
 * names no entity — so the entity-scoped resolution path (below) can never
 * close them. Held-intention resolution (spec 03 P4) instead matches an open
 * COMMITMENT loop by embedding proximity alone, with a threshold that is looser
 * than the entity path but still conservative. This is a SAFE direction to err:
 * a false resolution only makes the system go quiet on a commitment (the side
 * spec 01 §2 chose), and it only runs when extraction explicitly flagged
 * `resolvesLoop` — never on a passing mention.
 */
export const COMMITMENT_RESOLUTION_MAX_DISTANCE = 0.35;

/**
 * Resolve an existing loop only when extraction explicitly flagged `resolvesLoop`.
 * Two paths:
 *  - Entity-scoped (any kind): requires an entity link AND a very close semantic
 *    match (LOOP_RESOLUTION_MAX_DISTANCE). Requiring both is intentional — for
 *    entity-attached loops a false resolution is worse than silence.
 *  - Commitment (held intentions, spec 03 P4): self-scoped, so it matches the
 *    closest OPEN commitment loop by embedding alone under a conservative
 *    threshold, no entity required. Erring toward resolution here only makes the
 *    system quieter (the side spec 01 §2 chose), and it still fires only on an
 *    explicit `resolvesLoop` signal — never a passing mention.
 */
export async function resolveOpenLoop(params: {
  userId: string;
  memoryId: string;
  resolvesLoop: Extraction["resolvesLoop"];
  resolution: EntityResolution;
  extractedEntities: Extraction["entities"];
  embedding: number[];
}): Promise<string | null> {
  const { userId, memoryId, resolvesLoop, resolution, extractedEntities, embedding } = params;
  if (!resolvesLoop?.trim() || !embedding.length) return null;

  const entityIds = [...new Set(
    extractedEntities
      .map((entity) => resolveEntity(entity.surface, resolution))
      .filter((id): id is string => id !== null),
  )];
  // NB: no early return on empty entityIds — commitment loops (Path 2 below)
  // are self-scoped and resolve without any entity link (spec 03 P4).

  // Drizzle cannot bind a JavaScript number[] as a pgvector parameter. Keep
  // vector serialization in @repo/db alongside every other vector query.
  const vector = toVectorLiteral(embedding);
  const distance = sql<number>`(${openLoops.embedding} <=> ${vector}::vector)`;

  // Path 1 — entity-scoped, strict (any kind that names an entity). Unchanged.
  if (entityIds.length) {
    const [candidate] = await db
      .select({ id: openLoops.id, distance })
      .from(openLoops)
      .where(
        and(
          eq(openLoops.userId, userId),
          eq(openLoops.status, "open"),
          inArray(openLoops.entityId, entityIds),
        ),
      )
      .orderBy(distance)
      .limit(1);

    if (candidate && candidate.distance <= LOOP_RESOLUTION_MAX_DISTANCE) {
      await db
        .update(openLoops)
        .set({ status: "resolved", resolvedBy: memoryId })
        .where(and(eq(openLoops.id, candidate.id), eq(openLoops.status, "open")));
      return candidate.id;
    }
  }

  // Path 2 — self-scoped resolution for commitments AND threads (spec 03 P4,
  // spec 04 §3.1). Commitment loops are self-scoped (usually no entity); a
  // `thread` may be self-scoped too (an exam names no entity). Both close when
  // a later memory that extraction flagged `resolvesLoop` matches the closest
  // OPEN loop of these kinds by embedding alone, under a conservative threshold,
  // no entity requirement. This is how "went well, done with it" (2.1) or "it's
  // a deliberate call" (P4), captured as a memory, closes the loop so its
  // check-in never fires again. Entity-scoped threads are handled by Path 1.
  const [selfScoped] = await db
    .select({ id: openLoops.id, distance })
    .from(openLoops)
    .where(
      and(
        eq(openLoops.userId, userId),
        eq(openLoops.status, "open"),
        inArray(openLoops.kind, ["commitment", "thread"]),
      ),
    )
    .orderBy(distance)
    .limit(1);

  if (selfScoped && selfScoped.distance <= COMMITMENT_RESOLUTION_MAX_DISTANCE) {
    await db
      .update(openLoops)
      .set({ status: "resolved", resolvedBy: memoryId })
      .where(and(eq(openLoops.id, selfScoped.id), eq(openLoops.status, "open")));
    return selfScoped.id;
  }

  return null;
}

/** Upsert every loop derived from a source memory. Retry-safe by source + shape. */
export async function upsertOpenLoops(params: {
  userId: string;
  memoryId: string;
  loops: Extraction["openLoops"];
  resolution: EntityResolution;
  embeddings: number[][];
}): Promise<void> {
  const { userId, memoryId, loops, resolution, embeddings } = params;
  for (let i = 0; i < loops.length; i++) {
    const loop = loops[i]!;
    const title = loop.title.trim();
    if (!title) continue;
    const entityId = loop.entityRef ? resolveEntity(loop.entityRef, resolution) : null;
    const [existing] = await db
      .select({ id: openLoops.id })
      .from(openLoops)
      .where(
        and(
          eq(openLoops.userId, userId),
          eq(openLoops.sourceMemory, memoryId),
          eq(openLoops.kind, loop.kind),
          eq(openLoops.title, title),
        ),
      )
      .limit(1);
    if (existing) continue;

    const embedding = embeddings[i] ?? [];
    await db.insert(openLoops).values({
      userId,
      kind: loop.kind,
      title,
      entityId,
      dueAt: parseDate(loop.dueAt),
      sourceMemory: memoryId,
      embedding: embedding.length ? embedding : null,
    });
  }
}
