import { createGoogleGenerativeAI, google } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { openai } from "@ai-sdk/openai";
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
 * LLM provider is chosen dynamically from AI_PROVIDER ("groq" | "google").
 * Three tiers:
 *  - ingestion: fast/cheap model (high-volume, runs on every memory)
 *  - reasoning: most capable model (Ask answer synthesis / decision mode)
 *  - fast: cheap/instant model for mechanical structured-output calls that run
 *    once or more PER ASK TURN (query understanding, rerank scoring). This tier
 *    MUST support json_schema structured outputs — that's why groq routes it to
 *    openai/gpt-oss-20b and NOT llama-3.1-8b-instant (which rejects json_schema).
 *
 * API keys may be a single value OR a comma-separated list per provider, e.g.
 *   GROQ_API_KEY="key_1,key_2,key_3"
 * When more than one key is present each tier automatically falls back to the
 * next key on a rate-limit / quota (429) error. With a single key there is no
 * wrapping and behaviour is identical to before.
 *
 * Embedding provider: openai (default) or google (EMBEDDING_PROVIDER=google).
 */

type Tier = "ingestion" | "reasoning" | "fast";

export const AI_PROVIDER = (process.env.AI_PROVIDER ?? "groq").toLowerCase() as
  | "groq"
  | "google";

/** Per-provider, per-tier model ids. Only json_schema-capable models on `fast`. */
const MODEL_IDS: Record<"groq" | "google", Record<Tier, string>> = {
  groq: {
    ingestion: "openai/gpt-oss-120b",
    reasoning: "openai/gpt-oss-120b",
    // gpt-oss-20b supports json_schema; llama-3.1-8b-instant does not.
    fast: "openai/gpt-oss-20b",
  },
  google: {
    // Pro models are quota-limited (limit 0) in this environment, so every tier
    // routes to the working gemini-2.5-flash (it natively supports json_schema).
    ingestion: "gemini-2.5-flash",
    reasoning: "gemini-2.5-flash",
    fast: "gemini-2.5-flash",
  },
};

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

  // Try each key in turn; retry only on rate-limit/quota errors.
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

  // Delegate every property (provider/modelId/supportedUrls are prototype
  // GETTERS — spreading would drop them and leave provider undefined) to the
  // primary model, overriding only the two call methods with key fallback.
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
  provider: "groq" | "google",
  modelId: string,
): (apiKey?: string) => LanguageModelV4 {
  if (provider === "google") {
    return (apiKey) =>
      createGoogleGenerativeAI({ apiKey })(modelId) as LanguageModelV4;
  }
  return (apiKey) =>
    createGroq({ apiKey, baseURL: "https://api.groq.com/openai/v1" })(
      modelId,
    ) as LanguageModelV4;
}

/** Resolve the model (with logging + optional key fallback) for a given tier. */
function buildTierModel(tier: Tier): LanguageModel {
  const provider = AI_PROVIDER in MODEL_IDS ? AI_PROVIDER : "groq";
  const modelId = MODEL_IDS[provider][tier];
  const keyEnv =
    provider === "google"
      ? process.env.GOOGLE_GENERATIVE_AI_API_KEY
      : process.env.GROQ_API_KEY;

  const keys = parseKeys(keyEnv);
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

export const embeddingModel: EmbeddingModel =
  EMBEDDING_PROVIDER === "google"
    ? google.textEmbedding("gemini-embedding-001")
    : openai.embedding("text-embedding-3-small");

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
  log.debug("Embedding Request", { model: EMBEDDING_PROVIDER, count: values.length });
  
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values,
    providerOptions: embeddingProviderOptions,
  });
  
  log.debug("Embedding Response", { latencyMs: Date.now() - startTime });
  return { embeddings };
}
