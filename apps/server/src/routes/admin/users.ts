import {
  getAiUsageByModelSince,
  listAdminUsers,
} from "@repo/db";
import { estimateCost } from "@repo/core";
import { createLogger } from "@repo/logger";
import { json, serverError } from "../../http";
import { requireAdmin } from "./guard";
import { decodeCursor, encodeCursor, parseLimit } from "./util";

const log = createLogger("server:admin:users");

/**
 * GET /admin/users?query=&cursor=&limit=50 (issue #31).
 *
 * Directory rows with joined aggregates; the 30d token/cost window is folded
 * here from per-model sums (@repo/db keeps raw SQL, @repo/core prices.ts owns
 * USD estimates). Unknown models contribute $0 — flagged in the log only,
 * since the wire contract has no place for a flag on this endpoint.
 */

const COST_WINDOW_DAYS = 30;

/** GET /admin/users — admin-only user directory. */
export async function listAdminUsersRoute(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const rawQuery = (url.searchParams.get("query") ?? "").trim();
  // Escape LIKE wildcards so admin search matches literal % and _.
  const query = rawQuery
    ? rawQuery.replace(/[\\%_]/g, (c) => `\\${c}`)
    : null;
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const limit = parseLimit(url.searchParams.get("limit"), 50);

  try {
    const users = await listAdminUsers({
      query,
      cursorCreatedAt: cursor?.createdAt ?? null,
      cursorId: cursor?.id ?? null,
      limit,
    });

    const modelTokens = await getAiUsageByModelSince(
      users.map((u) => u.id),
      COST_WINDOW_DAYS,
    );
    const byUser = new Map<string, { tokens30d: number; cost30dEstUsd: number }>();
    for (const u of users) byUser.set(u.id, { tokens30d: 0, cost30dEstUsd: 0 });
    for (const t of modelTokens) {
      const agg = byUser.get(t.userId);
      if (!agg) continue;
      agg.tokens30d += t.inputTokens + t.outputTokens;
      agg.cost30dEstUsd += estimateCost(t.model, t.inputTokens, t.outputTokens);
    }

    return json({
      users: users.map((u) => {
        const agg = byUser.get(u.id)!;
        return {
          id: u.id,
          email: u.email,
          role: u.role,
          createdAt: u.createdAt.toISOString(),
          lastActiveAt: u.lastActiveAt ? `${u.lastActiveAt}T00:00:00.000Z` : null,
          streakDays: u.streakDays,
          memoriesTotal: u.memoriesTotal,
          conversationsTotal: u.conversationsTotal,
          tokens30d: agg.tokens30d,
          cost30dEstUsd: Math.round(agg.cost30dEstUsd * 10_000) / 10_000,
          flags: {
            hasFailedMemories: u.hasFailedMemories,
            insightsDisabled: u.insightsDisabled,
          },
        };
      }),
      nextCursor:
        users.length === limit
          ? encodeCursor(users[users.length - 1]!.createdAt, users[users.length - 1]!.id)
          : null,
    });
  } catch (err) {
    log.error("listAdminUsers failed", err as Error);
    return serverError();
  }
}
