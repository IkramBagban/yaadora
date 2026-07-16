import { z } from "zod";
import { assembleEntityContext } from "@repo/core";
import { db, entities, getMemoriesByIds, flagEntityEdge, eq, and } from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { badRequest, json, notFound, unauthorized, serverError } from "../http";

const log = createLogger("server:entities");

/**
 * Entity pages API (spec 02 §8, spec 03 P3).
 *
 * GET  /entities/:id/context      — the assembler payload: profile, current
 *                                   facts, open loops, edges, and the receipt
 *                                   memories (ids + snippets). Ownership-checked.
 * POST /entities/edges/:id/flag   — edge review "wrong person": flag a bad link
 *                                   so it is excluded from context assembly.
 */

const SNIPPET_MAX = 200;
function snippet(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > SNIPPET_MAX ? `${clean.slice(0, SNIPPET_MAX)}…` : clean;
}

/** GET /entities/:id/context — assembler payload + receipt snippets. */
export async function getEntityContext(
  req: Request,
  entityId: string,
): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  if (!entityId || !z.string().uuid().safeParse(entityId).success) {
    return badRequest("entity id must be a uuid.");
  }

  try {
    const ctx = await assembleEntityContext(userId, entityId);
    if (!ctx) return notFound("Entity not found.");

    // Receipts: resolve provenance memory ids to snippets for tappable sources.
    const receiptMemories = ctx.receipts.length
      ? await getMemoriesByIds(userId, ctx.receipts)
      : [];
    const receipts = receiptMemories.map((m) => ({
      id: m.id,
      snippet: snippet(m.rawText),
      occurredAt: m.occurredAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
    }));

    return json({
      entity: ctx.entity,
      profile: ctx.profile,
      facts: ctx.facts,
      openLoops: ctx.openLoops,
      edges: ctx.edges,
      receipts,
    });
  } catch (err) {
    log.error("getEntityContext failed", err as Error);
    return serverError();
  }
}

/** POST /entities/edges/:id/flag — flag a bad entity link ("wrong person"). */
export async function flagEntityEdgeRoute(
  req: Request,
  edgeId: string,
): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  if (!edgeId || !z.string().uuid().safeParse(edgeId).success) {
    return badRequest("edge id must be a uuid.");
  }

  try {
    const flagged = await flagEntityEdge(userId, edgeId);
    if (!flagged) return notFound("Edge not found.");
    log.info("entity edge flagged (wrong link)", { userId, edgeId });
    return json({ id: flagged.id, status: "flagged" });
  } catch (err) {
    log.error("flagEntityEdge failed", err as Error);
    return serverError();
  }
}

/**
 * GET /entities?type=person — a simple owned-entity list for the entity list
 * screen (spec 03 P3: "a simple entity list screen"). Person/project first,
 * then by mention count.
 */
export async function listEntities(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  const url = new URL(req.url);
  const typeParam = url.searchParams.get("type");

  try {
    const conds = [eq(entities.userId, userId)];
    if (typeParam) conds.push(eq(entities.type, typeParam));

    const rows = await db
      .select({
        id: entities.id,
        type: entities.type,
        canonicalName: entities.canonicalName,
        profile: entities.profile,
        mentionCount: entities.mentionCount,
        lastSeen: entities.lastSeen,
      })
      .from(entities)
      .where(and(...conds))
      .limit(500);

    // Person / project first (the tappable kinds), then most-mentioned.
    const rank = (t: string) => (t === "person" ? 0 : t === "project" ? 1 : 2);
    rows.sort((a, b) => {
      const r = rank(a.type) - rank(b.type);
      if (r !== 0) return r;
      return (b.mentionCount ?? 0) - (a.mentionCount ?? 0);
    });

    return json({
      entities: rows.map((r) => ({
        id: r.id,
        type: r.type,
        canonicalName: r.canonicalName,
        profile: r.profile,
        mentionCount: r.mentionCount ?? 0,
        lastSeen: r.lastSeen?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    log.error("listEntities failed", err as Error);
    return serverError();
  }
}
