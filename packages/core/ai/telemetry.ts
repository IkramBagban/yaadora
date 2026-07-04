import { type LanguageModelMiddleware } from "ai";
import { createLogger } from "@repo/logger";

const log = createLogger("ai");

/**
 * Middleware to intercept and log all interactions with the Vercel AI SDK language models.
 * Logs what the user asked, what the model called, and its response/token usage.
 */
export function createLoggerMiddleware(modelId: string): LanguageModelMiddleware {
  return {
    wrapGenerate: async ({ doGenerate, params }) => {
      const startTime = Date.now();
      log.debug("LLM Generate Request", {
        model: modelId,
        params,
      });

      try {
        const result = await doGenerate();
        const latencyMs = Date.now() - startTime;
        
        log.debug("LLM Generate Response", {
          model: modelId,
          latencyMs,
          result,
        });
        
        return result;
      } catch (error) {
        log.error("LLM Generate Error", error as Error);
        throw error;
      }
    },

    wrapStream: async ({ doStream, params }) => {
      const startTime = Date.now();
      log.debug("LLM Stream Request", {
        model: modelId,
        params,
      });

      try {
        const result = await doStream();
        
        log.debug("LLM Stream Started", {
          model: modelId,
          latencyToFirstChunkMs: Date.now() - startTime,
        });

        return result;
      } catch (error) {
        log.error("LLM Stream Error", error as Error);
        throw error;
      }
    },
  };
}
