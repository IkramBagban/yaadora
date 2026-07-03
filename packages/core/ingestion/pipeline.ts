import { embedMany } from "ai";
import {
  db,
  memories,
  facts,
  users,
  eq,
  and,
  sql,
} from "@repo/db";
import type { NewFact } from "@repo/db";
import { embeddingModel } from "../ai/models";
import { extract, type Extraction } from "./extraction";
import { linkEntities, type MentionInput, type EntityResolution } from "./linking";

/**
 * The ingestion pipeline entrypoint (spec 02 §2), run by `apps/worker` on the
 * BullMQ `ingestion` queue — ONE job per captured memory.
 *
 *   load → extract (1 LLM call) → temporal resolve → entity link →
 *   fact insert (+ provenance) → multi-representation embeddings → processed
 *
 * SKIPPED for now (later waves, TODO markers inline):
 *  - §2.5 contradiction / update / supersession detection
 *  - §5   nightly consolidation (entity profile rebuild, fact dedup, patterns)
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

  // 6. Atomic fact insert (§2.4) — every fact carries sourceMemory (provenance, always).
  //
  // TODO(§2.5 supersession — later wave): before inserting each fact, query
  // currently-valid facts with the same subjectId + similar predicate
  // (embedding + lexical). Duplicate → bump confidence; update → set old fact's
  // validTo = occurredAt and supersededBy = newId; genuine conflict → keep both
  // and flag for the user. Nothing is ever deleted. Until then we insert every
  // extracted fact as a fresh row.
  if (extraction.facts.length > 0) {
    const rows: NewFact[] = extraction.facts.map((f, i) => {
      const subjectId = resolveEntity(f.subject, resolution);
      const objectId = resolveEntity(f.object, resolution);
      return {
        userId: memory.userId,
        subjectId,
        predicate: f.predicate,
        objectText: f.object,
        objectId,
        factText: f.factText,
        embedding: factEmbeddings[i] ?? null,
        validFrom: parseDate(f.validFrom) ?? occurredAt,
        factType: f.factType,
        origin: "extraction",
        confidence: f.confidence,
        sourceMemory: memoryId, // PROVENANCE — never omitted
      };
    });
    await db.insert(facts).values(rows);
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
