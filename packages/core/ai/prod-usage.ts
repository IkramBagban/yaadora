import { upsertAiUsageDaily } from "@repo/db";
import { createLogger } from "@repo/logger";
import {
  getRequestUserId,
  getUsagePhase,
  type UsagePhase,
} from "../request-context";

const log = createLogger("ai:prod-usage");

export interface ProdUsageInput {
  /** ingestion | reasoning | fast | transcription | … */
  tier: string;
  /** provider:modelId as configured in ai/models.ts */
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /** Overrides the ambient context phase (defaults to it, else "other"). */
  phase?: UsagePhase;
}

/**
 * Production per-user AI usage rollup (issue #30) — the first-party
 * counterpart of the eval-only Redis tracker. Reads the attributed user from
 * the ambient request/job context and upserts `ai_usage_daily`
 * (day = UTC date).
 *
 * Callers invoke this FIRE-AND-FORGET (`void recordProdUsage(...)`): with no
 * user context (eval harness, unauthenticated traffic) it is a no-op, and any
 * DB failure is logged and swallowed — tracking must never break the request
 * or job that produced the usage.
 */
export async function recordProdUsage(input: ProdUsageInput): Promise<void> {
  const userId = getRequestUserId();
  if (!userId) return;

  try {
    await upsertAiUsageDaily({
      userId,
      tier: input.tier,
      model: input.model,
      phase: input.phase ?? getUsagePhase(),
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      latencyMs: input.latencyMs,
    });
  } catch (err) {
    log.warn("prod usage rollup failed", {
      message: err instanceof Error ? err.message : String(err),
      tier: input.tier,
      model: input.model,
    });
  }
}
