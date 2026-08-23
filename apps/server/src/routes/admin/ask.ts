import {
  getAdminConversationTurns,
  listAdminConversations,
} from "@repo/db";
import { createLogger } from "@repo/logger";
import { json, notFound, serverError } from "../../http";
import { requireAdmin } from "./guard";
import { requireUuidParam } from "./util";

const log = createLogger("server:admin:ask");

/**
 * GET /admin/users/:id/conversations and GET …/:cid/turns (issue #31).
 * Durable-conversation inspection for the admin panel; turns ascend with the
 * opaque meta JSONB passed through untouched (the client parses defensively).
 */

/** GET /admin/users/:id/conversations — list w/ turnCount, status, startedAt. */
export async function listAdminConversationsRoute(
  req: Request & { params: Record<string, string> },
): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const id = requireUuidParam(req.params.id!, "User");
  if ("response" in id) return id.response;

  try {
    const items = await listAdminConversations(id.id);
    return json({
      items: items.map((c) => ({
        id: c.id,
        startedAt: c.startedAt.toISOString(),
        turnCount: c.turnCount,
        status: c.status,
        summarySnippet: c.summarySnippet,
      })),
    });
  } catch (err) {
    log.error("listAdminConversations failed", err as Error);
    return serverError();
  }
}

/** GET /admin/users/:id/conversations/:cid/turns — turns asc w/ meta jsonb. */
export async function getAdminConversationTurnsRoute(
  req: Request & { params: Record<string, string> },
): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const userId = requireUuidParam(req.params.id!, "User");
  if ("response" in userId) return userId.response;
  const cid = requireUuidParam(req.params.cid!, "Conversation");
  if ("response" in cid) return cid.response;

  try {
    const turns = await getAdminConversationTurns({
      userId: userId.id,
      conversationId: cid.id,
    });
    // null = no such conversation FOR THIS USER → 404, never cross-user reads.
    if (!turns) return notFound("Conversation not found.");
    return json({
      turns: turns.map((t) => ({
        role: t.role,
        content: t.content,
        meta: t.meta,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    log.error("getAdminConversationTurns failed", err as Error);
    return serverError();
  }
}
