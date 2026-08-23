import { getEngineHealthData, getGlobalActivity } from "@repo/db";
import { getIngestionQueue } from "@repo/core";
import { createLogger } from "@repo/logger";
import { badRequest, json, serverError } from "../../http";
import { requireAdmin } from "./guard";

const log = createLogger("server:admin:global");

/**
 * GET /admin/activity (retention & engagement) and GET /admin/engine
 * (consolidation runs + ingestion failures + queue depth) — issue #31.
 */

function parseDays(raw: string | null): number | null {
  if (raw == null || raw === "") return 90;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 365) return null;
  return n;
}

/** GET /admin/activity?days=90 — DAU series, WAU weekly, streak top 20. */
export async function getGlobalActivityRoute(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const days = parseDays(new URL(req.url).searchParams.get("days"));
  if (days == null) {
    return badRequest("days must be an integer between 1 and 365.");
  }

  try {
    return json(await getGlobalActivity({ days }));
  } catch (err) {
    log.error("getGlobalActivity failed", err as Error);
    return serverError();
  }
}

/**
 * BullMQ ingestion queue depth via getJobCounts(). Redis may be down in dev —
 * a tracking failure here must never take the health endpoint down, so any
 * error degrades to null.
 */
async function ingestionQueueDepth(): Promise<Record<string, number> | null> {
  try {
    return await getIngestionQueue().getJobCounts();
  } catch (err) {
    log.warn("ingestion queue depth unavailable", {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** GET /admin/engine — consolidation runs desc (30), failures 7d, queue depth. */
export async function getEngineHealthRoute(_req: Request): Promise<Response> {
  const auth = await requireAdmin(_req);
  if (!auth.ok) return auth.response;

  try {
    const [health, queueDepth] = await Promise.all([
      getEngineHealthData(),
      ingestionQueueDepth(),
    ]);
    // queueDepth is additive over the UI contract (extra fields are ignored
    // by the merged panel); kept because operators need it on the same call.
    return json({ ...health, queueDepth });
  } catch (err) {
    log.error("getEngineHealth failed", err as Error);
    return serverError();
  }
}
