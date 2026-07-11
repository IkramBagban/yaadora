/**
 * @repo/core/eval — the retrieval + reasoning regression harness.
 *
 * The golden dataset (dataset.ts) and eval cases (cases.ts) are the authored
 * baseline; runner.ts drives them through the real HTTP pipeline and scores with
 * metrics.ts. Run with `bun run eval` from the repo root.
 *
 * These are not re-exported from @repo/core's main index on purpose: eval is a
 * dev/CI tool, not part of the server/worker runtime surface.
 */
export { GOLDEN_DATASET, DATASET_SIZE, BY_CLIENT_ID } from "./dataset";
export type { SeedMemory, Trap } from "./dataset";
export { EVAL_CASES, CASE_COUNT } from "./cases";
export type { EvalCase, EvalCategory } from "./cases";
export { recallAtK, reciprocalRank, hasForbidden, mean, r3 } from "./metrics";
