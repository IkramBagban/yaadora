import { generateObject } from "ai";
import { z } from "zod";
import {
  db,
  entities,
  memoryEntities,
  findEntityCandidates,
  sql,
  eq,
} from "@repo/db";
import { ingestionModel } from "../ai/models";
import type { Extraction } from "./extraction";

/**
 * Entity extraction + LINKING (spec 02 §2.3) — the accuracy backbone.
 *
 * The LLM gives candidate mentions; linking is the deterministic step that
 * collapses "40 fragments about Urhan" into one entity node:
 *  1. Candidate lookup by alias/canonical_name + embedding similarity (in @repo/db).
 *  2. Resolve: confident match → link; ambiguous → tiny disambiguation LLM call;
 *     no match → create.
 *  3. Upsert memory_entities edge; bump mention_count / last_seen / aliases.
 */

/** Cosine-distance threshold under which a single vector candidate is a
 * confident auto-link. Entities are embedded from their name for now, so close
 * names cluster tightly. Conservative on purpose.
 *
 * EXPORTED so the turn-time entity linker (retrieval/entity-linker.ts, spec 02
 * §5.2) resolves against the SAME thresholds — the read and write paths must not
 * drift. Do not duplicate these numbers anywhere else. */
export const LINK_DISTANCE_THRESHOLD = 0.15;
/** Distance under which multiple candidates are "ambiguous" → disambiguation. */
export const AMBIGUOUS_DISTANCE_THRESHOLD = 0.3;

/**
 * The minimal candidate shape the shared linking decision needs — a subset of
 * `EntityCandidate` (@repo/db). `nameMatch` = exact canonical/alias hit;
 * `distance` = cosine distance to the query embedding (lower = closer, null when
 * unknown).
 */
export interface LinkCandidate {
  id: string;
  distance: number | null;
  nameMatch: boolean;
}

/**
 * The resolution decision shared by ingestion linking and the turn-time linker
 * (spec 02 §2.3 / §5.2). Kept as data (not an entity id) so each path applies
 * its own policy:
 *  - ingestion: `matched` → link, `ambiguous` → tiny disambiguation LLM call,
 *    `none` → create a new entity.
 *  - turn-time (read path): `matched` (confident) → link; `ambiguous`/`none` →
 *    NO link. A wrong link on the read path shows the user someone else's
 *    context, so silence beats a guess.
 */
export type LinkDecision =
  | { kind: "matched"; entityId: string; via: "exact" | "embedding" }
  | { kind: "ambiguous"; candidateIds: string[] }
  | { kind: "none" };

/**
 * Decide, from a candidate set, which existing entity a mention resolves to —
 * the single source of truth for the alias/lexical-then-embedding thresholds
 * (spec 02 §2.3). Exactly ONE exact name/alias match auto-links; a single
 * embedding candidate under `LINK_DISTANCE_THRESHOLD` auto-links; multiple exact
 * matches or multiple near candidates are `ambiguous`; nothing near is `none`.
 *
 * Candidates are expected in `findEntityCandidates` order (name_match DESC,
 * distance ASC) but the decision does not rely on it beyond exact-match counting.
 */
export function decideEntityLink(candidates: LinkCandidate[]): LinkDecision {
  const exacts = candidates.filter((c) => c.nameMatch);
  if (exacts.length === 1) {
    return { kind: "matched", entityId: exacts[0]!.id, via: "exact" };
  }
  if (exacts.length > 1) {
    // Same name, several entities (e.g. two people called "Urhan") — never
    // guess. Ingestion disambiguates with context; the read path stays silent.
    return { kind: "ambiguous", candidateIds: exacts.map((c) => c.id) };
  }

  const near = candidates.filter(
    (c) => c.distance != null && c.distance <= AMBIGUOUS_DISTANCE_THRESHOLD,
  );
  const confident = near.filter(
    (c) => c.distance != null && c.distance <= LINK_DISTANCE_THRESHOLD,
  );
  if (confident.length === 1) {
    return { kind: "matched", entityId: confident[0]!.id, via: "embedding" };
  }
  if (near.length > 1 || confident.length > 1) {
    return { kind: "ambiguous", candidateIds: near.map((c) => c.id) };
  }
  return { kind: "none" };
}

export interface MentionInput {
  surface: string;
  type: Extraction["entities"][number]["type"];
  canonicalGuess: string;
  /** name embedding for similarity lookup + new-entity profile seeding */
  embedding: number[];
}

/** Maps a mention (by lowercased surface AND canonicalGuess) to a resolved
 * entity id, so fact subject/object surfaces can be resolved to graph nodes. */
export type EntityResolution = Map<string, string>;

const DisambiguationSchema = z.object({
  // id of the chosen existing entity, or null to create a new one.
  entityId: z.string().nullable(),
});

async function disambiguate(
  memoryText: string,
  mention: MentionInput,
  candidates: { id: string; canonicalName: string; profile: string | null }[],
): Promise<string | null> {
  try {
    const { object } = await generateObject({
      model: ingestionModel, // tiny, rare call — keep it on the cheap tier (cost discipline)
      schema: DisambiguationSchema,
      system:
        "Pick which existing entity a mention refers to, or decide it is new. " +
        "Return a JSON object {\"entityId\": \"...\"} with the exact entityId of the best match, " +
        "or {\"entityId\": null} if none matches. Never return bare null.",
      prompt: `Memory context:
"""
${memoryText}
"""
Mention: "${mention.surface}" (type: ${mention.type})

Candidate entities:
${candidates
  .map(
    (c, i) =>
      `${i + 1}. id=${c.id} name="${c.canonicalName}" profile=${c.profile ?? "(none)"}`,
  )
  .join("\n")}

Which entityId does the mention refer to? null if it is a new/different entity.`,
      experimental_repairText: async ({ text }) => {
        const t = text.trim();
        if (t === "null" || t === "") return '{"entityId":null}';
        const fenced = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
        return (fenced?.[1] ?? t).trim();
      },
    });
    // Guard: only accept an id that was actually offered.
    if (object.entityId && candidates.some((c) => c.id === object.entityId)) {
      return object.entityId;
    }
    return null;
  } catch {
    // Proxy models sometimes return bare null / invalid JSON. Safer default:
    // treat as no match and create a new entity rather than failing ingestion.
    return null;
  }
}

async function createEntity(
  userId: string,
  mention: MentionInput,
  seenAt: Date | null,
): Promise<string> {
  const aliases =
    mention.surface.toLowerCase() === mention.canonicalGuess.toLowerCase()
      ? [mention.surface]
      : [mention.surface, mention.canonicalGuess];
  const [row] = await db
    .insert(entities)
    .values({
      userId,
      type: mention.type,
      canonicalName: mention.canonicalGuess,
      aliases,
      // Seed profile_embedding from the name so similarity lookup works before
      // consolidation rebuilds real profiles (spec 02 §2.6 / §5.1). Guard against
      // an empty vector (must be 1536-d or null).
      profileEmbedding: mention.embedding.length ? mention.embedding : null,
      firstSeen: seenAt,
      lastSeen: seenAt,
      mentionCount: 1,
    })
    .returning({ id: entities.id });
  return row!.id;
}

async function touchEntity(
  entityId: string,
  surface: string,
  seenAt: Date | null,
): Promise<void> {
  const seenAtStr = seenAt ? seenAt.toISOString() : null;
  // Bump mention_count, advance last_seen, extend aliases with the new surface.
  await db
    .update(entities)
    .set({
      mentionCount: sql`${entities.mentionCount} + 1`,
      lastSeen: sql`GREATEST(${entities.lastSeen}, ${seenAtStr}::timestamptz)`,
      aliases: sql`(
        SELECT array_agg(DISTINCT x) FROM unnest(${entities.aliases} || ARRAY[${surface}]::text[]) x
      )`,
      firstSeen: sql`LEAST(${entities.firstSeen}, ${seenAtStr}::timestamptz)`,
    })
    .where(eq(entities.id, entityId));
}

async function upsertEdge(memoryId: string, entityId: string): Promise<void> {
  await db
    .insert(memoryEntities)
    .values({ memoryId, entityId })
    .onConflictDoNothing();
}

/**
 * Link all extracted mentions for one memory. Returns a resolution map from
 * mention surface/canonicalGuess (lowercased) → entity id.
 */
export async function linkEntities(params: {
  userId: string;
  memoryId: string;
  mentions: MentionInput[];
  occurredAt: Date | null;
  memoryText: string;
}): Promise<EntityResolution> {
  const { userId, memoryId, mentions, occurredAt, memoryText } = params;
  const resolution: EntityResolution = new Map();

  for (const mention of mentions) {
    const candidates = await findEntityCandidates({
      userId,
      type: mention.type,
      nameGuess: mention.canonicalGuess,
      embedding: mention.embedding,
      limit: 5,
    });

    let entityId: string | null = null;

    // Shared alias/lexical-then-embedding decision (spec 02 §2.3) — the SAME
    // thresholds the turn-time linker uses, so the two paths cannot drift.
    const decision = decideEntityLink(candidates);
    if (decision.kind === "matched") {
      entityId = decision.entityId;
    } else if (decision.kind === "ambiguous") {
      // Ambiguous → tiny disambiguation LLM call (ingestion only; the read path
      // stays silent instead of guessing).
      const byId = new Map(candidates.map((c) => [c.id, c]));
      entityId = await disambiguate(
        memoryText,
        mention,
        decision.candidateIds
          .map((id) => byId.get(id))
          .filter((c): c is (typeof candidates)[number] => Boolean(c))
          .map((c) => ({
            id: c.id,
            canonicalName: c.canonicalName,
            profile: c.profile,
          })),
      );
    }

    if (entityId) {
      await touchEntity(entityId, mention.surface, occurredAt);
    } else {
      entityId = await createEntity(userId, mention, occurredAt);
    }

    await upsertEdge(memoryId, entityId);
    resolution.set(mention.surface.toLowerCase(), entityId);
    resolution.set(mention.canonicalGuess.toLowerCase(), entityId);
  }

  return resolution;
}
