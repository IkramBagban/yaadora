import { eq } from "drizzle-orm";
import { db } from "../client";
import { consolidationRuns } from "../schema/instrumentation";
import type { ConsolidationRunCounters } from "../schema/instrumentation";

/**
 * Consolidation-run history (issue #30). The nightly consolidation job opens a
 * row when it starts and closes it with status + the counters it already logs,
 * so admin analytics can see run cadence, duration, and outcomes over time.
 */

export async function startConsolidationRun(): Promise<string> {
  const [row] = await db
    .insert(consolidationRuns)
    .values({ status: "running" })
    .returning({ id: consolidationRuns.id });
  if (!row) throw new Error("startConsolidationRun: insert returned no row");
  return row.id;
}

export interface FinishConsolidationRunInput {
  status: "ok" | "error";
  counters?: ConsolidationRunCounters;
  /** Error message when status='error'. */
  error?: string | null;
}

/** Close a run: sets finished_at = now() plus status/counters/error. */
export async function finishConsolidationRun(
  runId: string,
  input: FinishConsolidationRunInput,
): Promise<void> {
  await db
    .update(consolidationRuns)
    .set({
      finishedAt: new Date(),
      status: input.status,
      counters: input.counters ?? null,
      error: input.error ?? null,
    })
    .where(eq(consolidationRuns.id, runId));
}
