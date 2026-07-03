import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";

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
const REGISTRY = {
  anthropic: {
    ingestion: anthropic("claude-haiku-4-5-20251001"),
    reasoning: anthropic("claude-opus-4-8"), // or claude-sonnet-4-6 for cost
  },
  google: {
    ingestion: google("gemini-flash-latest"),
    reasoning: google("gemini-pro-latest"),
  },
} as const;

const PROVIDER = (process.env.AI_PROVIDER ?? "anthropic") as keyof typeof REGISTRY;

export const ingestionModel = REGISTRY[PROVIDER].ingestion;
export const reasoningModel = REGISTRY[PROVIDER].reasoning;

/**
 * Embeddings need a dedicated provider (Anthropic ships none). Dimension is
 * FIXED at 1536 by the DB column — changing this model is a re-embedding
 * migration (spec 02 §1, CONTEXT.md §4).
 */
export const embeddingModel = openai.embedding("text-embedding-3-small"); // 1536-d

export const AI_PROVIDER = PROVIDER;
