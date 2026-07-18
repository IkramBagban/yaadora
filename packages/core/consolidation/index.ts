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
  getGraphSnapshot,
  rescoreSalience,
  materializeEntityEdges,
  getUserProfileFactTexts,
  getRecentConversationSummaries,
  upsertDigest,
  expireStaleOpenLoops,
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
 *   5. entity_edges rebuild (§3.2)  → derived-of-derived, fully rebuildable
 *   6. digests              (§3.2)  → profile + 7-day week digest, ingestion tier
 *   7. loop expiry     (spec 04 §3.1) → retire dated check-ins the user never
 *                                       engaged, at dueAt+14d
 *
 * Everything here is orchestration + LLM; the raw SQL lives in @repo/db.
 *
 * Absence candidates (spec 04 §3.6) are NOT precomputed/stored here: they are
 * derived at read time by `selectFollowUps` from `memory_entities` + the ledger
 * (no new source-of-truth, fully rebuildable — spec 01). The statistical floors
 * live in `getAbsenceCandidates`.
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
  /** entity_edges rows re-derived this run (§3.2). */
  edgesMaterialized: number;
  /** digests written this run: 0–2 (profile, week) (§3.2). */
  digestsBuilt: number;
  /** open loops retired at dueAt+14d, never engaged (spec 04 §3.1). */
  loopsExpired: number;
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
    // Edges derive from the (now deduped/rescored) facts; digests read facts +
    // conversation summaries. Both run last so they see this run's updates.
    const edgesMaterialized = await materializeEntityEdges(userId);
    const digestsBuilt = await buildDigests(userId);
    // Retire dated check-ins the user never engaged with (spec 04 §3.1). Runs
    // last: it only reads `status`/`due_at` and the ledger, nothing above.
    const loopsExpired = await expireStaleOpenLoops(userId, new Date());
    reports.push({
      userId,
      profilesRebuilt,
      factsMerged,
      insightsWritten,
      edgesMaterialized,
      digestsBuilt,
      loopsExpired,
    });
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
      /** the model's own confidence 0–1 that this is a real, defensible pattern. */
      confidence: z.number().min(0).max(1),
    }),
  ),
});

/**
 * How far back dated memories reach for the timeline the pattern pass reasons
 * over. Patterns like "projects go quiet around week three" need month+-scale
 * history; the current graph (entities/edges/loops) is always included in full.
 */
const PATTERN_MEMORY_WINDOW_DAYS = 365;
/** Need at least this much episodic signal before mining is meaningful. */
const MIN_MEMORIES_FOR_PATTERNS = 5;
/**
 * Store an insight only with at least this many receipts. The stricter
 * surfacing bar (≥5 receipts AND confidence ≥0.8, spec 02 §5.4) is enforced at
 * read time in `selectObservation`; keeping a slightly wider candidate pool
 * here means a pattern that gains a 5th receipt later can surface without a
 * re-mine. "Inference too thin" (2 points) never enters the store.
 */
const MIN_RECEIPTS_TO_STORE = 3;

function serializeGraphForPatterns(snap: {
  entities: { canonicalName: string; type: string; mentionCount: number; firstSeen: string | null; lastSeen: string | null }[];
  edges: { aName: string; bName: string; relType: string; status: string }[];
  loops: { kind: string; title: string; dueAt: string | null }[];
  memories: { id: string; occurredAt: string | null; text: string }[];
}): string {
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "?");
  const sections: string[] = [];
  if (snap.entities.length) {
    sections.push(
      "PEOPLE / PROJECTS / TOPICS (name · type · mentions · first→last seen):\n" +
        snap.entities
          .map(
            (e) =>
              `- ${e.canonicalName} · ${e.type} · ${e.mentionCount}× · ${day(e.firstSeen)}→${day(e.lastSeen)}`,
          )
          .join("\n"),
    );
  }
  if (snap.edges.length) {
    sections.push(
      "RELATIONSHIPS:\n" +
        snap.edges
          .map((e) => `- ${e.aName} —[${e.relType}, ${e.status}]— ${e.bName}`)
          .join("\n"),
    );
  }
  if (snap.loops.length) {
    sections.push(
      "OPEN THREADS:\n" +
        snap.loops
          .map((l) => `- (${l.kind}) ${l.title}${l.dueAt ? ` [due ${day(l.dueAt)}]` : ""}`)
          .join("\n"),
    );
  }
  sections.push(
    "TIMELINE (memory id · date · text) — cite these ids as supporting evidence:\n" +
      snap.memories
        .map((m) => `[${m.id}] ${day(m.occurredAt)} — ${m.text}`)
        .join("\n"),
  );
  return sections.join("\n\n");
}

/**
 * The whole-graph pattern pass (spec 02 §3.2.3). Serializes the user's entire
 * graph — entities, edges, open loops, and a dated memory timeline — and hands
 * it to the reasoning tier with one question: what recurs or connects here that
 * the user may not have connected? Personal-scale data fits one context window,
 * so the LLM IS the graph algorithm (spec 01 D1); no traversal library.
 *
 * Insights are CANDIDATES ONLY — stored as origin='consolidation' reflections
 * with multi-provenance and an evidence-tied confidence. They surface later,
 * one at a time and only when relevant, through the P5 context path
 * (`selectObservation`); nothing here is ever auto-shown.
 */
async function minePatterns(userId: string): Promise<number> {
  const snapshot = await getGraphSnapshot({
    userId,
    memoryWindowDays: PATTERN_MEMORY_WINDOW_DAYS,
  });
  if (snapshot.memories.length < MIN_MEMORIES_FOR_PATTERNS) return 0;

  const { object } = await generateObject({
    model: reasoningModel,
    schema: PatternSchema,
    system:
      "You are the consolidation ('sleep') stage of a personal memory system. You are given a user's whole knowledge graph — their people/projects, relationships, open threads, and a dated timeline of memories. Find RECURRING patterns or non-obvious connections the user may not have connected themselves (e.g. 'the last five projects all went quiet around week three', 'low energy is mentioned on most late-night-work days'). Rules: (1) every insight MUST be supported by MULTIPLE specific memories — cite their exact ids from the timeline; the more independent supporting memories, the better. (2) State each insight as a neutral observation about the user, never a judgment or diagnosis. (3) Only report patterns you could defend with the receipts; set confidence honestly. (4) If there are no real, well-supported patterns, return an empty list — silence is correct and expected.",
    prompt: serializeGraphForPatterns(snapshot),
  });

  const validIds = new Set(snapshot.memories.map((m) => m.id));
  const insights = object.insights
    .map((i) => ({
      insightText: i.insightText.trim(),
      supporting: Array.from(
        new Set(i.supportingMemoryIds.filter((id) => validIds.has(id))),
      ),
      modelConfidence: i.confidence,
    }))
    .filter(
      (i) =>
        i.insightText.length > 0 && i.supporting.length >= MIN_RECEIPTS_TO_STORE,
    );

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
    objectText: `supported_by: ${i.supporting.join(", ")}`, // multi-provenance until a join table exists
    objectId: null,
    factText: i.insightText,
    embedding: embeddings[idx] ?? null,
    validFrom: now,
    factType: "reflection",
    origin: "consolidation",
    // Confidence is the MINIMUM of the model's own confidence and an
    // evidence-tied cap (0.5 + 0.1·receipts): a claim can't outrun its
    // receipts. With the ≥0.8 surfacing bar this means ≥3 receipts before a
    // pattern can even qualify, and the independent ≥5-receipt check in
    // selectObservation is the real gate (spec 02 §5.4).
    confidence: Math.min(1, i.modelConfidence, 0.5 + 0.1 * i.supporting.length),
    // Representative provenance; full contributing set is in objectText.
    sourceMemory: i.supporting[0]!,
  }));
  await db.insert(facts).values(rows);
  return rows.length;
}

// --- §3.2 digests (profile summary + 7-day week digest) --------------------

const WEEK_MS = 7 * DAY_MS;
const DigestSchema = z.object({ summary: z.string() });

/**
 * Build the two per-user digests the context pack reads (§4), on the ingestion
 * tier (§7 model routing). Cache-like and rebuildable — nothing here is a source
 * of truth. Skips a digest when there is nothing to summarize (no empty writes).
 * Returns how many digests were written (0–2).
 */
async function buildDigests(userId: string): Promise<number> {
  let built = 0;

  // Profile summary — a stable paragraph about the user from current user-level
  // facts (subject "user"), excluding mined reflections.
  const profileFacts = await getUserProfileFactTexts(userId);
  if (profileFacts.length > 0) {
    const { object } = await generateObject({
      model: ingestionModel,
      schema: DigestSchema,
      system:
        "You maintain a personal memory system. Write a concise 3–5 sentence profile of the USER from these known current facts about them. Third person, factual, no speculation, invent nothing.",
      prompt: profileFacts.map((f) => `- ${f}`).join("\n"),
    });
    const summary = object.summary.trim();
    if (summary) {
      await upsertDigest(userId, "profile", summary);
      built++;
    }
  }

  // 7-day week digest — recent adds + conversation summaries into one paragraph.
  const since = new Date(Date.now() - WEEK_MS);
  const recentMems = await getRecentEpisodicMemories(userId, since);
  const convSummaries = await getRecentConversationSummaries(userId, since);
  if (recentMems.length > 0 || convSummaries.length > 0) {
    const memLines = recentMems.map(
      (m) => `- ${m.rawText.replace(/\s+/g, " ").slice(0, 300)}`,
    );
    const convLines = convSummaries.map(
      (s) => `- (conversation) ${s.replace(/\s+/g, " ").slice(0, 300)}`,
    );
    const { object } = await generateObject({
      model: ingestionModel,
      schema: DigestSchema,
      system:
        "You maintain a personal memory system. Summarize the user's PAST 7 DAYS into ONE compact paragraph (≤120 words): what they did, decided, felt, and what's still ongoing. Factual, no speculation, invent nothing. If there is little, keep it short.",
      prompt: [...memLines, ...convLines].join("\n"),
    });
    const summary = object.summary.trim();
    if (summary) {
      await upsertDigest(userId, "week", summary);
      built++;
    }
  }

  return built;
}
