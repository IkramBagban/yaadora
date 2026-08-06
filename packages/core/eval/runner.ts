/**
 * Back-compat entrypoint: `bun run packages/core/eval/runner.ts`
 * delegates to the full ingest → retrieve pipeline (`run-all.ts`).
 *
 * Prefer:
 *   bun run eval           # full pipeline
 *   bun run eval:ingest    # add/capture/extraction only
 *   bun run eval:retrieve  # ask/retrieval only (needs prior ingest state)
 */

import { runAll } from "./run-all";

runAll()
  .then((r) => process.exit(r.gatesPassed ? 0 : 1))
  .catch((err) => {
    console.error("\nEval run crashed:", err);
    process.exit(2);
  });
