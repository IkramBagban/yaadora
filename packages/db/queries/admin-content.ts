import { sql } from "drizzle-orm";
import { db } from "../client";
import { asDate, asRows } from "./admin-util";

/**
 * Admin queries — per-user content listings (issue #31): records
 * (memories incl. failed), durable conversations, and their turns. All are
 * ownership-scoped by user_id; the route layer 404s on empty results.
 */

// ---------------------------------------------------------------------------
// GET /admin/users/:id/memories?status=all|failed&source&cursor
// ---------------------------------------------------------------------------

export interface AdminMemoryListRow {
  id: string;
  rawTextSnippet: string;
  source: string;
  status: string;
  occurredAt: Date | null;
  createdAt: Date;
  factsCount: number;
}

export interface ListAdminMemoriesParams {
  userId: string;
  /** 'all' lists every status; 'failed' only status='failed'. */
  status: "all" | "failed";
  /** Optional capture-source filter (manual | voice | import). */
  source: string | null;
  cursorCreatedAt: Date | null;
  cursorId: string | null;
  limit: number;
}

export async function listAdminMemories(
  params: ListAdminMemoriesParams,
): Promise<AdminMemoryListRow[]> {
  const { userId, status, source, cursorCreatedAt, cursorId, limit } = params;

  // Keyset pagination on (created_at, id) — same row-value comparison the
  // facts-admin module uses, so bulk-inserted rows can't shuffle pages.
  const rows = await db.execute(sql`
    SELECT m.id,
           regexp_replace(m.raw_text, '\\s+', ' ', 'g') AS raw_text_flat,
           m.source, m.status, m.occurred_at, m.created_at,
           (SELECT count(*) FROM facts f WHERE f.source_memory = m.id)::int AS facts_count
    FROM memories m
    WHERE m.user_id = ${userId}::uuid
      AND (${status === "failed" ? sql`m.status = 'failed'` : sql`true`})
      AND (${source}::text IS NULL OR m.source = ${source})
      AND (
        ${cursorCreatedAt ? cursorCreatedAt.toISOString() : null}::timestamptz IS NULL
        OR (m.created_at, m.id) < (
          ${cursorCreatedAt ? cursorCreatedAt.toISOString() : null}::timestamptz,
          ${cursorId ?? "00000000-0000-0000-0000-000000000000"}::uuid
        )
      )
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ${limit}
  `);

  return asRows(rows).map((r) => ({
    id: String(r.id),
    rawTextSnippet: String(r.raw_text_flat ?? "").slice(0, 200),
    source: String(r.source),
    status: String(r.status),
    occurredAt: r.occurred_at ? asDate(r.occurred_at) : null,
    createdAt: asDate(r.created_at),
    factsCount: Number(r.facts_count ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// GET /admin/users/:id/memories/:memoryId — existence + ownership for reprocess
// ---------------------------------------------------------------------------

/** The single memory for a user, or null. Reprocess route mirrors requeue.ts. */
export async function getAdminMemoryForUser(
  userId: string,
  memoryId: string,
): Promise<{ id: string; status: string } | null> {
  const rows = await db.execute(sql`
    SELECT id::text, status FROM memories
    WHERE id = ${memoryId}::uuid AND user_id = ${userId}::uuid
    LIMIT 1`);
  const r = asRows(rows)[0];
  return r ? { id: String(r.id), status: String(r.status) } : null;
}

// ---------------------------------------------------------------------------
// GET /admin/users/:id/conversations (+ /:cid/turns)
// ---------------------------------------------------------------------------

export interface AdminConversationRowData {
  id: string;
  startedAt: Date;
  turnCount: number;
  status: string;
  summarySnippet: string | null;
}

/** Latest conversations for one user (bounded; the panel shows them all). */
export async function listAdminConversations(
  userId: string,
  limit = 200,
): Promise<AdminConversationRowData[]> {
  const rows = await db.execute(sql`
    SELECT id, started_at, turn_count, status, summary
    FROM conversations
    WHERE user_id = ${userId}::uuid
    ORDER BY started_at DESC
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => ({
    id: String(r.id),
    startedAt: asDate(r.started_at),
    turnCount: Number(r.turn_count ?? 0),
    status: String(r.status),
    summarySnippet:
      r.summary != null ? String(r.summary).slice(0, 200) : null,
  }));
}

/**
 * Turns of ONE conversation, ascending. Returns null when the conversation
 * does not exist FOR THIS USER (404 case); [] when it exists but has no turns.
 */
export async function getAdminConversationTurns(params: {
  userId: string;
  conversationId: string;
}): Promise<
  | Array<{ role: string; content: string; meta: unknown; createdAt: Date }>
  | null
> {
  const { userId, conversationId } = params;

  const owned = await db.execute(sql`
    SELECT 1 FROM conversations
    WHERE id = ${conversationId}::uuid AND user_id = ${userId}::uuid LIMIT 1`);
  if (asRows(owned).length === 0) return null;

  const rows = await db.execute(sql`
    SELECT role, content, meta, created_at
    FROM conversation_turns
    WHERE conversation_id = ${conversationId}::uuid
    ORDER BY created_at ASC, id ASC`);

  return asRows(rows).map((r) => ({
    role: String(r.role),
    content: String(r.content),
    // Opaque JSONB provenance ({searches,citations,ruleIdsApplied,…}) — passed
    // through untouched; the client parses defensively.
    meta: r.meta ?? null,
    createdAt: asDate(r.created_at),
  }));
}
