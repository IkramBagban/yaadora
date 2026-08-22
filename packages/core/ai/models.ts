import { createGoogleGenerativeAI, google } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV4, LanguageModelV4CallOptions } from "@ai-sdk/provider";
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
 *   "groq" | "google" | "openai" | "antigravity" | "opencode" | "deepseek"
 *
 * Prod default stays "groq". Local subsidized models go through CLIProxyAPI:
 *   AI_PROVIDER=openai        # ChatGPT/Codex GPT models
 *   AI_PROVIDER=antigravity   # Google Antigravity Gemini models
 *   AI_PROVIDER=opencode      # OpenCode free DeepSeek V4 Flash for local/eval use
 *   AI_PROVIDER=deepseek      # DeepSeek's official OpenAI-compatible API
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

type Provider =
  | "groq"
  | "google"
  | "openai"
  | "antigravity"
  | "opencode"
  | "deepseek";
type Tier = "ingestion" | "reasoning" | "fast";

const PROVIDERS: readonly Provider[] = [
  "groq",
  "google",
  "openai",
  "antigravity",
  "opencode",
  "deepseek",
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
  // Flash for speed (evals + high-volume ingestion). Prefer flash over flash-lite:
  // lite often ignores json_schema and returns markdown fences / invalid enums.
  // Override with AI_MODEL_* env if you need pro for hard Ask turns.
  antigravity: {
    ingestion: "gemini-3-flash",
    reasoning: "gemini-3-flash",
    fast: "gemini-3-flash",
  },
  // OpenCode's free DeepSeek V4 Flash model. This is intended for local
  // development/evals and may be discontinued or rate-limited by OpenCode.
  opencode: {
    ingestion: "deepseek-v4-flash-free",
    reasoning: "deepseek-v4-flash-free",
    fast: "deepseek-v4-flash-free",
  },
  // Official DeepSeek API (api.deepseek.com). Default all tiers to V4 Flash —
  // the real paid model, not OpenCode's free flash and not the legacy
  // deepseek-chat id. Override per tier if needed, e.g.:
  //   AI_MODEL_REASONING=deepseek-v4-pro
  deepseek: {
    ingestion: "deepseek-v4-flash",
    reasoning: "deepseek-v4-flash",
    fast: "deepseek-v4-flash",
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

/**
 * DeepSeek's chat-completions API currently accepts JSON-object mode but can
 * reject OpenAI's `json_schema` response format. AI SDK's structured-output
 * helpers normally send a schema in that format. Convert it to JSON-object
 * mode and place the same schema in a system instruction, so `generateObject`
 * still validates the final object locally without an initial failing request.
 */
const deepSeekJsonObjectMiddleware = {
  specificationVersion: "v4" as const,
  transformParams: async ({
    params,
  }: {
    params: LanguageModelV4CallOptions;
  }): Promise<LanguageModelV4CallOptions> => {
    if (params.responseFormat?.type !== "json" || !params.responseFormat.schema) {
      return params;
    }

    const schemaInstruction =
      "Return only a valid JSON object that conforms to this JSON Schema. " +
      "Do not include markdown, explanations, or additional keys.\n\n" +
      JSON.stringify(params.responseFormat.schema);

    return {
      ...params,
      // No schema here makes @ai-sdk/openai emit { type: "json_object" }.
      responseFormat: { type: "json" },
      prompt: [
        {
          role: "system",
          content: schemaInstruction,
        },
        ...params.prompt,
      ],
    };
  },
};

/** Build a factory that turns an API key into a model for the active provider. */
function makeModelFactory(
  provider: Provider,
  modelId: string,
): (apiKey?: string) => LanguageModelV4 {
  if (provider === "google") {
    return (apiKey) =>
      createGoogleGenerativeAI({ apiKey })(modelId) as LanguageModelV4;
  }
  if (
    provider === "openai" ||
    provider === "antigravity" ||
    provider === "opencode" ||
    provider === "deepseek"
  ) {
    // These providers use OpenAI-compatible HTTP. OpenCode's free endpoint is
    // public and keyless for now, but accepts OPENAI_API_KEY/OPENCODE_API_KEY
    // when credentials are required.
    // DeepSeek must not inherit OPENAI_BASE_URL: local development often
    // points that variable at CLIProxyAPI for other providers. Keep its
    // official endpoint independent, with a dedicated override for a proxy.
    const baseURL =
      provider === "deepseek"
        ? process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com/v1"
        : process.env.OPENAI_BASE_URL?.trim() ||
          (provider === "opencode" ? "https://opencode.ai/zen/v1" : undefined);
    if (provider === "antigravity" && !baseURL) {
      log.warn(
        "AI_PROVIDER=antigravity but OPENAI_BASE_URL is unset — set it to CLIProxyAPI (e.g. http://127.0.0.1:8317/v1)",
      );
    }
    return (apiKey) => {
      // OpenCode's free endpoint currently accepts keyless requests. The
      // OpenAI SDK requires a key value, so provide a placeholder and strip
      // the generated Authorization header unless a real key was supplied.
      const keylessOpenCode = provider === "opencode" && !apiKey;
      const effectiveApiKey = keylessOpenCode ? "opencode-free" : apiKey;
      const fetchWithoutAuth = keylessOpenCode
        ? async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
            const headers = new Headers(init?.headers);
            headers.delete("authorization");
            return fetch(input, { ...init, headers });
          }
        : undefined;
      const client = createOpenAI({
        apiKey: effectiveApiKey,
        baseURL,
        fetch: fetchWithoutAuth as typeof fetch,
      });
      // OpenCode free models expose /chat/completions, not /responses.
      // OpenCode and DeepSeek expose OpenAI-compatible chat completions. Do
      // not use the Responses API here: DeepSeek's official compatibility API
      // is chat-completions based.
      return (provider === "opencode" || provider === "deepseek"
        ? client.chat(modelId)
        : client(modelId)) as LanguageModelV4;
    };
  }
  return (apiKey) =>
    createGroq({ apiKey, baseURL: "https://api.groq.com/openai/v1" })(
      modelId,
    ) as LanguageModelV4;
}

function keyEnvFor(provider: Provider): string | undefined {
  if (provider === "google") return process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (provider === "opencode") {
    return process.env.OPENCODE_API_KEY || process.env.OPENAI_API_KEY;
  }
  if (provider === "deepseek") return process.env.DEEPSEEK_API_KEY;
  // openai + antigravity auth to CLIProxy / OpenAI-compatible with OPENAI_API_KEY
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

  const baseModel = withKeyFallback(models);
  const compatibleModel =
    provider === "deepseek"
      ? wrapLanguageModel({
          model: baseModel,
          middleware: deepSeekJsonObjectMiddleware,
        })
      : baseModel;

  return wrapLanguageModel({
    model: compatibleModel,
    middleware: createLoggerMiddleware(`${provider}:${modelId}`, { tier }),
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
