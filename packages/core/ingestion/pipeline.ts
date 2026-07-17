import {
  db,
  memories,
  reminders,
  rules,
  openLoops,
  users,
  eq,
  and,
  inArray,
  sql,
  toVectorLiteral,
} from "@repo/db";
import type { NewFact } from "@repo/db";
import { createLogger } from "@repo/logger";
import { embedTexts } from "../ai/models";
import { extract, type Extraction } from "./extraction";
import { linkEntities, type MentionInput, type EntityResolution } from "./linking";
import { reconcileAndInsertFact } from "./supersession";

/**
 * The ingestion pipeline entrypoint (spec 02 §2), run by `apps/worker` on the
 * BullMQ `ingestion` queue — ONE job per captured memory.
 *
 *   load → extract (1 LLM call) → temporal resolve → entity link →
 *   reconcile + fact insert (+ provenance) → multi-representation embeddings →
 *   processed
 *
 * Reconciliation (§2.5) runs per-fact via reconcileAndInsertFact. Nightly
 * consolidation (§5) runs separately in the consolidation queue.
 *
 * On unrecoverable failure this throws; the worker retries with backoff and
 * marks status='failed' after the final attempt (raw text is never lost).
 */

const log = createLogger("ingestion:pipeline");

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

function parseDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Prospective intent → a SUGGESTED reminder (docs/specs/reminder-feature).
 *
 * The write path (POST /memories) is async, so we can't hand a chip back in the
 * response like /ask does. Instead we persist the reminder as status="suggested"
 * — the client surfaces it as a one-tap chip (GET /reminders?scope=suggested) to
 * confirm (→ pending) or dismiss. Deduped per source memory so ingestion retries
 * never create doubles. Best-effort: a failure here never fails the memory.
 */
function shortTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 100 ? `${oneLine.slice(0, 97)}…` : oneLine;
}

async function maybeSuggestReminder(params: {
  userId: string;
  memoryId: string;
  intent: Extraction["intent"];
  occurredAt: Date | null;
  memoryText: string;
  now: Date;
}): Promise<void> {
  const { userId, memoryId, intent, occurredAt, memoryText, now } = params;

  // Two triggers, either one is enough:
  //  1. An explicit future ACTION ("call the bank Friday") from intent.
  //  2. A prospective EVENT ("meeting on Sunday", "flight next week") whose
  //     resolved occurredAt is in the future — extraction often fills occurredAt
  //     without setting intent for passive events, so we must catch these too.
  let due: Date | null = null;
  let text: string | null = null;

  if (intent?.hasFutureAction) {
    due = parseDate(intent.dueAt);
    text = (intent.text ?? "").trim() || null;
  }
  if (!due && occurredAt && occurredAt.getTime() > now.getTime()) {
    due = occurredAt;
    text = text ?? shortTitle(memoryText);
  }

  if (!due || due.getTime() <= now.getTime()) return; // nothing future to schedule

  try {
    // One suggestion per source memory (retry-safe).
    const existing = await db
      .select({ id: reminders.id })
      .from(reminders)
      .where(and(eq(reminders.sourceMemory, memoryId), eq(reminders.userId, userId)))
      .limit(1);
    if (existing.length) return;

    await db.insert(reminders).values({
      userId,
      text: text?.trim() || "Follow up",
      dueAt: due,
      origin: "suggested",
      status: "suggested",
      sourceMemory: memoryId,
    });
    log.info("reminder suggested from capture", { userId, memoryId, dueAt: due });
  } catch (err) {
    log.warn("reminder suggestion failed (ignored)", err as Error);
  }
}

/** Resolve a fact subject/object surface to an entity id, or null (literal or
 * "user"). */
function resolveEntity(
  surface: string,
  resolution: EntityResolution,
): string | null {
  const key = surface.trim().toLowerCase();
  if (key === "user" || key === "i" || key === "me" || key === "myself") {
    return null;
  }
  return resolution.get(key) ?? null;
}

/**
 * Upsert the one procedural rule a source memory can derive. Retry-safe.
 *
 * Immutability: if a rule already exists for this sourceMemory, leave it alone.
 * Never UPDATE ruleText/triggerText — that would let re-ingestion overwrite a
 * user correction or a carefully extracted row (P1 review: edit-as-correction
 * pre-inserts the rule then enqueues ingestion). Text changes go through
 * edit-as-correction supersession, not in-place mutation.
 */
export async function upsertStandingRule(params: {
  userId: string;
  memoryId: string;
  standingRule: Extraction["standingRule"];
  triggerEmbedding: number[];
}): Promise<void> {
  const { userId, memoryId, standingRule, triggerEmbedding } = params;
  if (!standingRule) return;

  const [existing] = await db
    .select({ id: rules.id })
    .from(rules)
    .where(and(eq(rules.userId, userId), eq(rules.sourceMemory, memoryId)))
    .limit(1);

  if (existing) return;

  await db.insert(rules).values({
    userId,
    sourceMemory: memoryId,
    ruleText: standingRule.ruleText.trim(),
    triggerText: standingRule.triggerText.trim(),
    triggerEmbedding: triggerEmbedding.length ? triggerEmbedding : null,
  });
}

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

  // Path 2 — held-intention resolution (spec 03 P4). Commitment loops are
  // self-scoped (usually no entity), so match the closest OPEN commitment by
  // embedding alone under a conservative threshold, no entity requirement. This
  // is how a conversational "it's a deliberate call" reply, captured as a
  // memory, closes the commitment loop so its nudge never fires again.
  const [commitment] = await db
    .select({ id: openLoops.id, distance })
    .from(openLoops)
    .where(
      and(
        eq(openLoops.userId, userId),
        eq(openLoops.status, "open"),
        eq(openLoops.kind, "commitment"),
      ),
    )
    .orderBy(distance)
    .limit(1);

  if (commitment && commitment.distance <= COMMITMENT_RESOLUTION_MAX_DISTANCE) {
    await db
      .update(openLoops)
      .set({ status: "resolved", resolvedBy: memoryId })
      .where(and(eq(openLoops.id, commitment.id), eq(openLoops.status, "open")));
    return commitment.id;
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

export async function runIngestion(memoryId: string): Promise<void> {
  // 1. Load the memory + its owner (timezone + createdAt drive temporal resolution).
  const [memory] = await db
    .select()
    .from(memories)
    .where(eq(memories.id, memoryId))
    .limit(1);
  if (!memory) {
    // Nothing to do — the row was deleted. Not an error worth retrying.
    return;
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, memory.userId))
    .limit(1);
  const timezone = user?.timezone ?? "UTC";

  // Mark processing (idempotent — safe on retry).
  await db
    .update(memories)
    .set({ status: "processing" })
    .where(eq(memories.id, memoryId));

  // 2. Single structured-extraction call (stages 2.1–2.4).
  const extraction: Extraction = await extract({
    rawText: memory.rawText,
    createdAt: memory.createdAt,
    timezone,
  });

  // 3. Temporal resolution — resolved event time for the memory.
  const occurredAt = parseDate(extraction.occurredAt) ?? memory.occurredAt ?? null;

  // 4. Multi-representation embeddings (§2.6), batched into ONE embedMany call:
  //    [ raw memory text, ...each fact text, ...each mention name ].
  const factTexts = extraction.facts.map((f) => f.factText);
  const mentionNames = extraction.entities.map((e) => e.canonicalGuess);
  const derivedTexts: string[] = [];
  const addDerivedText = (text: string | null): number | null => {
    const normalized = text?.trim();
    if (!normalized) return null;
    derivedTexts.push(normalized);
    return derivedTexts.length - 1;
  };
  // Keep each semantic field's embedding index beside the text insertion. This
  // prevents a blank optional field from shifting a later loop/resolution vector.
  const ruleEmbeddingIndex = addDerivedText(extraction.standingRule?.triggerText ?? null);
  const loopEmbeddingIndexes = extraction.openLoops.map((loop) =>
    addDerivedText(loop.title),
  );
  const resolutionEmbeddingIndex = addDerivedText(extraction.resolvesLoop);
  const values = [memory.rawText, ...factTexts, ...mentionNames, ...derivedTexts];

  const { embeddings } = await embedTexts(values);

  const rawEmbedding = embeddings[0];
  const factEmbeddings = embeddings.slice(1, 1 + factTexts.length);
  const mentionEmbeddings = embeddings.slice(1 + factTexts.length);
  const derivedEmbeddings = embeddings.slice(
    1 + factTexts.length + mentionNames.length,
  );

  // 5. Entity extraction + linking (§2.3).
  const mentions: MentionInput[] = extraction.entities.map((e, i) => ({
    surface: e.surface,
    type: e.type,
    canonicalGuess: e.canonicalGuess,
    embedding: mentionEmbeddings[i] ?? [],
  }));
  const resolution = await linkEntities({
    userId: memory.userId,
    memoryId,
    mentions,
    occurredAt,
    memoryText: memory.rawText,
  });

  // 6. Atomic fact insert (§2.4) — every fact carries sourceMemory (provenance,
  //    always). Each fact is reconciled against history FIRST (§2.5): duplicate →
  //    reinforce; update → supersede the old fact; conflict → keep both, flagged.
  //    Nothing is ever deleted. Facts are handled one at a time because a
  //    supersession can depend on the fact just inserted before it.
  for (let i = 0; i < extraction.facts.length; i++) {
    const f = extraction.facts[i]!;
    const embedding = factEmbeddings[i] ?? [];
    const row: NewFact = {
      userId: memory.userId,
      subjectId: resolveEntity(f.subject, resolution),
      predicate: f.predicate,
      objectText: f.object,
      objectId: resolveEntity(f.object, resolution),
      factText: f.factText,
      embedding: embedding.length ? embedding : null,
      validFrom: parseDate(f.validFrom) ?? occurredAt,
      factType: f.factType,
      origin: "extraction",
      confidence: f.confidence,
      sourceMemory: memoryId, // PROVENANCE — never omitted
    };
    await reconcileAndInsertFact({
      userId: memory.userId,
      memoryId,
      fact: row,
      embedding,
      occurredAt,
    });
  }

  // 6b. Procedural rules and unfinished loops are derived only after fact
  // reconciliation. They remain rebuildable from this source memory and every
  // write is idempotent for queue retries/reprocessing.
  const embeddingAt = (index: number | null): number[] =>
    index === null ? [] : (derivedEmbeddings[index] ?? []);
  const ruleEmbedding = embeddingAt(ruleEmbeddingIndex);
  const loopEmbeddings = loopEmbeddingIndexes.map(embeddingAt);
  const resolutionEmbedding = embeddingAt(resolutionEmbeddingIndex);

  await upsertStandingRule({
    userId: memory.userId,
    memoryId,
    standingRule: extraction.standingRule,
    triggerEmbedding: ruleEmbedding,
  });
  // Resolve before creating this memory's loops, so a broad close statement
  // cannot accidentally close a loop it just created.
  await resolveOpenLoop({
    userId: memory.userId,
    memoryId,
    resolvesLoop: extraction.resolvesLoop,
    resolution,
    extractedEntities: extraction.entities,
    embedding: resolutionEmbedding,
  });
  await upsertOpenLoops({
    userId: memory.userId,
    memoryId,
    loops: extraction.openLoops,
    resolution,
    embeddings: loopEmbeddings,
  });

  // 6c. Prospective intent OR a future-dated event → a suggested reminder the
  //     user can confirm/dismiss.
  await maybeSuggestReminder({
    userId: memory.userId,
    memoryId,
    intent: extraction.intent,
    occurredAt,
    memoryText: memory.rawText,
    now: new Date(),
  });

  // 7. Finalize: set the memory embedding + resolved occurredAt + processed.
  await db
    .update(memories)
    .set({
      embedding: rawEmbedding ?? null,
      occurredAt,
      status: "processed",
    })
    .where(eq(memories.id, memoryId));
}

/** Best-effort: mark a memory failed after BullMQ exhausts retries (§2.6).
 * Raw text is untouched — nothing is ever lost. */
export async function markMemoryFailed(memoryId: string): Promise<void> {
  await db
    .update(memories)
    .set({ status: "failed" })
    .where(
      and(eq(memories.id, memoryId), sql`${memories.status} <> 'processed'`),
    );
}
