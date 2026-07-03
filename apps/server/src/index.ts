import { bindUser, isAuthConfigured } from "./auth";
import { seedUser } from "./seed";
import { notFound, serverError } from "./http";
import {
  createMemory,
  listMemories,
  getMemoryDetail,
} from "./routes/memories";
import { health } from "./routes/health";

/**
 * apps/server — the Yaadora HTTP API (spec 01 §2, spec 03 §1).
 *
 * A small typed router on Bun.serve's `routes` (no express). Week 1–2 scope:
 * capture (the sacred fast path), timeline reads, memory detail, health.
 * Ask/reason + reminders are later waves.
 *
 * Run: `bun run src/index.ts` (or `bun run dev` for hot reload).
 */

const PORT = Number(process.env.PORT ?? "3000");

if (!isAuthConfigured()) {
  console.warn(
    "[server] AUTH_BOOTSTRAP_TOKEN is not set — all requests will be rejected. " +
      "Set it in .env before capturing memories.",
  );
}

// Seed the single user before serving so auth can bind a real user id.
const userId = await seedUser();
bindUser(userId);
console.log(`[server] bound single user ${userId}`);

const server = Bun.serve({
  port: PORT,
  routes: {
    "/health": { GET: () => health() },
    "/memories": {
      POST: (req) => createMemory(req),
      GET: (req) => listMemories(req),
    },
    "/memories/:id": {
      GET: (req) => getMemoryDetail(req, req.params.id),
    },
  },
  // Unmatched routes.
  fetch() {
    return notFound("Route not found.");
  },
  error(err) {
    console.error("[server] unhandled error:", err);
    return serverError();
  },
});

console.log(`[server] listening on http://localhost:${server.port}`);
