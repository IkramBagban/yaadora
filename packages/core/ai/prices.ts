/**
 * Per-model token price map (issue #31) — estimates, update as pricing changes.
 *
 * `ai_usage_daily.model` stores "provider:modelId" (see ai/models.ts), e.g.
 * "groq:openai/gpt-oss-120b". This map is keyed by the BARE model id; lookups
 * accept both forms (full string first, then the part after the last ':').
 *
 * Prices are best-effort public list prices in USD per million tokens and only
 * feed ADMIN COST ESTIMATES — never billing, gating, or budget decisions.
 * Unknown models cost 0 so a new provider default can never inflate estimates;
 * call sites flag them via {@link findUnknownModels}.
 */

export interface ModelPrice {
  inputUsdPerM: number;
  outputUsdPerM: number;
}

/** Embedding models are input-only; outputUsdPerM stays 0. */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Groq (prod chat default: openai/gpt-oss-120b on every tier)
  "openai/gpt-oss-120b": { inputUsdPerM: 0.15, outputUsdPerM: 0.6 },
  "openai/gpt-oss-20b": { inputUsdPerM: 0.05, outputUsdPerM: 0.2 },
  "llama-3.3-70b-versatile": { inputUsdPerM: 0.59, outputUsdPerM: 0.79 },

  // Google
  "gemini-2.5-flash": { inputUsdPerM: 0.3, outputUsdPerM: 2.5 },
  "gemini-2.5-flash-lite": { inputUsdPerM: 0.1, outputUsdPerM: 0.4 },
  // Antigravity / CLIProxy catalog id — priced as gemini flash class (estimate).
  "gemini-3-flash": { inputUsdPerM: 0.3, outputUsdPerM: 2.5 },
  "gemini-embedding-001": { inputUsdPerM: 0.15, outputUsdPerM: 0 },

  // OpenAI / OpenAI-compatible gateways
  "gpt-5.5": { inputUsdPerM: 1.25, outputUsdPerM: 10 },
  "gpt-5.4-mini": { inputUsdPerM: 0.25, outputUsdPerM: 2 },
  "text-embedding-3-small": { inputUsdPerM: 0.02, outputUsdPerM: 0 },

  // DeepSeek (official API) + OpenCode's free endpoint (priced 0 while free)
  "deepseek-v4-flash": { inputUsdPerM: 0.28, outputUsdPerM: 0.42 },
  "deepseek-v4-pro": { inputUsdPerM: 0.55, outputUsdPerM: 1.65 },
  "deepseek-v4-flash-free": { inputUsdPerM: 0, outputUsdPerM: 0 },
};

/** Strip an optional "provider:" prefix ("groq:openai/gpt-oss-120b" → bare id). */
export function bareModelId(model: string): string {
  const idx = model.lastIndexOf(":");
  return idx >= 0 ? model.slice(idx + 1) : model;
}

/** Exact price entry for a stored model string, or null when unknown. */
export function lookupModelPrice(model: string): ModelPrice | null {
  return (
    MODEL_PRICES[model] ?? MODEL_PRICES[bareModelId(model)] ?? null
  );
}

/**
 * Estimated USD cost of one usage bucket. Unknown models → 0 (call sites flag
 * them with findUnknownModels instead of guessing a price).
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = lookupModelPrice(model);
  if (!price) return 0;
  const usd =
    (Math.max(0, inputTokens) / 1_000_000) * price.inputUsdPerM +
    (Math.max(0, outputTokens) / 1_000_000) * price.outputUsdPerM;
  // Round to 1/10_000th cent — plenty for display, avoids float noise.
  return Math.round(usd * 100_000) / 100_000;
}

export interface UsageCostEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Sum estimated cost across usage rows (any granularity). */
export function estimateUsageCostUsd(entries: Iterable<UsageCostEntry>): number {
  let total = 0;
  for (const e of entries) {
    total += estimateCost(e.model, e.inputTokens, e.outputTokens);
  }
  return Math.round(total * 100_000) / 100_000;
}

/** Distinct model strings in `entries` that have no price-map entry. */
export function findUnknownModels(entries: Iterable<UsageCostEntry>): string[] {
  const unknown = new Set<string>();
  for (const e of entries) {
    if (!lookupModelPrice(e.model)) unknown.add(e.model);
  }
  return [...unknown].sort();
}
