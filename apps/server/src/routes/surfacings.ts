import { z } from "zod";
import {
  db,
  surfacings,
  memories,
  eq,
  and,
  isNull,
  desc,
  inArray,
} from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { badRequest, json, notFound, unauthorized, serverError } from "../http";

const log = createLogger("server:surfacings");

/**
 * Surfacing ledger routes (spec 02 §2.4, §8).
 *
 * GET  /surfacings?status=pending&channel=chip — app-open suggestion chips
 * POST /surfacings/:id/reaction — { reaction: dismissed | engaged }
 */

const ReactionBody = z.object({
  reaction: z.enum(["dismissed", "engaged"]),
});

const ListQuery = z.object({
  status: z.enum(["pending"]).optional(),
  channel: z.enum(["conversation", "push", "chip"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/**
 * GET /surfacings — list ledger rows for the authenticated user.
 * Filters: status=pending (reaction IS NULL, not suppressed), channel=chip|…
 */
export async function listSurfacings(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  const url = new URL(req.url);
  const parsed = ListQuery.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    channel: url.searchParams.get("channel") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const { status, channel, limit = 20 } = parsed.data;

  try {
    const conditions = [eq(surfacings.userId, userId)];
    // Never return suppressed candidates as "shown" (spec 02 §2.4 invariant).
    conditions.push(isNull(surfacings.suppressedReason));
    if (status === "pending") {
      conditions.push(isNull(surfacings.reaction));
    }
    if (channel) {
      conditions.push(eq(surfacings.channel, channel));
    }

    const rows = await db
      .select({
        id: surfacings.id,
        kind: surfacings.kind,
        subjectType: surfacings.subjectType,
        subjectId: surfacings.subjectId,
        channel: surfacings.channel,
        conversationId: surfacings.conversationId,
        evidence: surfacings.evidence,
        shownAt: surfacings.shownAt,
        reaction: surfacings.reaction,
      })
      .from(surfacings)
      .where(and(...conditions))
      .orderBy(desc(surfacings.shownAt))
      .limit(limit);

    // Attach one-line memory snippets for chip labels / receipt previews.
    const allEvidence = Array.from(
      new Set(rows.flatMap((r) => r.evidence ?? [])),
    );
    const snippetById = new Map<string, string>();
    if (allEvidence.length > 0) {
      const mems = await db
        .select({ id: memories.id, rawText: memories.rawText })
        .from(memories)
        .where(
          and(eq(memories.userId, userId), inArray(memories.id, allEvidence)),
        );
      for (const m of mems) {
        const line = m.rawText.trim().split("\n")[0] ?? m.rawText;
        snippetById.set(
          m.id,
          line.length > 160 ? `${line.slice(0, 157)}…` : line,
        );
      }
    }

    return json({
      surfacings: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        subjectType: r.subjectType,
        subjectId: r.subjectId,
        channel: r.channel,
        conversationId: r.conversationId,
        evidence: r.evidence ?? [],
        evidenceSnippets: (r.evidence ?? [])
          .map((id) => snippetById.get(id))
          .filter(Boolean),
        shownAt: r.shownAt.toISOString(),
        reaction: r.reaction,
      })),
    });
  } catch (err) {
    log.error("listSurfacings failed", err as Error);
    return serverError();
  }
}

/**
 * GET /surfacings/:id/evidence — memory receipts for "why am I hearing this".
 */
export async function getSurfacingEvidence(
  req: Request,
  surfacingId: string,
): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  if (!surfacingId || !z.string().uuid().safeParse(surfacingId).success) {
    return badRequest("surfacing id must be a uuid.");
  }

  try {
    const [row] = await db
      .select({
        id: surfacings.id,
        evidence: surfacings.evidence,
      })
      .from(surfacings)
      .where(and(eq(surfacings.id, surfacingId), eq(surfacings.userId, userId)))
      .limit(1);

    if (!row) return notFound("Surfacing not found.");

    const ids = row.evidence ?? [];
    if (ids.length === 0) {
      return json({ id: row.id, memories: [] });
    }

    const mems = await db
      .select({
        id: memories.id,
        rawText: memories.rawText,
        occurredAt: memories.occurredAt,
        createdAt: memories.createdAt,
      })
      .from(memories)
      .where(and(eq(memories.userId, userId), inArray(memories.id, ids)));

    // Preserve evidence order.
    const byId = new Map(mems.map((m) => [m.id, m]));
    return json({
      id: row.id,
      memories: ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((m) => ({
          id: m!.id,
          rawText: m!.rawText,
          occurredAt: m!.occurredAt?.toISOString() ?? null,
          createdAt: m!.createdAt.toISOString(),
        })),
    });
  } catch (err) {
    log.error("getSurfacingEvidence failed", err as Error);
    return serverError();
  }
}

export async function postSurfacingReaction(
  req: Request,
  surfacingId: string,
): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  if (!surfacingId || !z.string().uuid().safeParse(surfacingId).success) {
    return badRequest("surfacing id must be a uuid.");
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest("Body must be valid JSON.");
  }
  const parsed = ReactionBody.safeParse(raw);
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }

  try {
    const [row] = await db
      .update(surfacings)
      .set({
        reaction: parsed.data.reaction,
        reactionAt: new Date(),
      })
      .where(and(eq(surfacings.id, surfacingId), eq(surfacings.userId, userId)))
      .returning({
        id: surfacings.id,
        reaction: surfacings.reaction,
        reactionAt: surfacings.reactionAt,
      });

    if (!row) return notFound("Surfacing not found.");
    log.info("surfacing reaction recorded", {
      userId,
      surfacingId: row.id,
      reaction: row.reaction,
    });
    return json({
      id: row.id,
      reaction: row.reaction,
      reactionAt: row.reactionAt?.toISOString() ?? null,
    });
  } catch (err) {
    log.error("postSurfacingReaction failed", err as Error);
    return serverError();
  }
}
