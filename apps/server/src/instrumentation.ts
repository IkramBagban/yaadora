import {
  getRequestUserId,
  runInRequestContext,
} from "@repo/core";
import {
  insertApiRequest,
  pingUserActivity,
} from "@repo/db";
import { createLogger } from "@repo/logger";

const log = createLogger("server:instrumentation");

/**
 * Request instrumentation (issue #30) — one choke point around every routed
 * handler:
 *
 *   1. Runs the handler inside the per-request usage context so auth can bind
 *      the resolved user and every LLM call below attributes to them.
 *   2. After the response, fire-and-forget writes:
 *        - `api_requests` row (method/path/status/latency; user_id NULL when
 *          unauthenticated) — ~90d retention intent, prune later.
 *        - `user_activity_days.requests + 1` when authenticated (streaks/DAU).
 *
 * /health is skipped: liveness probes would drown real traffic. Tracking
 * failures are logged and swallowed — they must never affect the response.
 */

/** Paths excluded from activity pings and request logging. */
const SKIP_PATHS = new Set(["/health"]);

function requestPath(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return "?";
  }
}

async function logRequest(params: {
  userId: string | null;
  method: string;
  path: string;
  status: number;
  durationMs: number;
}): Promise<void> {
  const { userId, method, path, status, durationMs } = params;
  try {
    await insertApiRequest({ userId, method, path, status, durationMs });
    if (userId) await pingUserActivity(userId);
  } catch (err) {
    log.warn("request instrumentation write failed", {
      method,
      path,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

type Handler = (
  req: Request & { params: Record<string, string> },
) => Promise<Response> | Response;

/**
 * Wrap a route handler with the usage context + post-response tracking.
 */
export function instrumented(handler: Handler): Handler {
  return async (
    req: Request & { params: Record<string, string> },
  ): Promise<Response> => {
    const started = Date.now();
    const res = await runInRequestContext(() => handler(req));
    if (!SKIP_PATHS.has(requestPath(req))) {
      void logRequest({
        userId: getRequestUserId(),
        method: req.method,
        path: requestPath(req),
        status: res.status,
        durationMs: Date.now() - started,
      });
    }
    return res;
  };
}
