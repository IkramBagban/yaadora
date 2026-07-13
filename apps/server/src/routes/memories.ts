import { z } from "zod";
import { enqueueIngestion } from "@repo/core";
import {
  db,
  memories,
  facts,
  entities,
  memoryEntities,
  eq,
  and,
  lt,
  desc,
} from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { getRedis } from "../redis";
import { json, badRequest, notFound, unauthorized, serverError } from "../http";

const log = createLogger("server:memories");

/**
 * Memory routes (spec 03 §1.1). The capture path is sacred: POST does exactly
 * INSERT + enqueue, then returns — no LLM, sub-second.
 *
 * Embedding / fts columns are never returned over the wire (large, internal).
 */

// Public column projections (exclude embeddings + fts).
const memoryCols = {
  id: memories.id,
  userId: memories.userId,
  rawText: memories.rawText,
  occurredAt: memories.occurredAt,
  createdAt: memories.createdAt,
  source: memories.source,
  status: memories.status,
};

const factCols = {
  id: facts.id,
  subjectId: facts.subjectId,
  predicate: facts.predicate,
  objectText: facts.objectText,
  objectId: facts.objectId,
  factText: facts.factText,
  validFrom: facts.validFrom,
  validTo: facts.validTo,
  confidence: facts.confidence,
  factType: facts.factType,
  origin: facts.origin,
  sourceMemory: facts.sourceMemory,
  createdAt: facts.createdAt,
};

const entityCols = {
  id: entities.id,
  type: entities.type,
  canonicalName: entities.canonicalName,
  aliases: entities.aliases,
  profile: entities.profile,
  firstSeen: entities.firstSeen,
  lastSeen: entities.lastSeen,
  mentionCount: entities.mentionCount,
};

const CreateMemoryBody = z.object({
  rawText: z.string().min(1, "rawText is required"),
  source: z.enum(["manual", "voice"]).default("manual"),
  clientId: z.string().min(1).optional(),
  // A client hint for the event time; extraction resolves the authoritative
  // occurredAt in the worker. TODO(later wave): forward occurredHint into the
  // ingestion prompt to bias temporal resolution.
  occurredHint: z.string().optional(),
});

// Best-effort idempotency for offline-sync retries (spec 03 §1.1). We have no
// clientId column on the immutable memories table, so we key on Redis. Failures
// here never block capture. TODO(later wave): a durable dedupe table / column if
// stronger guarantees are needed.
function idemKey(userId: string, clientId: string): string {
  return `idem:${userId}:${clientId}`;
}

async function idemLookup(userId: string, clientId: string): Promise<string | null> {
  try {
    return await getRedis().get(idemKey(userId, clientId));
  } catch (err) {
    log.warn("idempotency lookup failed (continuing)", err as any);
    return null;
  }
}

async function idemStore(
  userId: string,
  clientId: string,
  memoryId: string,
): Promise<void> {
  try {
    const key = idemKey(userId, clientId);
    await getRedis().set(key, memoryId);
    await getRedis().expire(key, 60 * 60 * 24 * 7); // 7 days
  } catch (err) {
    log.warn("idempotency store failed (best-effort)", err as any);
  }
}

/** POST /memories — the sacred fast path. */
export async function createMemory(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest("Body must be valid JSON.");
  }
  const parsed = CreateMemoryBody.safeParse(raw); 
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("; ");
    log.debug("create rejected: invalid body", { message });
    return badRequest(message);
  }
  const body = parsed.data;

  // Idempotency: a retried offline flush returns the original row.
  if (body.clientId) {
    const existingId = await idemLookup(userId, body.clientId);
    if (existingId) {
      const [existing] = await db
        .select({
          id: memories.id,
          status: memories.status,
          createdAt: memories.createdAt,
        })
        .from(memories)
        .where(and(eq(memories.id, existingId), eq(memories.userId, userId)))
        .limit(1);
      if (existing) {
        log.info("create idempotent hit", {
          userId,
          clientId: body.clientId,
          memoryId: existing.id,
        });
        return json(existing, 201);
      }
    }
  }

  const [created] = await db
    .insert(memories)
    .values({
      userId,
      rawText: body.rawText,
      source: body.source,
      status: "pending",
    })
    .returning({
      id: memories.id,
      status: memories.status,
      createdAt: memories.createdAt,
    });

  if (!created) {
    log.error("create failed: insert returned no row", { userId });
    return serverError("Failed to persist memory.");
  }

  // Enqueue ingestion (the only async handoff on this path). If Redis is down
  // this throws → 500, but the raw row is already durably stored and can be
  // re-enqueued (its status stays 'pending').
  await enqueueIngestion(created.id);

  if (body.clientId) await idemStore(userId, body.clientId, created.id);

  log.info("memory captured", {
    userId,
    memoryId: created.id,
    source: body.source,
    chars: body.rawText.length,
  });
  return json(created, 201);
}

const ListQuery = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET /memories?cursor=&limit= — paginated timeline, newest first. */
export async function listMemories(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  const url = new URL(req.url);
  const parsed = ListQuery.safeParse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const { cursor, limit } = parsed.data;

  const where = cursor
    ? and(eq(memories.userId, userId), lt(memories.createdAt, new Date(cursor)))
    : eq(memories.userId, userId);

  const items = await db
    .select(memoryCols)
    .from(memories)
    .where(where)
    .orderBy(desc(memories.createdAt))
    .limit(limit);

  const last = items.at(-1);
  const nextCursor =
    items.length === limit && last ? last.createdAt.toISOString() : null;

  log.debug("timeline listed", {
    userId,
    count: items.length,
    limit,
    hasCursor: Boolean(cursor),
    hasMore: Boolean(nextCursor),
  });
  return json({ items, nextCursor });
}

/** GET /memories/:id — one memory + its derived facts + linked entities. */
export async function getMemoryDetail(
  req: Request,
  id: string,
): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  const [memory] = await db
    .select(memoryCols)
    .from(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
    .limit(1);
  if (!memory) {
    log.debug("memory detail not found", { userId, memoryId: id });
    return notFound("Memory not found.");
  }

  const derivedFacts = await db
    .select(factCols)
    .from(facts)
    .where(and(eq(facts.sourceMemory, id), eq(facts.userId, userId)))
    .orderBy(desc(facts.createdAt));

  const linkedEntities = await db
    .select(entityCols)
    .from(entities)
    .innerJoin(memoryEntities, eq(memoryEntities.entityId, entities.id))
    .where(
      and(eq(memoryEntities.memoryId, id), eq(entities.userId, userId)),
    );

  return json({ memory, facts: derivedFacts, entities: linkedEntities });
}
