import { generateObject } from "ai";
import { z } from "zod";
import {
  db,
  facts,
  eq,
  and,
  isNull,
  listUserIdsWithMemories,
  findEntitiesTouchedSince,
  getCurrentFactTextsForEntity,
  updateEntityProfile,
  findDuplicateFactPairs,
  mergeDuplicateFact,
  getRecentEpisodicMemories,
  rescoreSalience,
  type NewFact,
} from "@repo/db";
import { ingestionModel, reasoningModel, embedText, embedTexts } from "../ai/models";

/**
 * Consolidation — the nightly "sleep" job (spec 02 §5). Rebuildable from the
 * immutable memories log; if the logic changes, just re-run it.
 *
 *   1. entity profile rebuild (§5.1)
 *   2. fact dedup / merge   (§5.2)
 *   3. pattern mining       (§5.3)  → insights stored as origin='consolidation' facts
 *   4. salience rescoring   (§5.4)  → retrieval tie-breaker prior, never deletes
 *
 * Everything here is orchestration + LLM; the raw SQL lives in @repo/db.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ConsolidationOptions {
  /** limit to one user; null/undefined = every user with memories */
  userId?: string | null;
  /** "touched since" watermark for profile rebuild; default last 24h */
  since?: Date | null;
}

export interface ConsolidationReport {
  userId: string;
  profilesRebuilt: number;
  factsMerged: number;
  insightsWritten: number;
}

export async function runConsolidation(
  opts: ConsolidationOptions = {},
): Promise<ConsolidationReport[]> {
  const since = opts.since ?? new Date(Date.now() - DAY_MS);
  const userIds = opts.userId
    ? [opts.userId]
    : await listUserIdsWithMemories();

  const reports: ConsolidationReport[] = [];
  for (const userId of userIds) {
    const profilesRebuilt = await rebuildEntityProfiles(userId, since);
    const factsMerged = await dedupFacts(userId);
    const insightsWritten = await minePatterns(userId);
    await rescoreSalience(userId);
    reports.push({ userId, profilesRebuilt, factsMerged, insightsWritten });
  }
  return reports;
}

// --- §5.1 entity profile rebuild ------------------------------------------

const ProfileSchema = z.object({ profile: z.string() });

async function rebuildEntityProfiles(
  userId: string,
  since: Date,
): Promise<number> {
  const entities = await findEntitiesTouchedSince(userId, since);
  let rebuilt = 0;
  for (const entity of entities) {
    const factTexts = await getCurrentFactTextsForEntity(userId, entity.id);
    if (factTexts.length === 0) continue;

    const { object } = await generateObject({
      model: ingestionModel,
      schema: ProfileSchema,
      system:
        "You maintain a personal memory system. Write a concise, factual profile summary of the given subject from the known facts. Third person, no speculation.",
      prompt: `Subject: ${entity.canonicalName} (${entity.type})
Known current facts:
${factTexts.map((f) => `- ${f}`).join("\n")}`,
    });

    const { embedding } = await embedText(object.profile);
    await updateEntityProfile(entity.id, object.profile, embedding);
    rebuilt++;
  }
  return rebuilt;
}

// --- §5.2 fact dedup / merge ----------------------------------------------

async function dedupFacts(userId: string): Promise<number> {
  const pairs = await findDuplicateFactPairs(userId);
  const dropped = new Set<string>();
  let merged = 0;
  for (const { keepId, dropId } of pairs) {
    // Skip if either side was already merged this run (avoids chains/conflicts).
    if (dropped.has(keepId) || dropped.has(dropId)) continue;
    await mergeDuplicateFact(keepId, dropId);
    dropped.add(dropId);
    merged++;
  }
  return merged;
}

// --- §5.3 pattern mining ---------------------------------------------------

const PatternSchema = z.object({
  insights: z.array(
    z.object({
      insightText: z.string(),
      supportingMemoryIds: z.array(z.string()),
    }),
  ),
});

/** Look back this far for recurring patterns. */
const PATTERN_WINDOW_MS = 30 * DAY_MS;
/** Need at least this many episodic memories before mining is meaningful. */
const MIN_MEMORIES_FOR_PATTERNS = 5;

async function minePatterns(userId: string): Promise<number> {
  const since = new Date(Date.now() - PATTERN_WINDOW_MS);
  const mems = await getRecentEpisodicMemories(userId, since);
  if (mems.length < MIN_MEMORIES_FOR_PATTERNS) return 0;

  const { object } = await generateObject({
    model: reasoningModel,
    schema: PatternSchema,
    system:
      "You are the consolidation stage of a personal memory system. Find RECURRING patterns/correlations across the user's recent memories (e.g. 'low energy is mentioned on most late-night-work days'). Only report a pattern supported by MULTIPLE memories; cite their ids. If there are no real patterns, return an empty list.",
    prompt: mems
      .map((m) => `[${m.id}] ${m.rawText.replace(/\s+/g, " ").slice(0, 400)}`)
      .join("\n"),
  });

  const validIds = new Set(mems.map((m) => m.id));
  const insights = object.insights
    .map((i) => ({
      insightText: i.insightText.trim(),
      supporting: i.supportingMemoryIds.filter((id) => validIds.has(id)),
    }))
    .filter((i) => i.insightText.length > 0 && i.supporting.length >= 2);

  // Refresh the insight set: retire prior consolidation insights (kept in
  // history, never deleted), then write the current batch.
  await db
    .update(facts)
    .set({ validTo: new Date() })
    .where(
      and(
        eq(facts.userId, userId),
        eq(facts.origin, "consolidation"),
        isNull(facts.validTo),
      ),
    );

  if (insights.length === 0) return 0;

  const { embeddings } = await embedTexts(insights.map((i) => i.insightText));

  const now = new Date();
  const rows: NewFact[] = insights.map((i, idx) => ({
    userId,
    subjectId: null, // patterns are about the user
    predicate: "pattern",
    objectText: `supported_by: ${i.supporting.join(", ")}`, // TODO: multi-provenance table
    objectId: null,
    factText: i.insightText,
    embedding: embeddings[idx] ?? null,
    validFrom: now,
    factType: "reflection",
    origin: "consolidation",
    confidence: Math.min(1, 0.5 + 0.1 * i.supporting.length),
    // Provenance is single-valued in the schema; use a representative memory.
    // Full contributing set is noted in objectText until a join table exists.
    sourceMemory: i.supporting[0]!,
  }));
  await db.insert(facts).values(rows);
  return rows.length;
}
