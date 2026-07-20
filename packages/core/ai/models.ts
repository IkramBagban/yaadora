import { createGoogleGenerativeAI, google } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import {
  embed,
  embedMany,
  type EmbeddingModel,
  type LanguageModel,
  wrapLanguageModel,
} from "ai";
import { createLoggerMiddleware } from "./telemetry";
import { createLogger } from "@repo/logger";

const log = createLogger("ai");

/**
 * LLM provider is chosen dynamically from AI_PROVIDER:
 *   "groq" | "google" | "openai" | "antigravity"
 *
 * Prod default stays "groq". Local subsidized models go through CLIProxyAPI:
 *   AI_PROVIDER=openai        # ChatGPT/Codex GPT models
 *   AI_PROVIDER=antigravity   # Google Antigravity Gemini models
 *   OPENAI_BASE_URL=http://127.0.0.1:8317/v1
 *   OPENAI_API_KEY=<local proxy key>
 * Leave OPENAI_BASE_URL unset with AI_PROVIDER=openai to hit real OpenAI API.
 *
 * Three tiers:
 *  - ingestion: high-volume (runs on every memory)
 *  - reasoning: most capable (Ask answer synthesis / decision mode)
 *  - fast: structured-output calls per ask turn (must support json_schema)
 *
 * Optional per-tier overrides (any provider):
 *   AI_MODEL_INGESTION / AI_MODEL_REASONING / AI_MODEL_FAST
 *
 * API keys may be a single value OR a comma-separated list, e.g.
 *   GROQ_API_KEY="key_1,key_2,key_3"
 * When more than one key is present each tier falls back on 429 / quota errors.
 *
 * Embedding provider is independent: openai (default) or google
 * (EMBEDDING_PROVIDER=google). Chat OPENAI_BASE_URL never routes embeddings —
 * embeddings use the official OpenAI host unless OPENAI_EMBEDDING_BASE_URL is set.
 */

type Provider = "groq" | "google" | "openai" | "antigravity";
type Tier = "ingestion" | "reasoning" | "fast";

const PROVIDERS: readonly Provider[] = [
  "groq",
  "google",
  "openai",
  "antigravity",
] as const;

function parseProvider(raw: string | undefined): Provider {
  const value = (raw ?? "groq").toLowerCase();
  return (PROVIDERS as readonly string[]).includes(value)
    ? (value as Provider)
    : "groq";
}

export const AI_PROVIDER: Provider = parseProvider(process.env.AI_PROVIDER);

/** Per-provider, per-tier model ids. Only json_schema-capable models on `fast`. */
const MODEL_IDS: Record<Provider, Record<Tier, string>> = {
  groq: {
    ingestion: "openai/gpt-oss-120b",
    reasoning: "openai/gpt-oss-120b",
    // 120b everywhere (per founder, 2026-07-18): the fast tier also runs the
    // larger model so structured-output judgment matches the reasoning tier.
    fast: "openai/gpt-oss-120b",
  },
  google: {
    // Pro models are quota-limited (limit 0) in this environment, so every tier
    // routes to the working gemini-2.5-flash (it natively supports json_schema).
    ingestion: "gemini-2.5-flash",
    reasoning: "gemini-2.5-flash",
    fast: "gemini-2.5-flash",
  },
  // OpenAI / OpenAI-compatible (CLIProxyAPI, official API, gateways).
  // Defaults target GPT frontier IDs exposed by local CLIProxyAPI.
  openai: {
    ingestion: "gpt-5.4-mini",
    reasoning: "gpt-5.5",
    fast: "gpt-5.4-mini",
  },
  // Google Antigravity subscription via CLIProxyAPI (OpenAI-compatible endpoint).
  // Model ids must match CLIProxy's catalog (gemini-3.x…).
  // Prefer pro/flash (not flash-lite) for structured generateObject — lite often
  // ignores json_schema and returns markdown fences / invalid enums.
  antigravity: {
    ingestion: "gemini-3.1-pro-low",
    reasoning: "gemini-3.1-pro-low",
    fast: "gemini-3-flash",
  },
};

const TIER_ENV: Record<Tier, string> = {
  ingestion: "AI_MODEL_INGESTION",
  reasoning: "AI_MODEL_REASONING",
  fast: "AI_MODEL_FAST",
};

function resolveModelId(provider: Provider, tier: Tier): string {
  const override = process.env[TIER_ENV[tier]]?.trim();
  if (override) return override;
  return MODEL_IDS[provider][tier];
}

/** Split a comma-separated key list into trimmed, non-empty keys. */
function parseKeys(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

/** True for rate-limit / quota-exhausted errors worth retrying on another key. */
function isRateLimitError(err: unknown): boolean {
  const e = err as { statusCode?: number; status?: number; message?: string };
  if (e?.statusCode === 429 || e?.status === 429) return true;
  const msg = String(e?.message ?? err).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("rate-limit") ||
    msg.includes("quota") ||
    msg.includes("resource_exhausted") ||
    msg.includes("too many requests")
  );
}

/**
 * Wrap an array of equivalent models (same model id, different API keys) so that
 * a 429 on one transparently retries the request on the next. Non-rate-limit
 * errors propagate immediately. A single model is returned untouched.
 */
function withKeyFallback(models: LanguageModelV4[]): LanguageModelV4 {
  if (models.length <= 1) return models[0]!;
  const primary = models[0]!;

  const attempt = async <T>(
    call: (model: LanguageModelV4) => PromiseLike<T>,
  ): Promise<T> => {
    let lastErr: unknown;
    for (const model of models) {
      try {
        return await call(model);
      } catch (err) {
        if (!isRateLimitError(err)) throw err;
        lastErr = err;
        log.warn("Model key rate-limited, falling back to next key", {
          modelId: model.modelId,
        });
      }
    }
    throw lastErr;
  };

  return new Proxy(primary, {
    get(target, prop, receiver) {
      if (prop === "doGenerate") {
        return (options: Parameters<LanguageModelV4["doGenerate"]>[0]) =>
          attempt((m) => m.doGenerate(options));
      }
      if (prop === "doStream") {
        return (options: Parameters<LanguageModelV4["doStream"]>[0]) =>
          attempt((m) => m.doStream(options));
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/** Build a factory that turns an API key into a model for the active provider. */
function makeModelFactory(
  provider: Provider,
  modelId: string,
): (apiKey?: string) => LanguageModelV4 {
  if (provider === "google") {
    return (apiKey) =>
      createGoogleGenerativeAI({ apiKey })(modelId) as LanguageModelV4;
  }
  if (provider === "openai" || provider === "antigravity") {
    // Both use OpenAI-compatible HTTP. Antigravity requires OPENAI_BASE_URL
    // (CLIProxyAPI). OpenAI can omit it to hit api.openai.com.
    const baseURL = process.env.OPENAI_BASE_URL?.trim() || undefined;
    if (provider === "antigravity" && !baseURL) {
      log.warn(
        "AI_PROVIDER=antigravity but OPENAI_BASE_URL is unset — set it to CLIProxyAPI (e.g. http://127.0.0.1:8317/v1)",
      );
    }
    return (apiKey) =>
      createOpenAI({ apiKey, baseURL })(modelId) as LanguageModelV4;
  }
  return (apiKey) =>
    createGroq({ apiKey, baseURL: "https://api.groq.com/openai/v1" })(
      modelId,
    ) as LanguageModelV4;
}

function keyEnvFor(provider: Provider): string | undefined {
  if (provider === "google") return process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  // openai + antigravity both auth to CLIProxy / OpenAI-compatible with OPENAI_API_KEY
  if (provider === "openai" || provider === "antigravity") {
    return process.env.OPENAI_API_KEY;
  }
  return process.env.GROQ_API_KEY;
}

/** Resolve the model (with logging + optional key fallback) for a given tier. */
function buildTierModel(tier: Tier): LanguageModel {
  const provider = AI_PROVIDER;
  const modelId = resolveModelId(provider, tier);
  const keys = parseKeys(keyEnvFor(provider));
  const factory = makeModelFactory(provider, modelId);

  // No key configured → let the SDK read its own default env var (single key).
  const models =
    keys.length > 0 ? keys.map((key) => factory(key)) : [factory(undefined)];

  return wrapLanguageModel({
    model: withKeyFallback(models),
    middleware: createLoggerMiddleware(`${provider}:${modelId}`),
  });
}

export const ingestionModel = buildTierModel("ingestion");
export const reasoningModel = buildTierModel("reasoning");
export const fastModel = buildTierModel("fast");

export const EMBEDDING_PROVIDER = (process.env.EMBEDDING_PROVIDER ??
  "openai") as "openai" | "google";

const EMBEDDING_DIMENSIONS = 1536;

// Keep embeddings off the chat proxy. Official OpenAI host unless explicitly overridden.
const embeddingOpenAI = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL:
    process.env.OPENAI_EMBEDDING_BASE_URL?.trim() ||
    "https://api.openai.com/v1",
});

export const embeddingModel: EmbeddingModel =
  EMBEDDING_PROVIDER === "google"
    ? google.textEmbedding("gemini-embedding-001")
    : embeddingOpenAI.embedding("text-embedding-3-small");

const embeddingProviderOptions =
  EMBEDDING_PROVIDER === "google"
    ? {
        google: {
          outputDimensionality: EMBEDDING_DIMENSIONS,
          taskType: "SEMANTIC_SIMILARITY",
        },
      }
    : undefined;

export async function embedText(value: string): Promise<{ embedding: number[] }> {
  const startTime = Date.now();
  log.debug("Embedding Request", { model: EMBEDDING_PROVIDER, count: 1 });

  const { embedding } = await embed({
    model: embeddingModel,
    value,
    providerOptions: embeddingProviderOptions,
  });

  log.debug("Embedding Response", { latencyMs: Date.now() - startTime });
  return { embedding };
}

export async function embedTexts(
  values: string[],
): Promise<{ embeddings: number[][] }> {
  if (values.length === 0) return { embeddings: [] };

  const startTime = Date.now();
  log.debug("Embedding Request", {
    model: EMBEDDING_PROVIDER,
    count: values.length,
  });

  const { embeddings } = await embedMany({
    model: embeddingModel,
    values,
    providerOptions: embeddingProviderOptions,
  });

  log.debug("Embedding Response", { latencyMs: Date.now() - startTime });
  return { embeddings };
}
