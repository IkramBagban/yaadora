/**
 * Open-loops wire types — mirror `packages/db/schema/open-loops.ts` and the
 * serializer in `apps/server/src/routes/open-loops.ts` exactly. Do not invent
 * fields; the server response is the source of truth.
 */

/** Lifecycle status: open → resolved | expired. */
export type LoopStatus = 'open' | 'resolved' | 'expired';

export const LOOP_STATUSES = ['open', 'resolved', 'expired'] as const;

/** Kinds the manual planter can create (server POST enum). */
export const LOOP_KINDS = [
  'commitment',
  'unresolved_conflict',
  'upcoming_event',
  'goal',
] as const;
export type PlantableKind = (typeof LOOP_KINDS)[number];

/**
 * Wire kind. Extraction may emit kinds beyond the plantable enum (e.g.
 * `thread`) — keep them renderable on the board instead of crashing.
 */
export type LoopKind = PlantableKind | (string & {});

/** One row of GET /open-loops. All datetimes are ISO 8601 strings or null. */
export interface Loop {
  id: string;
  kind: LoopKind;
  title: string;
  entityId: string | null;
  /** Canonical name of the linked entity (server left-join), null when unlinked. */
  entityName: string | null;
  dueAt: string | null;
  status: LoopStatus;
  /** Memory that closed this loop ("this memory closes it"), else null. */
  resolvedBy: string | null;
  /** Originating memory; null for manually planted loops. */
  sourceMemory: string | null;
  createdAt: string;
  lastSurfacedAt: string | null;
}

/** GET /open-loops */
export interface LoopList {
  items: Loop[];
}

/** POST /open-loops body (manual planting; provenance is the user's action). */
export interface CreateLoopInput {
  title: string;
  kind: PlantableKind;
  /** ISO datetime. */
  dueAt?: string;
}

/** PATCH /open-loops/:id body. `dueAt: null` clears it; `resolvedBy` names the closing memory. */
export interface PatchLoopInput {
  status?: LoopStatus;
  title?: string;
  dueAt?: string | null;
  resolvedBy?: string | null;
}

/** Memory row from GET /memories/search — only what the evidence picker shows. */
export interface EvidenceMemory {
  id: string;
  rawText: string;
  occurredAt: string | null;
  createdAt: string;
}

export interface SearchMemoriesResult {
  memories: Array<EvidenceMemory & { score: number }>;
}

/** POST /reminders/confirm → 201 — subset the board consumes. */
export interface CreatedReminder {
  id: string;
  text: string;
  dueAt: string;
}
