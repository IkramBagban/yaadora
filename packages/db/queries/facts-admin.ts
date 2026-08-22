import { and, eq } from "drizzle-orm";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../client";
import { facts } from "../schema/facts";

/**
 * Facts admin helpers for the web app (backend-gaps wave).
 *
 * GET /facts listing with filters + keyset pagination, and PATCH
 * /facts/:id for the hide/note metadata. Raw SQL lives HERE in @repo/db.
 * Hidden facts are still returned by this admin listing (the flag is data,
 * not a delete); consumer-facing surfaces can filter on `hidden`.
 */

const asRows = (rows: unknown): Array<Record<string, unknown>> =>
  rows as unknown as Array<Record<string, unknown>>;

export interface AdminFact {
  id: string;
  subjectId: string | null;
  subjectName: string | null;
  objectId: string | null;
  objectName: string | null;
  predicate: string | null;
  objectText: string | null;
  factText: string;
  confidence: number;
  factType: string;
  origin: string;
  validFrom: Date | null;
  validTo: Date | null;
  /** conflicts_with IS NOT NULL */
  conflicted: boolean;
  hidden: boolean;
  conflictNote: string | null;
  sourceMemory: string;
  createdAt: Date;
}

export interface ListFactsAdminParams {
  userId: string;
  /** restrict to facts where the entity is subject OR object */
  entityId?: string | null;
  /** name fragment fallback when the caller passed a non-uuid subject;
   *  pre-escaped by the route (caller escapes % and _) */
  subjectName?: string | null;
  factType?: string | null;
  /** current = valid_to IS NULL · history = everything incl. superseded */
  view: "current" | "history";
  conflictedOnly: boolean;
  limit: number;
  /** keyset cursor — created_at of the last row of the previous page */
  cursorCreatedAt?: Date | null;
  /** keyset cursor — id tiebreaker for rows sharing a timestamp */
  cursorId?: string | null;
}

export async function listFactsAdmin(
  params: ListFactsAdminParams,
): Promise<AdminFact[]> {
  const {
    userId,
    entityId,
    subjectName,
    factType,
    view,
    conflictedOnly,
    limit,
    cursorCreatedAt,
    cursorId,
  } = params;

  const conds: SQL[] = [sql`f.user_id = ${userId}`];
  if (view === "current") conds.push(sql`f.valid_to IS NULL`);
  if (factType) conds.push(sql`f.fact_type = ${factType}`);
  if (conflictedOnly) conds.push(sql`f.conflicts_with IS NOT NULL`);
  if (entityId) {
    conds.push(
      sql`(f.subject_id = ${entityId}::uuid OR f.object_id = ${entityId}::uuid)`,
    );
  } else if (subjectName) {
    const pattern = `%${subjectName}%`;
    conds.push(
      sql`(es.canonical_name ILIKE ${pattern} OR eo.canonical_name ILIKE ${pattern})`,
    );
  }
  // Keyset pagination: row-value comparison handles bulk-inserted facts that
  // share identical created_at timestamps.
  if (cursorCreatedAt && cursorId) {
    conds.push(
      sql`(f.created_at, f.id) < (${cursorCreatedAt.toISOString()}::timestamptz, ${cursorId}::uuid)`,
    );
  }

  const rows = await db.execute(sql`
    SELECT f.id, f.subject_id, es.canonical_name AS subject_name,
           f.object_id, eo.canonical_name AS object_name,
           f.predicate, f.object_text, f.fact_text, f.confidence,
           f.fact_type, f.origin, f.valid_from, f.valid_to,
           (f.conflicts_with IS NOT NULL) AS conflicted,
           COALESCE(f.hidden, FALSE) AS hidden,
           f.conflict_note, f.source_memory, f.created_at
    FROM facts f
    LEFT JOIN entities es ON es.id = f.subject_id
    LEFT JOIN entities eo ON eo.id = f.object_id
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT ${limit}
  `);

  return asRows(rows).map((r) => ({
    id: String(r.id),
    subjectId: r.subject_id ? String(r.subject_id) : null,
    subjectName: r.subject_name ? String(r.subject_name) : null,
    objectId: r.object_id ? String(r.object_id) : null,
    objectName: r.object_name ? String(r.object_name) : null,
    predicate: r.predicate ? String(r.predicate) : null,
    objectText: r.object_text ? String(r.object_text) : null,
    factText: String(r.fact_text),
    confidence: Number(r.confidence ?? 0),
    factType: String(r.fact_type),
    origin: String(r.origin),
    validFrom: r.valid_from ? new Date(r.valid_from as string) : null,
    validTo: r.valid_to ? new Date(r.valid_to as string) : null,
    conflicted: Boolean(r.conflicted),
    hidden: Boolean(r.hidden),
    conflictNote: r.conflict_note ? String(r.conflict_note) : null,
    sourceMemory: String(r.source_memory),
    createdAt: new Date(r.created_at as string),
  }));
}

export interface PatchFactInput {
  hidden?: boolean | null; // null clears the flag back to "never reviewed"
  conflictNote?: string | null; // null clears the note
}

/**
 * PATCH /facts/:id body executor. Ownership-checked. Returns the updated
 * admin-shaped row, or null when no owned fact matches.
 */
export async function patchFactAdmin(
  userId: string,
  factId: string,
  patch: PatchFactInput,
): Promise<AdminFact | null> {
  const set: Record<string, unknown> = {};
  if (patch.hidden !== undefined) set.hidden = patch.hidden;
  if (patch.conflictNote !== undefined) set.conflictNote = patch.conflictNote;
  if (Object.keys(set).length === 0) return null;

  const [row] = await db
    .update(facts)
    .set(set)
    .where(and(eq(facts.id, factId), eq(facts.userId, userId)))
    .returning({
      id: facts.id,
      subjectId: facts.subjectId,
      objectId: facts.objectId,
      predicate: facts.predicate,
      objectText: facts.objectText,
      factText: facts.factText,
      confidence: facts.confidence,
      factType: facts.factType,
      origin: facts.origin,
      validFrom: facts.validFrom,
      validTo: facts.validTo,
      conflictsWith: facts.conflictsWith,
      hidden: facts.hidden,
      conflictNote: facts.conflictNote,
      sourceMemory: facts.sourceMemory,
      createdAt: facts.createdAt,
    });
  if (!row) return null;

  // Resolve entity names for the two graph endpoints (single round trip).
  const ids = [row.subjectId, row.objectId].filter(Boolean) as string[];
  const nameById = new Map<string, string>();
  if (ids.length) {
    const entRows = await db.execute(sql`
      SELECT id, canonical_name FROM entities
      WHERE user_id = ${userId} AND id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
    `);
    for (const e of asRows(entRows)) nameById.set(String(e.id), String(e.canonical_name));
  }

  return {
    id: row.id,
    subjectId: row.subjectId,
    subjectName: row.subjectId ? (nameById.get(row.subjectId) ?? null) : null,
    objectId: row.objectId,
    objectName: row.objectId ? (nameById.get(row.objectId) ?? null) : null,
    predicate: row.predicate,
    objectText: row.objectText,
    factText: row.factText,
    confidence: row.confidence,
    factType: row.factType,
    origin: row.origin,
    validFrom: row.validFrom,
    validTo: row.validTo,
    conflicted: row.conflictsWith != null,
    hidden: row.hidden ?? false,
    conflictNote: row.conflictNote,
    sourceMemory: row.sourceMemory,
    createdAt: row.createdAt,
  };
}
