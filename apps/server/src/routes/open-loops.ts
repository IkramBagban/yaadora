import { z } from "zod";
import {
  db,
  entities,
  memories,
  eq,
  and,
  listOpenLoops,
  createManualLoop,
  patchOpenLoop,
} from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { badRequest, json, notFound, unauthorized, serverError } from "../http";

const log = createLogger("server:open-loops");

/**
 * Open-loops management (backend-gaps wave).
 *
 * GET   /open-loops?status=&kind=&entityId=&limit=
 * POST  /open-loops  { title, kind, entityId?, dueAt? } — manual planting
 * PATCH /open-loops/:id  { status?, dueAt?, title?, resolvedBy? }
 *
 * Manual loops have sourceMemory = null (see schema/open-loops.ts) — no
 * synthetic memory row is written to the immutable log.
 */

function serialize(row: Awaited<ReturnType<typeof listOpenLoops>>[number]) {
  return {
    ...row,
    dueAt: row.dueAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    lastSurfacedAt: row.lastSurfacedAt?.toISOString() ?? null,
  };
}

const ListQuery = z.object({
  status: z.enum(["open", "resolved", "expired"]).optional(),
  kind: z.string().trim().min(1).max(100).optional(),
  entityId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** GET /open-loops — filtered lifecycle listing. */
export async function listOpenLoopsRoute(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  const url = new URL(req.url);
  const parsed = ListQuery.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    kind: url.searchParams.get("kind") ?? undefined,
    entityId: url.searchParams.get("entityId") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }

  try {
    const items = await listOpenLoops({ userId, ...parsed.data });
    return json({ items: items.map(serialize) });
  } catch (err) {
    log.error("listOpenLoops failed", err as Error);
    return serverError();
  }
}

const CreateBody = z.object({
  title: z.string().trim().min(1, "title is required").max(500),
  kind: z.enum(["commitment", "unresolved_conflict", "upcoming_event", "goal"]),
  entityId: z.string().uuid().optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
});

/** Verify an optional entity reference is owned by this user. */
async function entityOwned(userId: string, entityId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.userId, userId)))
    .limit(1);
  return Boolean(row);
}

/** Verify an optional evidence-memory reference is owned by this user. */
async function memoryOwned(userId: string, memoryId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)))
    .limit(1);
  return Boolean(row);
}

/** POST /open-loops — manual planting; provenance is the user's action. */
export async function createOpenLoopRoute(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest("Body must be valid JSON.");
  }
  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const { title, kind, entityId, dueAt } = parsed.data;

  if (entityId && !(await entityOwned(userId, entityId))) {
    return badRequest("entityId does not reference one of your entities.");
  }

  try {
    const created = await createManualLoop({
      userId,
      title,
      kind,
      entityId: entityId ?? null,
      dueAt: dueAt ? new Date(dueAt) : null,
    });
    log.info("open loop planted", { userId, loopId: created.id, kind });
    return json(serialize(created), 201);
  } catch (err) {
    log.error("createOpenLoop failed", err as Error);
    return serverError();
  }
}

const PatchBody = z
  .object({
    status: z.enum(["open", "resolved", "expired"]).optional(),
    // ISO datetime or null to clear.
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    title: z.string().trim().min(1).max(500).optional(),
    // Evidence resolve ("this memory closes it"); null to clear. Must be one
    // of the caller's own memories (checked below).
    resolvedBy: z.string().uuid().nullable().optional(),
  })
  .refine(
    (d) =>
      d.status !== undefined ||
      d.dueAt !== undefined ||
      d.title !== undefined ||
      d.resolvedBy !== undefined,
    { message: "At least one of status, dueAt, title, or resolvedBy is required." },
  );

/** PATCH /open-loops/:id — lifecycle + metadata edits. */
export async function patchOpenLoopRoute(
  req: Request,
  loopId: string,
): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  if (!loopId || !z.string().uuid().safeParse(loopId).success) {
    return badRequest("loop id must be a uuid.");
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest("Body must be valid JSON.");
  }
  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const { status, dueAt, title, resolvedBy } = parsed.data;

  if (resolvedBy && !(await memoryOwned(userId, resolvedBy))) {
    return badRequest("resolvedBy does not reference one of your memories.");
  }

  try {
    const updated = await patchOpenLoop(userId, loopId, {
      status,
      title,
      dueAt:
        dueAt === undefined ? undefined : dueAt === null ? null : new Date(dueAt),
      resolvedBy,
    });
    if (!updated) return notFound("Open loop not found.");
    log.info("open loop patched", { userId, loopId: updated.id });
    return json(serialize(updated));
  } catch (err) {
    log.error("patchOpenLoop failed", err as Error);
    return serverError();
  }
}
