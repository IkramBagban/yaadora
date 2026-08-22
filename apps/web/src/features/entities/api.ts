import { request } from '../../api/client'

/**
 * Entities feature wire types + fetchers.
 *
 * Shapes mirror apps/server/src/routes/entities.ts, entities-merge.ts and
 * facts-admin.ts exactly — do not invent fields here (see webdocs/data.md).
 */

// --- GET /entities -----------------------------------------------------------

/** One row of the entity directory (server projects a subset of the table). */
export interface EntityDirectoryItem {
  id: string
  type: string
  canonicalName: string
  profile: string | null
  mentionCount: number
  lastSeen: string | null
}

export interface EntityDirectoryPayload {
  entities: EntityDirectoryItem[]
}

// --- GET /entities/:id/context -----------------------------------------------

/** A current fact about an entity, with provenance for a tappable receipt. */
export interface EntityContextFact {
  id: string
  predicate: string | null
  factText: string
  /** provenance memory id */
  sourceMemory: string
}

/** An open loop attached to an entity (`sourceMemory` is null when planted manually). */
export interface EntityContextLoop {
  id: string
  kind: string
  title: string
  dueAt: string | null
  sourceMemory: string | null
}

/** A 1-hop relationship edge with its derived status. */
export interface EntityContextEdge {
  id: string
  relType: string
  status: string
  lastMentioned: string | null
  otherId: string
  otherName: string
  otherType: string
  otherIsKnownEntity: boolean
  evidence: string[]
}

/** A provenance memory shown as a tappable receipt. */
export interface EntityReceipt {
  id: string
  snippet: string
  occurredAt: string | null
  createdAt: string
}

/** GET /entities/:id/context — the dossier payload. */
export interface EntityContextPayload {
  entity: { id: string; canonicalName: string; type: string }
  profile: string | null
  facts: EntityContextFact[]
  openLoops: EntityContextLoop[]
  edges: EntityContextEdge[]
  receipts: EntityReceipt[]
}

// --- GET /facts?subject=<entityId> -------------------------------------------

/**
 * One row of the facts admin listing (bitemporal SPO). `validTo != null`
 * means the fact has been superseded or expired — history, not current truth.
 */
export interface FactHistoryItem {
  id: string
  subjectId: string | null
  subjectName: string | null
  objectId: string | null
  objectName: string | null
  predicate: string | null
  objectText: string | null
  factText: string
  confidence: number
  factType: string
  origin: string
  validFrom: string | null
  validTo: string | null
  conflicted: boolean
  hidden: boolean
  conflictNote: string | null
  /** provenance memory id — always set (provenance is never destroyed) */
  sourceMemory: string
  createdAt: string
}

export interface FactListPayload {
  items: FactHistoryItem[]
  nextCursor: string | null
}

// --- POST /entities/merge -----------------------------------------------------

/** What the merge transaction remapped (audit summary returned by the server). */
export interface MergeEntitiesResult {
  primary: {
    id: string
    type: string
    canonicalName: string
    aliases: string[]
    mentionCount: number
    firstSeen: string | null
    lastSeen: string | null
  }
  remapped: {
    memoryEntities: number
    factsAsSubject: number
    factsAsObject: number
    openLoops: number
    edgesDeleted: number
  }
}

// --- Query keys ----------------------------------------------------------------

export const entityKeys = {
  all: ['entities'] as const,
  directory: () => [...entityKeys.all, 'directory'] as const,
  context: (id: string) => [...entityKeys.all, 'context', id] as const,
  facts: (id: string) => [...entityKeys.all, 'facts', id] as const,
}

// --- Fetchers -------------------------------------------------------------------

/** GET /entities — up to 500 owned entities, person/project first then mentions. */
export function fetchEntityDirectory(): Promise<EntityDirectoryPayload> {
  return request<EntityDirectoryPayload>('/entities')
}

/** GET /entities/:id/context — profile, loops, top facts, edges, receipts. */
export function fetchEntityContext(entityId: string): Promise<EntityContextPayload> {
  return request<EntityContextPayload>(`/entities/${encodeURIComponent(entityId)}/context`)
}

/** Server page cap for GET /facts (see apps/server/src/routes/facts-admin.ts). */
const FACTS_PAGE_LIMIT = '200'
/** Runaway guard for cursor following — 25 pages ≈ 5000 facts per entity. */
const MAX_FACT_PAGES = 25

/**
 * GET /facts?subject=<id>&view=<view> — full fact rows for one entity
 * (subject OR object match), newest first. Follows the server's keyset
 * cursor to completion so entities with more than one page of facts don't
 * silently lose their older rows.
 */
export async function fetchEntityFacts(
  entityId: string,
  view: 'current' | 'history',
): Promise<FactHistoryItem[]> {
  const base = new URLSearchParams({
    subject: entityId,
    view,
    limit: FACTS_PAGE_LIMIT,
  })

  const items: FactHistoryItem[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_FACT_PAGES; page++) {
    const params = new URLSearchParams(base)
    if (cursor) params.set('cursor', cursor)
    const payload = await request<FactListPayload>(`/facts?${params.toString()}`)
    items.push(...payload.items)
    cursor = payload.nextCursor
    if (!cursor) return items
  }
  return items
}

/** POST /entities/merge — fold duplicate into primary; returns the audit summary. */
export function mergeEntities(primaryId: string, duplicateId: string): Promise<MergeEntitiesResult> {
  return request<MergeEntitiesResult>('/entities/merge', {
    method: 'POST',
    body: JSON.stringify({ primaryId, duplicateId }),
  })
}
