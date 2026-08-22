import { createLogger } from "@repo/logger";

const log = createLogger("server:cors");

/**
 * CORS for Bun.serve (backend-gaps wave).
 *
 * Origin allowlist from WEB_ORIGINS (comma-separated), e.g.
 *   WEB_ORIGINS="http://localhost:5173,https://app.yaadora.com"
 * Empty/unset → no origin is allowed (mobile apps and same-origin callers are
 * unaffected by CORS anyway).
 *
 * Bun.serve has no middleware: every matched route bypasses `fetch`, so
 *   - responses get headers via `withCors` (applied to each handler in index.ts)
 *   - OPTIONS preflights fall through to `fetch` → answered by `preflight`.
 */

const allowedOrigins = (process.env.WEB_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (allowedOrigins.length) {
  log.info("cors allowlist loaded", { origins: allowedOrigins });
}

export function isOriginAllowed(origin: string | null): boolean {
  return origin != null && allowedOrigins.includes(origin);
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

/**
 * Attach CORS headers to a response when the request's Origin is allowlisted;
 * otherwise return the response untouched.
 */
export function withCors(req: Request, res: Response): Response {
  const origin = req.headers.get("origin");
  if (!isOriginAllowed(origin)) return res;

  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin!))) headers.set(k, v);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/** Handle an OPTIONS preflight; returns null for non-preflight requests. */
export function preflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  const origin = req.headers.get("origin");
  // No ACAO header on disallowed origins — the browser blocks the request.
  if (!isOriginAllowed(origin)) return new Response(null, { status: 204 });
  return new Response(null, { status: 204, headers: corsHeaders(origin!) });
}
