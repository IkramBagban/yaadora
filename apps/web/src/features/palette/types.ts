import type { LucideIcon } from 'lucide-react'

/** Group ids in display order — the palette renders groups in this sequence. */
export const PALETTE_GROUP_ORDER = [
  'actions',
  'navigate',
  'recent',
  'memories',
  'entities',
  'facts',
] as const

export type PaletteGroupId = (typeof PALETTE_GROUP_ORDER)[number]

export interface PaletteGroupMeta {
  id: PaletteGroupId
  label: string
}

export const PALETTE_GROUPS: Record<PaletteGroupMeta['id'], PaletteGroupMeta> = {
  actions: { id: 'actions', label: 'Actions' },
  navigate: { id: 'navigate', label: 'Navigate' },
  recent: { id: 'recent', label: 'Recent' },
  memories: { id: 'memories', label: 'Memories' },
  entities: { id: 'entities', label: 'Entities' },
  facts: { id: 'facts', label: 'Facts' },
}

/**
 * One selectable row in the palette. Builders (commands / search) produce these;
 * the list is purely presentational. `select()` closes the palette and runs.
 */
export interface PaletteItem {
  /** Stable identity across keystrokes — used for React keys and recents. */
  id: string
  groupId: PaletteGroupId
  label: string
  /** Secondary line: snippet, entity type, action description… */
  detail?: string
  /** Right-aligned meta text (date, score chip source…). */
  meta?: string
  icon: LucideIcon
  select: () => void
  /**
   * Absolute in-app href the selection lands on, when it is a navigation.
   * Recorded so the selection can be replayed from "Recent".
   */
  href?: string
}

// --- wire types for GET /memories/search (mirror of apps/server/src/routes/search.ts) ---

export type SearchChannel = 'vector' | 'lexical' | 'graph' | 'temporal' | (string & {})

/** Retrieval-shaped memory row with ISO date strings + fused score/channels. */
export interface MemorySearchHit {
  id: string
  rawText: string
  occurredAt: string | null
  createdAt: string
  source: string
  status: string
  score: number
  channels: SearchChannel[]
}

/** Retrieval-shaped fact row with ISO date strings + fused score/channels. */
export interface FactSearchHit {
  id: string
  subjectId: string | null
  predicate: string | null
  factText: string
  validFrom: string | null
  validTo: string | null
  confidence: number | null
  sourceMemory: string
  createdAt: string
  score: number
  channels: SearchChannel[]
}

/** GET /memories/search?q=…&limit=… */
export interface MemoriesSearchResponse {
  query: string
  memories: MemorySearchHit[]
  facts: FactSearchHit[]
}
