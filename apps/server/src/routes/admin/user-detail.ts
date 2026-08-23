import { db, eq, memories } from "@repo/db";
import { enqueueIngestion } from "@repo/core";
import { createLogger } from "@repo/logger";
import {
  getAdminUserDetail,
  getAdminMemoryForUser,
  listAdminMemories,
} from "@repo/db";
import { badRequest, json, notFound, serverError } from "../../http";
import { requireAdmin } from "./guard";
import { decodeCursor, encodeCursor, parseLimit, requireUuidParam } from "./util";

const log = createLogger("server:admin:user-detail");

/**
 * GET /admin/users/:id (+ memories + reprocess) (issue #31). Profile with
 * overview counters and devices; records listing incl. failed ingestion
 * items; single-memory reprocess mirroring packages/core/requeue.ts.
 */

/** GET /admin/users/:id — profile + overview + devices. */
export async function getAdminUserDetailRoute(
  req: Request & { params: Record<string, string> },
): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const id = requireUuidParam(req.params.id!, "User");
  if ("response" in id) return id.response;

  try {
    const detail = await getAdminUserDetail(id.id);
    if (!detail) return notFound("User not found.");
    return json({
      profile: { ...detail.profile, createdAt: detail.profile.createdAt.toISOString() },
      overview: detail.overview,
      devices: detail.devices.map((d) => ({
        deviceId: d.deviceId,
        updatedAt: d.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    log.error("getAdminUserDetail failed", err as Error);
    return serverError();
  }
}

/** GET /admin/users/:id/memories?status=all|failed&source=&cursor= */
export async function listAdminMemoriesRoute(
  req: Request & { params: Record<string, string> },
): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const id = requireUuidParam(req.params.id!, "User");
  if ("response" in id) return id.response;

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status") ?? "all";
  if (statusParam !== "all" && statusParam !== "failed") {
    return badRequest("status must be 'all' or 'failed'.");
  }
  const sourceParam = (url.searchParams.get("source") ?? "").trim() || null;
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const limit = parseLimit(url.searchParams.get("limit"), 50);

  try {
    const items = await listAdminMemories({
      userId: id.id,
      status: statusParam,
      source: sourceParam,
      cursorCreatedAt: cursor?.createdAt ?? null,
      cursorId: cursor?.id ?? null,
      limit,
    });
    const last = items[items.length - 1];
    return json({
      items: items.map((m) => ({
        id: m.id,
        rawTextSnippet: m.rawTextSnippet,
        source: m.source,
        status: m.status,
        occurredAt: m.occurredAt ? m.occurredAt.toISOString() : null,
        createdAt: m.createdAt.toISOString(),
        factsCount: m.factsCount,
      })),
      nextCursor:
        items.length === limit && last
          ? encodeCursor(last.createdAt, last.id)
          : null,
    });
  } catch (err) {
    log.error("listAdminMemories failed", err as Error);
    return serverError();
  }
}

/**
 * POST /admin/users/:id/memories/:memoryId/reprocess — re-enqueue ONE memory's
 * ingestion job. Mirrors the single-memory branch of packages/core/requeue.ts:
 * flip status back to 'pending', then enqueue; the worker owns the rest. 404
 * unless the memory exists AND belongs to :id.
 */
export async function postReprocessMemoryRoute(
  req: Request & { params: Record<string, string> },
): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const userId = requireUuidParam(req.params.id!, "User");
  if ("response" in userId) return userId.response;
  const memoryId = requireUuidParam(req.params.memoryId!, "Memory");
  if ("response" in memoryId) return memoryId.response;

  try {
    const memory = await getAdminMemoryForUser(userId.id, memoryId.id);
    if (!memory) return notFound("Memory not found.");

    await db
      .update(memories)
      .set({ status: "pending" })
      .where(eq(memories.id, memory.id));
    await enqueueIngestion(memory.id);

    log.info("admin reprocessed memory", {
      adminUserId: auth.userId,
      userId: userId.id,
      memoryId: memory.id,
      previousStatus: memory.status,
    });
    return json({ queued: true });
  } catch (err) {
    log.error("reprocess failed", err as Error);
    return serverError();
  }
}
