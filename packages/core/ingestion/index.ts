// The ingestion pipeline (spec 02 §2). One `runIngestion(memoryId)` entrypoint
// for the worker.
//
// The individual stages (./embeddings, ./facts, ./loops, ./memory-record,
// ./reminders, ./rules, ./temporal) are deliberately NOT re-exported here —
// they are internals of the pipeline, and tests that need one import its module
// directly. Keep this barrel to what consumers outside the package actually use.
export { runIngestion } from "./pipeline";
export { markMemoryFailed } from "./memory-record";
export { extract, ExtractionSchema } from "./extraction";
export type { Extraction, ExtractionContext } from "./extraction";
export {
  linkEntities,
  decideEntityLink,
  LINK_DISTANCE_THRESHOLD,
  AMBIGUOUS_DISTANCE_THRESHOLD,
} from "./linking";
export type {
  MentionInput,
  EntityResolution,
  LinkCandidate,
  LinkDecision,
} from "./linking";
export { reconcileAndInsertFact } from "./supersession";
export type { ReconcileInput } from "./supersession";
export { runReprocessJob } from "./reprocess";
export type { ReprocessJobData } from "./reprocess";
export {
  captureFromConversation,
  CaptureGateSchema,
} from "./conversation-capture";
export type { CaptureGate, CaptureResult } from "./conversation-capture";
