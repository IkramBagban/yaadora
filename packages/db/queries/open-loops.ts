import { and, desc, eq } from "drizzle-orm";
import { db } from "../client";
import { entities, openLoops } from "../schema";

/**
 * Open-loops helpers for the web app (backend-gaps wave).
 *
 * GET/POST/PATCH /open-loops. POST is manual planting: `sourceMemory` stays
 * NULL (see schema/open-loops.ts) — no synthetic memory row is written to the
 * immutable log. All queries are ownership-scoped to the user.
 */

export interface AdminOpenLoop {
  id: string;
  kind: string;
  title: string;
  entityId: string | null;
  entityName: string | null;
  dueAt: Date | null;
  status: string;
  resolvedBy: string | null;
  /** null for manually planted loops */
  sourceMemory: string | null;
  createdAt: Date;
  lastSurfacedAt: Date | null;
}

const loopSelection = {
  id: openLoops.id,
  kind: openLoops.kind,
  title: openLoops.title,
  entityId: openLoops.entityId,
  entityName: entities.canonicalName,
  dueAt: openLoops.dueAt,
  status: openLoops.status,
  resolvedBy: openLoops.resolvedBy,
  sourceMemory: openLoops.sourceMemory,
  createdAt: openLoops.createdAt,
  lastSurfacedAt: openLoops.lastSurfacedAt,
};

const baseQuery = () =>
  db
    .select(loopSelection)
    .from(openLoops)
    .leftJoin(entities, eq(entities.id, openLoops.entityId));

export interface ListOpenLoopsParams {
  userId: string;
  status?: string | null; // open | resolved | expired
  kind?: string | null;
  entityId?: string | null;
  limit?: number;
}

/** GET /open-loops — filtered listing, soonest-due / newest first. */
export async function listOpenLoops(
  params: ListOpenLoopsParams,
): Promise<AdminOpenLoop[]> {
  const { userId, status, kind, entityId, limit = 100 } = params;

  const conds = [eq(openLoops.userId, userId)];
  if (status) conds.push(eq(openLoops.status, status));
  if (kind) conds.push(eq(openLoops.kind, kind));
  if (entityId) conds.push(eq(openLoops.entityId, entityId));

  return baseQuery()
    .where(and(...conds))
    .orderBy(desc(openLoops.createdAt))
    .limit(limit);
}

export interface CreateManualLoopInput {
  userId: string;
  title: string;
  kind: string; // commitment | unresolved_conflict | upcoming_event | goal
  entityId?: string | null;
  dueAt?: Date | null;
}

/**
 * POST /open-loops — manual planting. The loop enters the same lifecycle
 * (open → resolved | expired) as extraction-derived ones; provenance is the
 * user's own action, so `source_memory` is null.
 */
export async function createManualLoop(
  input: CreateManualLoopInput,
): Promise<AdminOpenLoop> {
  const [row] = await db
    .insert(openLoops)
    .values({
      userId: input.userId,
      title: input.title,
      kind: input.kind,
      entityId: input.entityId ?? null,
      dueAt: input.dueAt ?? null,
      status: "open",
      sourceMemory: null,
    })
    .returning({ id: openLoops.id });

  const [created] = await baseQuery()
    .where(and(eq(openLoops.id, row!.id), eq(openLoops.userId, input.userId)))
    .limit(1);
  return created!;
}

export interface PatchLoopInput {
  status?: "open" | "resolved" | "expired";
  dueAt?: Date | null; // null clears
  title?: string;
}

/** PATCH /open-loops/:id — lifecycle + metadata edits. Ownership-checked. */
export async function patchOpenLoop(
  userId: string,
  loopId: string,
  patch: PatchLoopInput,
): Promise<AdminOpenLoop | null> {
  const set: Record<string, unknown> = {};
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.dueAt !== undefined) set.dueAt = patch.dueAt;
  if (patch.title !== undefined) set.title = patch.title;
  if (Object.keys(set).length === 0) return null;

  const [updated] = await db
    .update(openLoops)
    .set(set)
    .where(and(eq(openLoops.id, loopId), eq(openLoops.userId, userId)))
    .returning({ id: openLoops.id });
  if (!updated) return null;

  const [row] = await baseQuery()
    .where(and(eq(openLoops.id, updated.id), eq(openLoops.userId, userId)))
    .limit(1);
  return row ?? null;
}
