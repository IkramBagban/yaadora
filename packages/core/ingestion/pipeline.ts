import { embedExtraction, type ExtractionEmbeddings } from "./embeddings";
import { extract, type Extraction } from "./extraction";
import { insertExtractedFacts } from "./facts";
import { linkExtractedEntities, type EntityResolution } from "./linking";
import { upsertOpenLoops, resolveOpenLoop } from "./loops";
import { loadIngestionContext, finalizeMemory } from "./memory-record";
import { maybeSuggestReminder } from "./reminders";
import { upsertStandingRule } from "./rules";
import { parseDate } from "./temporal";

/**
 * The ingestion pipeline entrypoint (spec 02 §2), run by `apps/worker` on the
 * BullMQ `ingestion` queue — ONE job per captured memory.
 *
 *   load → extract (1 LLM call) → temporal resolve → embed → entity link →
 *   reconcile + fact insert (+ provenance) → rules/loops → reminder → processed
 *
 * This file is orchestration only: it decides WHAT happens and in WHAT ORDER.
 * Each stage lives in its own module beside this one —
 *   ./memory-record  the memories-row lifecycle (steps 1 and 7)
 *   ./extraction     the single structured LLM call (step 2)
 *   ./temporal       shared ISO-date parsing (step 3)
 *   ./embeddings     the batched multi-representation vectors (step 4)
 *   ./linking        entity resolution (step 5)
 *   ./facts          fact shaping, over ./supersession's reconciliation (step 6)
 *   ./rules, ./loops derived procedural state (step 6b)
 *   ./reminders      prospective intent → suggested reminder (step 6c)
 *
 * Nightly consolidation (§5) runs separately in the consolidation queue.
 *
 * On unrecoverable failure this throws; the worker retries with backoff and
 * calls markMemoryFailed (./memory-record) after the final attempt — raw text
 * is never lost.
 */ 

/**
 * Step 6b — procedural rules and unfinished loops, derived only after fact
 * reconciliation. Every write is idempotent, so a queue retry or a full
 * reprocess rebuilds exactly this state from the same source memory.
 */
async function deriveRulesAndLoops(params: {
  userId: string;
  memoryId: string;
  extraction: Extraction;
  resolution: EntityResolution;
  embeddings: ExtractionEmbeddings;
}): Promise<void> {
  const { userId, memoryId, extraction, resolution, embeddings } = params;

  await upsertStandingRule({
    userId,
    memoryId,
    standingRule: extraction.standingRule,
    triggerEmbedding: embeddings.rule,
  });

  // Resolve before creating this memory's loops, so a broad close statement
  // cannot accidentally close a loop it just created.
  await resolveOpenLoop({
    userId,
    memoryId,
    resolvesLoop: extraction.resolvesLoop,
    resolution,
    extractedEntities: extraction.entities,
    embedding: embeddings.resolution,
  });

  await upsertOpenLoops({
    userId,
    memoryId,
    loops: extraction.openLoops,
    resolution,
    embeddings: embeddings.loops,
  });
}

/**
 * The seven ingestion steps, in order.
 *
 * Every step is one call or one expression — the detail lives in the stage
 * module it delegates to. Read top to bottom for what ingestion does and in
 * what order; open a stage module for how that step does it.
 */
export async function runIngestion(memoryId: string): Promise<void> {
  // 1. Load the memory + its owner (timezone + createdAt drive temporal
  //    resolution) and mark it processing.
  const context = await loadIngestionContext(memoryId);
  if (!context) return; // the row was deleted — not an error worth retrying
  const { memory, timezone } = context;

  // 2. Single structured-extraction call
  const extraction: Extraction = await extract({
    rawText: memory.rawText,
    createdAt: memory.createdAt,
    timezone,
  });

  // 3. Temporal resolution — resolved event time for the memory.
   const occurredAt = parseDate(extraction.occurredAt) ?? memory.occurredAt ?? null;

  // 4. Multi-representation embeddings, batched into ONE embedMany call.
  const embeddings = await embedExtraction(memory.rawText, extraction);

  // 5. Entity extraction + linking (§2.3).
  const resolution = await linkExtractedEntities({
    userId: memory.userId,
    memoryId,
    entities: extraction.entities,
    embeddings: embeddings.mentions,
    occurredAt,
    memoryText: memory.rawText,
  });

  // 6. Atomic fact insert (§2.4), each fact reconciled against history first (§2.5).
  await insertExtractedFacts({
    userId: memory.userId,
    memoryId,
    facts: extraction.facts,
    embeddings: embeddings.facts,
    resolution,
    occurredAt,
  });

  // 6b. Procedural rules and unfinished loops, derived after reconciliation.
  await deriveRulesAndLoops({
    userId: memory.userId,
    memoryId,
    extraction,
    resolution,
    embeddings,
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
  await finalizeMemory({ memoryId, embedding: embeddings.raw, occurredAt });
}
