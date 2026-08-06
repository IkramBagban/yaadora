/**
 * @repo/core/eval — ingestion + retrieval regression harness.
 *
 * Commands (repo root):
 *   bun run eval           # ingest → retrieve (full)
 *   bun run eval:ingest    # capture / extraction / facts / loops / reminders
 *   bun run eval:retrieve  # Ask quality (needs prior ingest state)
 *
 * Not re-exported from @repo/core main index — dev/CI tool only.
 */
export { GOLDEN_DATASET, DATASET_SIZE, BY_CLIENT_ID } from "./dataset";
export type { SeedMemory, Trap } from "./dataset";
export { EVAL_CASES, CASE_COUNT, RETRIEVE_CASES } from "./cases";
export type { EvalCase, EvalCategory, RetrieveCase, RetrieveCategory } from "./cases";
export {
  MEMORY_INGEST_EXPECTATIONS,
  GLOBAL_INGEST_EXPECTATIONS,
} from "./ingest-expectations";
export { recallAtK, reciprocalRank, hasForbidden, mean, r3 } from "./metrics";
