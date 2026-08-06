/**
 * Shared eval config — env-driven, used by ingest / retrieve / all runners.
 */

export function loadEvalConfig() {
  const serverUrl = (
    process.env.YAADORA_SERVER_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");
  const token = process.env.AUTH_BOOTSTRAP_TOKEN ?? "";
  const k = Number(process.env.EVAL_K ?? 10);
  // Default 20 minutes: Flash is faster, but 36 memories + retries still need headroom.
  const ingestTimeoutS = Number(process.env.EVAL_INGEST_TIMEOUT ?? 1200);
  const only = (process.env.EVAL_ONLY ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Ingest gates
  const minIngestPassRate = Number(process.env.EVAL_MIN_INGEST_PASS ?? 0.85);
  const requireAllProcessed = process.env.EVAL_REQUIRE_ALL_PROCESSED !== "0";

  // Retrieve gates
  const minRecall = Number(process.env.EVAL_MIN_RECALL ?? 0.8);
  const minMrr = Number(process.env.EVAL_MIN_MRR ?? 0.7);
  const minRefusal = Number(process.env.EVAL_MIN_REFUSAL ?? 0.9);
  const minAnswerQuality = Number(process.env.EVAL_MIN_ANSWER_QUALITY ?? 0.75);
  const minRetrievePassRate = Number(process.env.EVAL_MIN_RETRIEVE_PASS ?? 0.8);

  return {
    serverUrl,
    token,
    k,
    ingestTimeoutS,
    only,
    minIngestPassRate,
    requireAllProcessed,
    minRecall,
    minMrr,
    minRefusal,
    minAnswerQuality,
    minRetrievePassRate,
    resultsDir: `${import.meta.dir}/../results`,
    statePath: `${import.meta.dir}/../results/eval-state.json`,
  };
}

export type EvalConfig = ReturnType<typeof loadEvalConfig>;
