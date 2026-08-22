import { getSurfacingsSummary } from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { json, unauthorized, serverError } from "../http";

const log = createLogger("server:surfacings-summary");

/**
 * GET /surfacings/summary — kind × reaction analytics INCLUDING suppressed
 * candidates, with a suppressed_reason breakdown (backend-gaps wave).
 *
 * Deliberately bypasses the usual `suppressed_reason IS NULL` filter: this is
 * a tuning surface for the proactive gates, and the blocked candidates are
 * the interesting rows. The user-facing /surfacings listing keeps its filter.
 */
export async function getSurfacingsSummaryRoute(
  req: Request,
): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  try {
    const summary = await getSurfacingsSummary(userId);
    return json(summary);
  } catch (err) {
    log.error("surfacings summary failed", err as Error);
    return serverError();
  }
}
