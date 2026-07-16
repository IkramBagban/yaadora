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
} from "./routes/memories";
import { health } from "./routes/health";
import { ask } from "./routes/ask";
import {
  createConversation,
  listConversations,
  postConversationTurn,
} from "./routes/conversations";
import { postSurfacingReaction } from "./routes/surfacings";
import { registerPushToken } from "./routes/push-tokens";
import {
  getPrivacySettings,
  patchPrivacySettings,
} from "./routes/settings";
import { listRules, patchRule } from "./routes/rules";
import {
  confirmReminder,
  confirmSuggestedReminder,
  completeReminder,
  updateReminder,
  listReminders,
  cancelReminder,
} from "./routes/reminders";
import { getMe, patchMe } from "./routes/me";

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
  routes: {
    "/health": { GET: () => health() },
    "/me": {
      GET: (req) => getMe(req),
      PATCH: (req) => patchMe(req),
    },
    "/memories": {
      POST: (req) => createMemory(req),
      GET: (req) => listMemories(req),
    },
    "/memories/:id": {
      GET: (req) => getMemoryDetail(req, req.params.id),
    },
    "/ask": {
      POST: (req) => ask(req),
    },
    // Durable conversations (spec 02 §8, P0 item 2)
    "/conversations": {
      POST: (req) => createConversation(req),
      GET: (req) => listConversations(req),
    },
    "/conversations/:id/turns": {
      POST: (req) => postConversationTurn(req, req.params.id),
    },
    "/surfacings/:id/reaction": {
      POST: (req) => postSurfacingReaction(req, req.params.id),
    },
    // Standing rules (spec 02 §8, P1)
    "/rules": {
      GET: (req) => listRules(req),
    },
    "/rules/:id": {
      PATCH: (req) => patchRule(req, req.params.id),
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
      POST: (req) => confirmSuggestedReminder(req, req.params.id),
    },
    "/reminders/:id/complete": {
      POST: (req) => completeReminder(req, req.params.id),
    },
    "/reminders/:id": {
      PATCH: (req) => updateReminder(req, req.params.id),
      DELETE: (req) => cancelReminder(req, req.params.id),
    },
  },
  // Unmatched routes.
  fetch(req) {
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
