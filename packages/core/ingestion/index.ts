// The ingestion pipeline (spec 02 §2). One `runIngestion(memoryId)` entrypoint
// for the worker; the stage functions are exported for testing/reuse.
export { runIngestion, markMemoryFailed } from "./pipeline";
export { extract, ExtractionSchema } from "./extraction";
export type { Extraction, ExtractionContext } from "./extraction";
export { linkEntities } from "./linking";
export type { MentionInput, EntityResolution } from "./linking";
export { reconcileAndInsertFact } from "./supersession";
export type { ReconcileInput } from "./supersession";
export { runReprocessJob } from "./reprocess";
export type { ReprocessJobData } from "./reprocess";
export {
  captureFromConversation,
  CaptureGateSchema,
} from "./conversation-capture";
export type { CaptureGate, CaptureResult } from "./conversation-capture";
