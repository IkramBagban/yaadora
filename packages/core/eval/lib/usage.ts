/**
 * Eval-side helpers around the shared Redis usage tracker.
 */

import {
  beginUsageSession,
  collectUsageSession,
  formatUsageSummary,
  setUsagePhase,
  type UsagePhase,
  type UsageReport,
} from "../../ai/usage-tracker";
import type { TokenUsageBlock } from "./types";

export function newEvalSessionId(command: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `eval-${command}-${stamp}`;
}

export async function startTokenTracking(
  sessionId: string,
  phase: UsagePhase,
): Promise<void> {
  await beginUsageSession({ sessionId, phase });
}

export async function switchTokenPhase(
  phase: UsagePhase,
  sessionId: string,
): Promise<void> {
  await setUsagePhase(phase, sessionId);
}

export async function finishTokenTracking(
  sessionId: string,
): Promise<TokenUsageBlock> {
  const report: UsageReport = await collectUsageSession(sessionId);
  const includeEvents = process.env.EVAL_TOKEN_DETAIL !== "0";

  console.log("\n  ── TOKEN USAGE ──");
  if (report.total.calls === 0) {
    console.log(
      "  (no LLM usage events — is REDIS_URL shared with server/worker? YAADORA_USAGE_TRACK≠0?)",
    );
  } else {
    console.log(formatUsageSummary(report));
  }

  return {
    sessionId: report.sessionId,
    total: report.total,
    byPhase: report.byPhase,
    byTier: report.byTier,
    byModel: report.byModel,
    byLabel: report.byLabel,
    events: includeEvents
      ? (report.events as unknown as Array<Record<string, unknown>>)
      : undefined,
  };
}

/** Merge two token blocks (e.g. ingest + retrieve partials) by re-collecting session. */
export async function collectFullSession(
  sessionId: string,
): Promise<TokenUsageBlock> {
  return finishTokenTracking(sessionId);
}
