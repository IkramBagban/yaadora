import { db, digests, eq, asc } from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { json, unauthorized, serverError } from "../http";

const log = createLogger("server:digests");

/**
 * GET /digests — the user's rebuildable summaries (`kind`: profile | week),
 * written nightly by consolidation. Read-only listing for the web app.
 */
export async function listDigests(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  try {
    const rows = await db
      .select({
        kind: digests.kind,
        content: digests.content,
        updatedAt: digests.updatedAt,
      })
      .from(digests)
      .where(eq(digests.userId, userId))
      .orderBy(asc(digests.kind));

    return json({
      digests: rows.map((r) => ({
        kind: r.kind,
        content: r.content,
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    log.error("listDigests failed", err as Error);
    return serverError();
  }
}
