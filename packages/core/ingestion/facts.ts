import type { NewFact } from "@repo/db";
import type { Extraction } from "./extraction";
import { resolveEntity, type EntityResolution } from "./linking";
import { reconcileAndInsertFact } from "./supersession";
import { parseDate } from "./temporal";

/**
 * Step 6 of the ingestion pipeline — turning extracted facts into rows.
 *
 * The reconciliation itself lives in ./supersession; this module is the stage
 * that shapes each extracted fact into a `NewFact` and feeds them through in
 * order.
 */

/**
 * Atomic fact insert (spec 02 §2.4). Every fact carries sourceMemory
 * (provenance, always). Each is reconciled against history FIRST (§2.5):
 * duplicate → reinforce; update → supersede the old fact; conflict → keep both,
 * flagged. Nothing is ever deleted.
 *
 * Sequential on purpose: a supersession can depend on the fact inserted just
 * before it, so these must not be parallelised.
 */
export async function insertExtractedFacts(params: {
  userId: string;
  memoryId: string;
  facts: Extraction["facts"];
  embeddings: number[][];
  resolution: EntityResolution;
  occurredAt: Date | null;
}): Promise<void> {
  const { userId, memoryId, facts, embeddings, resolution, occurredAt } = params;
  for (let i = 0; i < facts.length; i++) {
    const f = facts[i]!;
    const embedding = embeddings[i] ?? [];
    const row: NewFact = {
      userId,
      subjectId: resolveEntity(f.subject, resolution),
      predicate: f.predicate, // predicate means the verb or relation in the fact, e.g. "is", "has", "owns", etc  .predicate is always required, but we default to "is" for a reflection
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
      userId,
      memoryId,
      fact: row,
      embedding,  
      occurredAt,
    });
  }
}
