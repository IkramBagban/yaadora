import type { EvalConfig } from "./config";
import type { CheckResult, EvalReport, StageSummary } from "./types";
import { r3 } from "../metrics";

export function summarizeStage(
  stage: "ingest" | "retrieve",
  checks: CheckResult[],
  metrics: StageSummary["metrics"],
  gatesPassed: boolean,
): StageSummary {
  const stageChecks = checks.filter((c) => c.stage === stage);
  const passed = stageChecks.filter((c) => c.passed).length;
  const total = stageChecks.length;
  return {
    stage,
    passed,
    total,
    passRate: total === 0 ? 1 : r3(passed / total),
    gatesPassed,
    metrics,
  };
}

export function printReport(report: EvalReport): void {
  console.log("\n" + "=".repeat(72));
  console.log(`  YAADORA EVAL REPORT  (${report.command})`);
  console.log("=".repeat(72));

  for (const stage of report.stages) {
    console.log(`\n  ── ${stage.stage.toUpperCase()} ──`);
    console.log(
      `    checks   ${stage.passed}/${stage.total} passed  (rate ${stage.passRate})`,
    );
    console.log(
      `    gates    ${stage.gatesPassed ? "PASS" : "FAIL"}`,
    );
    for (const [k, v] of Object.entries(stage.metrics)) {
      console.log(`    ${k.padEnd(22)} ${v}`);
    }

    const fails = report.checks.filter(
      (c) => c.stage === stage.stage && !c.passed,
    );
    if (fails.length) {
      console.log(`    failures:`);
      for (const f of fails.slice(0, 40)) {
        console.log(`      ✗ [${f.category}] ${f.id}: ${f.reason}`);
      }
      if (fails.length > 40) {
        console.log(`      … +${fails.length - 40} more`);
      }
    }
  }

  console.log("\n" + "=".repeat(72));
  console.log(
    `  OVERALL: ${report.gatesPassed ? "PASS ✓" : "FAIL ✗"}  (${report.ranAt})`,
  );
  console.log("=".repeat(72));
}

export async function writeReport(
  cfg: EvalConfig,
  report: EvalReport,
): Promise<string> {
  await Bun.$`mkdir -p ${cfg.resultsDir}`.quiet();
  const stamp = report.ranAt.replace(/[:.]/g, "-");
  const file = `${cfg.resultsDir}/eval-${report.command}-${stamp}.json`;
  await Bun.write(file, JSON.stringify(report, null, 2));
  await Bun.write(
    `${cfg.resultsDir}/latest-${report.command}.json`,
    JSON.stringify(report, null, 2),
  );
  await Bun.write(
    `${cfg.resultsDir}/latest.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(`\nResults written to ${file}`);
  return file;
}
