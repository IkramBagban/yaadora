import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { createGroq } from "@ai-sdk/groq";
import { embed, embedMany, type EmbeddingModel } from "ai";

type LanguageModelV4 = ReturnType<typeof anthropic>;

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  laps?: number;
}

async function withExponentialBackoff<T>(
  fn: () => PromiseLike<T>,
  { maxRetries, baseDelayMs }: { maxRetries: number; baseDelayMs: number },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

function customFallback(
  models: LanguageModelV4[],
  retryConfig: RetryConfig = { maxRetries: 2, baseDelayMs: 500, laps: 2 },
): LanguageModelV4 {
  const first = models[0];
  if (!first) {
    throw new Error("customFallback requires at least one model");
  }
  const { maxRetries, baseDelayMs, laps = 2 } = retryConfig;
  
  const fallbackModel = {
    specificationVersion: 'v4' as const,
    async doGenerate(options: Parameters<LanguageModelV4['doGenerate']>[0]) {
      let lastError: unknown;
      for (let lap = 0; lap < laps; lap++) {
        for (const model of models) {
          try {
            return await withExponentialBackoff(
              () => model.doGenerate(options),
              { maxRetries, baseDelayMs },
            );
          } catch (error) {
            lastError = error;
            console.error(`[Fallback] Model ${model.modelId} failed on lap ${lap + 1}:`, error);
          }
        }
      }
      throw lastError;
    },
    async doStream(options: Parameters<LanguageModelV4['doStream']>[0]) {
      let lastError: unknown;
      for (let lap = 0; lap < laps; lap++) {
        for (const model of models) {
          try {
            return await withExponentialBackoff(
              () => model.doStream(options),
              { maxRetries, baseDelayMs },
            );
          } catch (error) {
            lastError = error;
            console.error(`[Fallback] Model ${model.modelId} failed on lap ${lap + 1}:`, error);
          }
        }
      }
      throw lastError;
    },
  };

  return new Proxy(first, {
    get(target, prop, receiver) {
      if (prop === 'doGenerate') {
        return fallbackModel.doGenerate;
      }
      if (prop === 'doStream') {
        return fallbackModel.doStream;
      }
      if (prop === 'specificationVersion') {
        return 'v4';
      }
      return Reflect.get(target, prop, receiver);
    }
  }) as LanguageModelV4;
}

/**
 * The AI-SDK provider layer (spec 02 §1).
 *
 * This is the ONLY module in the monorepo that imports provider SDKs. Everything
 * else (server, worker, the rest of @repo/core) talks to the exported models.
 * Swapping Claude <-> Gemini is a config change only (AI_PROVIDER env).
 *
 * Two tiers:
 *  - ingestion: cheap, high-volume (runs on every memory forever — keep near-free).
 *  - reasoning: Ask / decision mode; default to the most capable model.
 */

const groq = createGroq({
  baseURL: "https://api.groq.com/openai/v1", // Note: The user mentioned "openai/gpt-oss-120b", so maybe OpenRouter or standard groq. Assuming standard groq with createGroq.
});

const REGISTRY = {
  anthropic: {
    ingestion: anthropic("claude-haiku-4-5-20251001"),
    reasoning: anthropic("claude-opus-4-8"), // or claude-sonnet-4-6 for cost
  },
  google: {
    ingestion: customFallback([
      google("gemini-2.5-flash"),
      groq("openai/gpt-oss-120b"),
    ]),
    reasoning: customFallback([
      google("gemini-2.5-flash"),
      groq("openai/gpt-oss-120b"),
    ]),
  },
  groq: {
    ingestion: groq("openai/gpt-oss-120b"),
    reasoning: groq("openai/gpt-oss-120b"),
  },
} as const;

const PROVIDER = (process.env.AI_PROVIDER ?? "anthropic") as keyof typeof REGISTRY;

export const ingestionModel = REGISTRY[PROVIDER].ingestion;
export const reasoningModel = REGISTRY[PROVIDER].reasoning;

/**
 * Embeddings need a dedicated provider (Anthropic ships none). Dimension is
 * FIXED at 1536 by the DB column, so both providers are pinned to 1536:
 *  - openai: text-embedding-3-small (natively 1536-d)
 *  - google: gemini-embedding-001 (default 3072-d, reduced to 1536 via
 *    Matryoshka `outputDimensionality`; passed at call time below)
 *
 * Embeddings from different models are NOT comparable — switching
 * EMBEDDING_PROVIDER means re-embedding everything (spec 02 §1, CONTEXT.md §4).
 * Defaults to openai unless EMBEDDING_PROVIDER=google.
 */
export const EMBEDDING_PROVIDER = (process.env.EMBEDDING_PROVIDER ??
  "openai") as "openai" | "google";

const EMBEDDING_DIMENSIONS = 1536;

export const embeddingModel: EmbeddingModel =
  EMBEDDING_PROVIDER === "google"
    ? google.textEmbedding("gemini-embedding-001")
    : openai.embedding("text-embedding-3-small");

// Per-call provider options. Gemini needs the dimensionality + a task type;
// SEMANTIC_SIMILARITY works symmetrically for both stored docs and queries so a
// single shared column stays valid. OpenAI needs nothing here.
const embeddingProviderOptions =
  EMBEDDING_PROVIDER === "google"
    ? {
        google: {
          outputDimensionality: EMBEDDING_DIMENSIONS,
          taskType: "SEMANTIC_SIMILARITY",
        },
      }
    : undefined;

/** Embed one string. Returns `{ embedding }` (same shape as the AI SDK). */
export async function embedText(value: string): Promise<{ embedding: number[] }> {
  const { embedding } = await embed({
    model: embeddingModel,
    value,
    providerOptions: embeddingProviderOptions,
  });
  return { embedding };
}

/** Embed many strings in one call. Returns `{ embeddings }`. */
export async function embedTexts(
  values: string[],
): Promise<{ embeddings: number[][] }> {
  if (values.length === 0) return { embeddings: [] };
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values,
    providerOptions: embeddingProviderOptions,
  });
  return { embeddings };
}

export const AI_PROVIDER = PROVIDER;
