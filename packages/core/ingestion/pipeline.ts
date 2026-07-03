import { embedMany } from "ai";
import {
  db,
  memories,
  users,
  eq,
  and,
  sql,
} from "@repo/db";
import type { NewFact } from "@repo/db";
import { embeddingModel } from "../ai/models";
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

function parseDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
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
  const values = [memory.rawText, ...factTexts, ...mentionNames];

  const { embeddings } = await embedMany({ model: embeddingModel, values });

  const rawEmbedding = embeddings[0];
  const factEmbeddings = embeddings.slice(1, 1 + factTexts.length);
  const mentionEmbeddings = embeddings.slice(1 + factTexts.length);

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

  // TODO(reminders — later wave): extraction.intent carries hasFutureAction +
  // resolved dueAt; the server surfaces it as a one-tap reminder suggestion
  // (spec 02 §6). Not persisted during Week 1–2.

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
