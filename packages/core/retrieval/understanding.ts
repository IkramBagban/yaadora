import { generateObject } from "ai";
import { z } from "zod";
import { findEntityCandidates, type TimeRange } from "@repo/db";
import { reasoningModel, embedTexts } from "../ai/models";

/**
 * Query understanding (spec 02 §3.1) — the first reasoning-tier call of Ask.
 *
 * ONE `generateObject` classifies the query and extracts hard filters:
 *  - queryType (episodic | entity | factual | temporal | decision)
 *  - entity mentions → resolved to entity IDs (alias + embedding, in @repo/db)
 *  - timeRange → absolute [from, to] or null (a HARD SQL predicate downstream)
 *  - historical → include superseded facts (else prefer valid_to IS NULL)
 *  - searchQueries[] → 1–3 rewrites (multi-query expansion)
 *
 * Time/entity resolution is what turns naive RAG into accurate retrieval: wrong
 * time / wrong person candidates never enter ranking (spec 02 §3.2, §8).
 */

export const QueryUnderstandingSchema = z.object({
  queryType: z.enum(["episodic", "entity", "factual", "temporal", "decision"]),
  entities: z.array(
    z.object({
      surface: z.string(),
      type: z.enum(["person", "place", "org", "topic", "project"]),
    }),
  ),
  // Absolute ISO window resolved against the current date + user tz, or null.
  timeRange: z
    .object({ from: z.string().nullable(), to: z.string().nullable() })
    .nullable(),
  // true when the user asks about the PAST ("where did Urhan live in January?")
  // → include superseded facts; false → prefer currently-valid facts.
  historical: z.boolean(),
  searchQueries: z.array(z.string()).min(1).max(3),
});

export type QueryUnderstanding = z.infer<typeof QueryUnderstandingSchema>;

/** Entity distance under which a vector candidate auto-resolves (no exact name). */
const ENTITY_RESOLVE_DISTANCE = 0.35;

export interface UnderstoodQuery {
  queryType: QueryUnderstanding["queryType"];
  entityIds: string[];
  timeRange: TimeRange | null;
  /** true → historical query; retrieval keeps superseded facts in play */
  historical: boolean;
  searchQueries: string[];
  /** one embedding per searchQuery (multi-query expansion) */
  queryEmbeddings: number[][];
}

const SYSTEM_PROMPT = `You are the query-understanding stage of a personal memory system.
Given the user's question, classify it and extract hard retrieval filters.

- queryType: episodic (a specific event) | entity (about a person/place/thing) |
  factual (a specific fact) | temporal (bounded by time) | decision (asking for
  help weighing a choice).
- entities: every person/place/org/topic/project the question refers to.
- timeRange: if the question is time-bounded, resolve it to an ABSOLUTE ISO 8601
  window [from, to] using the provided current date and timezone
  ("last March" -> that month's first/last instant). Otherwise null.
- historical: true if the user is asking about the PAST / how things USED to be
  (so outdated facts are relevant); false for "what is true now".
- searchQueries: 1-3 rewritten search strings capturing the information need
  (include synonyms / expansions). Keep them concise.
Never invent entities or times not implied by the question.`;

function toTimeRange(
  tr: QueryUnderstanding["timeRange"],
): TimeRange | null {
  if (!tr) return null;
  const from = tr.from ? new Date(tr.from) : null;
  const to = tr.to ? new Date(tr.to) : null;
  if (from && !Number.isNaN(from.getTime()) && to && !Number.isNaN(to.getTime())) {
    return { from, to };
  }
  // A one-sided window is still a hard bound; clamp the open end pragmatically.
  if (from && !Number.isNaN(from.getTime())) {
    return { from, to: new Date() };
  }
  if (to && !Number.isNaN(to.getTime())) {
    return { from: new Date(0), to };
  }
  return null;
}

function formatNow(now: Date, timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      dateStyle: "full",
      timeStyle: "long",
    });
    return `${fmt.format(now)} (ISO: ${now.toISOString()}, timezone: ${timezone})`;
  } catch {
    return `${now.toISOString()} (timezone: UTC)`;
  }
}

/**
 * Understand a question: classify, extract filters, resolve entities to IDs, and
 * embed the rewritten search queries for the vector channel.
 */
export async function understandQuery(params: {
  userId: string;
  question: string;
  now: Date;
  timezone: string;
}): Promise<UnderstoodQuery> {
  const { userId, question, now, timezone } = params;

  const { object } = await generateObject({
    model: reasoningModel,
    schema: QueryUnderstandingSchema,
    system: SYSTEM_PROMPT,
    prompt: `Current date/time: ${formatNow(now, timezone)}

Question:
"""
${question}
"""`,
  });

  // Embed the search queries + entity surfaces together (one batched call).
  const entitySurfaces = object.entities.map((e) => e.surface);
  const values = [...object.searchQueries, ...entitySurfaces];
  const { embeddings } = await embedTexts(values);

  const queryEmbeddings = embeddings.slice(0, object.searchQueries.length);
  const entityEmbeddings = embeddings.slice(object.searchQueries.length);

  // Resolve each mention to an entity id (alias/canonical match OR near vector).
  const entityIds = new Set<string>();
  await Promise.all(
    object.entities.map(async (mention, i) => {
      const candidates = await findEntityCandidates({
        userId,
        type: mention.type,
        nameGuess: mention.surface,
        embedding: entityEmbeddings[i] ?? null,
        limit: 3,
      });
      const match = candidates.find(
        (c) =>
          c.nameMatch ||
          (c.distance != null && c.distance <= ENTITY_RESOLVE_DISTANCE),
      );
      if (match) entityIds.add(match.id);
    }),
  );

  return {
    queryType: object.queryType,
    entityIds: Array.from(entityIds),
    timeRange: toTimeRange(object.timeRange),
    historical: object.historical,
    searchQueries: object.searchQueries,
    queryEmbeddings,
  };
}
