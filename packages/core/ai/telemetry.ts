import { type LanguageModelMiddleware } from "ai";
import { createLogger } from "@repo/logger";
import { parseUsage, recordUsageEvent } from "./usage-tracker";

const log = createLogger("ai");

export interface LoggerMiddlewareOptions {
  /** ingestion | reasoning | fast — used for token rollups */
  tier?: string;
}

/**
 * Middleware to intercept and log all interactions with the Vercel AI SDK language models.
 * Logs latency and records token usage into the shared Redis tracker (for eval).
 */
export function createLoggerMiddleware(
  modelId: string,
  opts: LoggerMiddlewareOptions = {},
): LanguageModelMiddleware {
  const tier = opts.tier ?? "unknown";

  return {
    wrapGenerate: async ({ doGenerate, params }) => {
      const startTime = Date.now();
      log.debug("LLM Generate Request", {
        model: modelId,
        tier,
        // Avoid dumping full prompts at info level — debug only.
        promptMessages: Array.isArray((params as any)?.prompt)
          ? (params as any).prompt.length
          : undefined,
      });

      try {
        const result = await doGenerate();
        const latencyMs = Date.now() - startTime;
        const usage = parseUsage((result as any)?.usage);

        log.debug("LLM Generate Response", {
          model: modelId,
          tier,
          latencyMs,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
        });

        void recordUsageEvent({
          model: modelId,
          tier,
          operation: "generate",
          ...usage,
          latencyMs,
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
        tier,
        promptMessages: Array.isArray((params as any)?.prompt)
          ? (params as any).prompt.length
          : undefined,
      });

      try {
        const result = await doStream();

        log.debug("LLM Stream Started", {
          model: modelId,
          tier,
          latencyToFirstChunkMs: Date.now() - startTime,
        });

        // Tee usage off the finish part without consuming the consumer stream.
        const [forUsage, forConsumer] = result.stream.tee();

        void (async () => {
          const reader = forUsage.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value && (value as any).type === "finish") {
                const usage = parseUsage((value as any).usage);
                const latencyMs = Date.now() - startTime;
                log.debug("LLM Stream Finish", {
                  model: modelId,
                  tier,
                  latencyMs,
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  totalTokens: usage.totalTokens,
                });
                void recordUsageEvent({
                  model: modelId,
                  tier,
                  operation: "stream",
                  ...usage,
                  latencyMs,
                });
              }
            }
          } catch {
            /* usage best-effort */
          } finally {
            try {
              reader.releaseLock();
            } catch {
              /* ignore */
            }
          }
        })();

        return {
          ...result,
          stream: forConsumer,
        };
      } catch (error) {
        log.error("LLM Stream Error", error as Error);
        throw error;
      }
    },
  };
}
