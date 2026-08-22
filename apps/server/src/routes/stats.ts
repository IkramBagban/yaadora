import { z } from "zod";
import { getStatsOverview, getMemoriesTimeseries } from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { badRequest, json, unauthorized, serverError } from "../http";

const log = createLogger("server:stats");

/**
 * Stats routes (backend-gaps wave).
 *
 * GET /stats/overview            — dashboard counters
 * GET /stats/timeseries?days=90&bucket=day — memory volume per bucket
 */

/** GET /stats/overview — counts across every core table for this user. */
export async function getStatsOverviewRoute(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  try {
    return json(await getStatsOverview(userId));
  } catch (err) {
    log.error("stats overview failed", err as Error);
    return serverError();
  }
}

const TimeseriesQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(90),
  bucket: z.enum(["day", "week", "month"]).default("day"),
});

/** GET /stats/timeseries — memories per bucket split by source. */
export async function getStatsTimeseriesRoute(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  const url = new URL(req.url);
  const parsed = TimeseriesQuery.safeParse({
    days: url.searchParams.get("days") ?? undefined,
    bucket: url.searchParams.get("bucket") ?? undefined,
  });
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const { days, bucket } = parsed.data;

  try {
    const points = await getMemoriesTimeseries({ userId, days, bucket });
    return json({ days, bucket, points });
  } catch (err) {
    log.error("stats timeseries failed", err as Error);
    return serverError();
  }
}
