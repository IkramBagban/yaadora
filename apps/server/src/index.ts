import { createLogger, initLogging } from "@repo/logger";
import {
  bindBootstrapUser,
  isAuthConfigured,
  isBootstrapAllowed,
  isClerkConfigured,
} from "./auth";
import { ensureBootstrapUser } from "./seed";
import { notFound, serverError } from "./http";
import {
  createMemory,
  listMemories,
  getMemoryDetail,
  patchMemoryPinned,
} from "./routes/memories";
import { health } from "./routes/health";
import { ask } from "./routes/ask";
import {
  createConversation,
  listConversations,
  postConversationTurn,
} from "./routes/conversations";
import {
  listSurfacings,
  getSurfacingEvidence,
  postSurfacingReaction,
} from "./routes/surfacings";
import { registerPushToken } from "./routes/push-tokens";
import {
  getPrivacySettings,
  patchPrivacySettings,
} from "./routes/settings";
import { listRules, patchRule } from "./routes/rules";
import {
  getEntityContext,
  flagEntityEdgeRoute,
  listEntities,
} from "./routes/entities";
import {
  confirmReminder,
  confirmSuggestedReminder,
  completeReminder,
  updateReminder,
  listReminders,
  cancelReminder,
} from "./routes/reminders";
import { getMe, patchMe } from "./routes/me";
import { transcribe } from "./routes/transcribe";
// Backend-gaps wave (web app support).
import { preflight, withCors } from "./cors";
import { getGraphSnapshotRoute } from "./routes/graph";
import {
  getStatsOverviewRoute,
  getStatsTimeseriesRoute,
} from "./routes/stats";
import { listFactsRoute, patchFactRoute } from "./routes/facts-admin";
import {
  createOpenLoopRoute,
  listOpenLoopsRoute,
  patchOpenLoopRoute,
} from "./routes/open-loops";
import { searchMemoriesRoute } from "./routes/search";
import { listDigests } from "./routes/digests";
import { postEntitiesMerge } from "./routes/entities-merge";
import { getSurfacingsSummaryRoute } from "./routes/surfacings-summary";
import { testRuleRoute } from "./routes/rules-test";

// Declare this process's log target FIRST — every log line (including those
// emitted deep inside @repo/core) is written to logs/server.log in development.
initLogging("server");
const log = createLogger("server");

/**
 * apps/server — the Yaadora HTTP API (spec 01 §2, spec 03 §1).
 *
 * Auth: Clerk session JWTs (primary). Optional bootstrap bearer only when
 * AUTH_ALLOW_BOOTSTRAP=true for local seed/eval.
 *
 * Run: `bun run src/index.ts` (or `bun run dev` for hot reload).
 */

const PORT = Number(process.env.PORT ?? "3000");

/**
 * Route table. Every handler is CORS-wrapped below so allowlisted web origins
 * (WEB_ORIGINS) receive ACAO headers on real responses; OPTIONS preflights
 * fall through to `fetch` and are answered there.
 */
type Handler = (
  req: Request & { params: Record<string, string> },
) => Promise<Response> | Response;

function corsify(
  routes: Record<string, Record<string, Handler>>,
): Record<string, Record<string, Handler>> {
  const out: Record<string, Record<string, Handler>> = {};
  for (const [path, methods] of Object.entries(routes)) {
    out[path] = Object.fromEntries(
      Object.entries(methods).map(([method, handler]) => [
        method,
        async (req: Request & { params: Record<string, string> }) =>
          withCors(req, await handler(req)),
      ]),
    );
  }
  return out;
}

const routeTable: Record<string, Record<string, Handler>> = {
  "/health": { GET: () => health() },
  "/me": {
    GET: (req) => getMe(req),
    PATCH: (req) => patchMe(req),
  },
  "/memories": {
    POST: (req) => createMemory(req),
    GET: (req) => listMemories(req),
  },
  // Static segments win over :params in Bun's router.
  "/memories/search": {
    GET: (req) => searchMemoriesRoute(req),
  },
  "/memories/:id": {
    GET: (req) => getMemoryDetail(req, req.params.id!),
    PATCH: (req) => patchMemoryPinned(req, req.params.id!),
  },
  "/ask": {
    POST: (req) => ask(req),
  },
  // Speech-to-text. Stateless: audio in, text out, nothing stored.
  "/transcribe": {
    POST: (req) => transcribe(req),
  },
  // Durable conversations (spec 02 §8, P0 item 2)
  "/conversations": {
    POST: (req) => createConversation(req),
    GET: (req) => listConversations(req),
  },
  "/conversations/:id/turns": {
    POST: (req) => postConversationTurn(req, req.params.id!),
  },
  "/surfacings": {
    GET: (req) => listSurfacings(req),
  },
  "/surfacings/summary": {
    GET: (req) => getSurfacingsSummaryRoute(req),
  },
  "/surfacings/:id/evidence": {
    GET: (req) => getSurfacingEvidence(req, req.params.id!),
  },
  "/surfacings/:id/reaction": {
    POST: (req) => postSurfacingReaction(req, req.params.id!),
  },
  // Entity pages / graph doorway (spec 02 §8, P3)
  "/entities": {
    GET: (req) => listEntities(req),
  },
  "/entities/merge": {
    POST: (req) => postEntitiesMerge(req),
  },
  "/entities/:id/context": {
    GET: (req) => getEntityContext(req, req.params.id!),
  },
  "/entities/edges/:id/flag": {
    POST: (req) => flagEntityEdgeRoute(req, req.params.id!),
  },
  "/graph/snapshot": {
    GET: (req) => getGraphSnapshotRoute(req),
  },
  "/stats/overview": {
    GET: (req) => getStatsOverviewRoute(req),
  },
  "/stats/timeseries": {
    GET: (req) => getStatsTimeseriesRoute(req),
  },
  "/facts": {
    GET: (req) => listFactsRoute(req),
  },
  "/facts/:id": {
    PATCH: (req) => patchFactRoute(req, req.params.id!),
  },
  "/open-loops": {
    GET: (req) => listOpenLoopsRoute(req),
    POST: (req) => createOpenLoopRoute(req),
  },
  "/open-loops/:id": {
    PATCH: (req) => patchOpenLoopRoute(req, req.params.id!),
  },
  "/digests": {
    GET: (req) => listDigests(req),
  },
  // Standing rules (spec 02 §8, P1)
  "/rules": {
    GET: (req) => listRules(req),
  },
  "/rules/:id": {
    PATCH: (req) => patchRule(req, req.params.id!),
  },
  "/rules/:id/test": {
    POST: (req) => testRuleRoute(req, req.params.id!),
  },
  "/push-tokens": {
    POST: (req) => registerPushToken(req),
  },
  "/settings/privacy": {
    GET: (req) => getPrivacySettings(req),
    PATCH: (req) => patchPrivacySettings(req),
  },
  "/reminders": {
    GET: (req) => listReminders(req),
  },
  "/reminders/confirm": {
    POST: (req) => confirmReminder(req),
  },
  "/reminders/:id/confirm": {
    POST: (req) => confirmSuggestedReminder(req, req.params.id!),
  },
  "/reminders/:id/complete": {
    POST: (req) => completeReminder(req, req.params.id!),
  },
  "/reminders/:id": {
    PATCH: (req) => updateReminder(req, req.params.id!),
    DELETE: (req) => cancelReminder(req, req.params.id!),
  },
};

log.info("auth config at boot", {
  clerkConfigured: isClerkConfigured(),
  clerkSecretKeyLen: process.env.CLERK_SECRET_KEY?.length ?? 0,
  clerkPublishableKeyLen: process.env.CLERK_PUBLISHABLE_KEY?.length ?? 0,
  clerkJwtKeySet: Boolean(process.env.CLERK_JWT_KEY),
  bootstrapAllowed: isBootstrapAllowed(),
  bootstrapTokenSet: Boolean(process.env.AUTH_BOOTSTRAP_TOKEN),
  port: PORT,
  nodeEnv: process.env.NODE_ENV ?? null,
});

if (!isAuthConfigured()) {
  log.warn(
    "Neither CLERK_SECRET_KEY nor bootstrap auth is configured — protected routes will return 401.",
  );
} else if (!isClerkConfigured()) {
  log.warn(
    "CLERK_SECRET_KEY is not set — only bootstrap auth (if enabled) will work.",
  );
}

if (isBootstrapAllowed()) {
  const userId = await ensureBootstrapUser();
  bindBootstrapUser(userId);
  log.info("bootstrap auth enabled (dev/eval only)", { userId });
} else {
  log.info("bootstrap auth disabled — Clerk JWTs only");
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 60, // 60 seconds (prevents timeout on slow LLM reasoning)
  routes: corsify(routeTable),
  // Unmatched routes. CORS preflights land here (OPTIONS is never a declared
  // route method) — answer them before the 404.
  async fetch(req) {
    const pre = preflight(req);
    if (pre) return pre;
    log.warn("route not found", {
      method: req.method,
      path: new URL(req.url).pathname,
    });
    return notFound("Route not found.");
  },
  error(err) {
    log.error("unhandled error", err);
    return serverError();
  },
});

log.info("listening", { url: `http://localhost:${server.port}` });
