import { createLogger, initLogging } from "@repo/logger";
import { bindUser, isAuthConfigured } from "./auth";
import { seedUser } from "./seed";
import { notFound, serverError } from "./http";
import {
  createMemory,
  listMemories,
  getMemoryDetail,
} from "./routes/memories";
import { health } from "./routes/health";
import { ask } from "./routes/ask";
import {
  confirmReminder,
  confirmSuggestedReminder,
  listReminders,
  cancelReminder,
} from "./routes/reminders";

// Declare this process's log target FIRST — every log line (including those
// emitted deep inside @repo/core) is written to logs/server.log in development.
initLogging("server");
const log = createLogger("server");

/**
 * apps/server — the Yaadora HTTP API (spec 01 §2, spec 03 §1).
 *
 * A small typed router on Bun.serve's `routes` (no express): capture (the
 * sacred fast path), timeline reads, memory detail, health, and Ask (streamed
 * grounded recall). Reminders + decision mode are later waves.
 *
 * Run: `bun run src/index.ts` (or `bun run dev` for hot reload).
 */

const PORT = Number(process.env.PORT ?? "3000");

if (!isAuthConfigured()) {
  log.warn(
    "AUTH_BOOTSTRAP_TOKEN is not set — all requests will be rejected. Set it in .env before capturing memories.",
  );
}

// Seed the single user before serving so auth can bind a real user id.
const userId = await seedUser();
bindUser(userId);
log.info("bound single user", { userId });

const server = Bun.serve({
  port: PORT,
  idleTimeout: 60, // 60 seconds (prevents timeout on slow LLM reasoning)
  routes: {
    "/health": { GET: () => health() },
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
    "/reminders": {
      GET: (req) => listReminders(req),
    },
    "/reminders/confirm": {
      POST: (req) => confirmReminder(req),
    },
    "/reminders/:id/confirm": {
      POST: (req) => confirmSuggestedReminder(req, req.params.id),
    },
    "/reminders/:id": {
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
