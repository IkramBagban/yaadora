import { Brain, Compass, FileText, History, Quote, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { fuzzyMatch } from './fuzzy'
import { getRecents, pushRecent } from './recent'
import { targetToHref } from './navigation'
import type { UnifiedSearchResult } from './useUnifiedSearch'
import type {
  FactSearchHit,
  MemorySearchHit,
  PaletteGroupId,
  PaletteItem,
} from './types'
import { PALETTE_GROUP_ORDER, PALETTE_GROUPS } from './types'

export type Navigate = (href: string) => void

/** Grouped rows in display order + a flat list for keyboard index math. */
export interface GroupedRows {
  groups: Array<{ id: PaletteGroupId; label: string; items: PaletteItem[] }>
  flat: PaletteItem[]
}

const SNIPPET_MAX = 96
const GROUP_MAX = 6

function truncate(text: string, max = SNIPPET_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function formatWhen(iso: string | null): string | undefined {
  if (!iso) return undefined
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return undefined
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

function joinMeta(parts: Array<string | undefined>): string | undefined {
  const joined = parts.filter((part) => part !== undefined).join(' · ')
  return joined || undefined
}

function memoryRow(hit: MemorySearchHit, navigate: Navigate): PaletteItem {
  const href = targetToHref({ kind: 'memory', memoryId: hit.id })
  return {
    id: `memory:${hit.id}`,
    groupId: 'memories',
    label: truncate(hit.rawText),
    meta: joinMeta([hit.status === 'processed' ? undefined : hit.status, formatWhen(hit.occurredAt ?? hit.createdAt)]),
    icon: Brain,
    href,
    select: () => navigate(href),
  }
}

function factRow(hit: FactSearchHit, query: string, navigate: Navigate): PaletteItem {
  // Facts explorer deep-link: opens filtered on the active search text.
  const href = targetToHref({ kind: 'fact', query })
  return {
    id: `fact:${hit.id}`,
    groupId: 'facts',
    label: truncate(hit.factText),
    detail: hit.predicate ?? undefined,
    meta: formatWhen(hit.createdAt),
    icon: Quote,
    href,
    select: () => navigate(href),
  }
}

function entityRow(entity: UnifiedSearchResult['entities'][number], navigate: Navigate): PaletteItem {
  const href = targetToHref({ kind: 'entity', entityId: entity.id })
  return {
    id: `entity:${entity.id}`,
    groupId: 'entities',
    label: entity.canonicalName,
    detail: entity.type,
    meta: `${entity.mentionCount} mentions`,
    icon: User,
    href,
    select: () => navigate(href),
  }
}

/** Generic icon for replayed recent selections (originals may differ). */
const RECENT_ICONS: Partial<Record<PaletteGroupId, LucideIcon>> = {
  navigate: Compass,
  memories: Brain,
  entities: User,
  facts: FileText,
}

function recentRows(navigate: Navigate): PaletteItem[] {
  return getRecents().map((recent) => ({
    id: `recent:${recent.id}`,
    groupId: 'recent',
    label: recent.label,
    detail: 'Recent',
    icon: RECENT_ICONS[recent.groupId] ?? History,
    href: recent.href,
    select: () => {
      pushRecent(recent) // bump to front
      navigate(recent.href)
    },
  }))
}

function matchCommands(query: string, commands: PaletteItem[]): PaletteItem[] {
  return commands
    .map((item) => ({ item, score: fuzzyMatch(query, item.label, item.detail ?? '') ?? Number.NEGATIVE_INFINITY }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
}

/**
 * Assemble every visible row: matched commands first, then unified search
 * hits grouped per corpus (empty query → commands + recent selections).
 */
export function buildRows(params: {
  query: string
  commands: PaletteItem[]
  search: UnifiedSearchResult
  navigate: Navigate
}): GroupedRows {
  const { query, commands, search, navigate } = params
  const q = query.trim()

  const byGroup = new Map<PaletteGroupId, PaletteItem[]>()
  const add = (groupId: PaletteGroupId, items: PaletteItem[]): void => {
    if (!items.length) return
    byGroup.set(groupId, [...(byGroup.get(groupId) ?? []), ...items].slice(0, GROUP_MAX))
  }

  const matched = q ? matchCommands(q, commands) : commands
  add('actions', matched.filter((item) => item.groupId === 'actions'))
  add('navigate', matched.filter((item) => item.groupId === 'navigate'))

  if (!q) add('recent', recentRows(navigate))

  add('memories', search.memories.map((hit) => memoryRow(hit, navigate)))
  add('entities', search.entities.map((entity) => entityRow(entity, navigate)))
  add('facts', search.facts.map((hit) => factRow(hit, q, navigate)))

  const groups = PALETTE_GROUP_ORDER.flatMap((id) => {
    const items = byGroup.get(id)
    return items && items.length > 0 ? [{ id, label: PALETTE_GROUPS[id].label, items }] : []
  })

  return { groups, flat: groups.flatMap((group) => group.items) }
}
