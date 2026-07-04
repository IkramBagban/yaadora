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
 * names cluster tightly. Conservative on purpose. */
const LINK_DISTANCE_THRESHOLD = 0.15;
/** Distance under which multiple candidates are "ambiguous" → disambiguation. */
const AMBIGUOUS_DISTANCE_THRESHOLD = 0.3;

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
  const { object } = await generateObject({
    model: ingestionModel, // tiny, rare call — keep it on the cheap tier (cost discipline)
    schema: DisambiguationSchema,
    system:
      "Pick which existing entity a mention refers to, or decide it is new. " +
      "Return the exact entityId of the best match, or null if none matches.",
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
  });
  // Guard: only accept an id that was actually offered.
  if (object.entityId && candidates.some((c) => c.id === object.entityId)) {
    return object.entityId;
  }
  return null;
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

    // 1. Confident exact name/alias match → link.
    const exact = candidates.find((c) => c.nameMatch);
    if (exact) {
      entityId = exact.id;
    } else {
      // 2. Embedding-similarity resolution.
      const near = candidates.filter(
        (c) => c.distance != null && c.distance <= AMBIGUOUS_DISTANCE_THRESHOLD,
      );
      const confident = near.filter(
        (c) => c.distance != null && c.distance <= LINK_DISTANCE_THRESHOLD,
      );
      if (confident.length === 1) {
        entityId = confident[0]!.id;
      } else if (near.length > 1 || confident.length > 1) {
        // Ambiguous → tiny disambiguation LLM call.
        entityId = await disambiguate(
          memoryText,
          mention,
          near.map((c) => ({
            id: c.id,
            canonicalName: c.canonicalName,
            profile: c.profile,
          })),
        );
      }
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
