import { z } from "zod";
import { getGraphSnapshot } from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { badRequest, json, unauthorized, serverError } from "../http";

const log = createLogger("server:graph");

/**
 * GET /graph/snapshot — whole-graph view for the web graph page.
 *
 * Thin wrapper over the existing `getGraphSnapshot()` in @repo/db (entities
 * capped at 400 by mention count, edges at 300 by strength, open loops at
 * 200, dated memories over the window). No new SQL here by design.
 */

const Query = z.object({
  /** how far back dated memories reach (spec default 30d) */
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export async function getGraphSnapshotRoute(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  const url = new URL(req.url);
  const parsed = Query.safeParse({
    days: url.searchParams.get("days") ?? undefined,
  });
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }

  try {
    const snapshot = await getGraphSnapshot({
      userId,
      memoryWindowDays: parsed.data.days,
    });
    return json({
      ...snapshot,
      memoryWindowDays: parsed.data.days,
    });
  } catch (err) {
    log.error("graph snapshot failed", err as Error);
    return serverError();
  }
}
