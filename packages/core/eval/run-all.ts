/**
 * `bun run eval` / `bun run eval:all` — full pipeline:
 *   1) ingest eval (seed + process + extraction asserts)
 *   2) retrieve eval (Ask quality over the same state)
 *
 * Always runs retrieve after a successful seed from ingest (even if some
 * ingest checks fail — so you still see Ask quality). Exit 0 only if BOTH
 * stage gates pass.
 */

import { runIngest } from "./run-ingest";
import { runRetrieve } from "./run-retrieve";
import { loadEvalConfig } from "./lib/config";
import { printReport, writeReport } from "./lib/report";
import type { EvalReport } from "./lib/types";

export async function runAll(): Promise<EvalReport> {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  YAADORA FULL EVAL — ingest → retrieve                 ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  const ingestReport = await runIngest();

  console.log("\n── continuing to retrieve stage ──\n");
  // State already written by ingest; do not reseed.
  const retrieveReport = await runRetrieve({ allowReseed: false });

  const report: EvalReport = {
    ranAt: new Date().toISOString(),
    command: "all",
    stages: [...ingestReport.stages, ...retrieveReport.stages],
    checks: [...ingestReport.checks, ...retrieveReport.checks],
    gatesPassed: ingestReport.gatesPassed && retrieveReport.gatesPassed,
    clientToId: retrieveReport.clientToId ?? ingestReport.clientToId,
  };

  const cfg = loadEvalConfig();
  printReport(report);
  await writeReport(cfg, report);
  return report;
}

if (import.meta.main) {
  runAll()
    .then((r) => process.exit(r.gatesPassed ? 0 : 1))
    .catch((err) => {
      console.error("\nFull eval crashed:", err);
      process.exit(2);
    });
}
