import { getAdminUserActivity } from "@repo/db";
import { createLogger } from "@repo/logger";
import { badRequest, json, serverError } from "../../http";
import { requireAdmin } from "./guard";
import { requireUuidParam } from "./util";

const log = createLogger("server:admin:activity");

/**
 * GET /admin/users/:id/activity?days=90 (issue #31): daily engagement buckets
 * plus the latest 200 api_requests rows for the user's feed.
 */

function parseDays(raw: string | null, fallback: number): number | null {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 365) return null;
  return n;
}

/** GET /admin/users/:id/activity — daily rollup + recent api_requests. */
export async function getAdminUserActivityRoute(
  req: Request & { params: Record<string, string> },
): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const id = requireUuidParam(req.params.id!, "User");
  if ("response" in id) return id.response;

  const days = parseDays(new URL(req.url).searchParams.get("days"), 90);
  if (days == null) return badRequest("days must be an integer between 1 and 365.");

  try {
    const feed = await getAdminUserActivity(id.id, days);
    return json(feed);
  } catch (err) {
    log.error("getAdminUserActivity failed", err as Error);
    return serverError();
  }
}
