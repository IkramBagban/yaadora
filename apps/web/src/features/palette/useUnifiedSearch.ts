import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { request } from '../../api/client'
import type { EntityListItem } from '../../api/types'
import { fuzzyMatch } from './fuzzy'
import type { FactSearchHit, MemorySearchHit } from './types'

const SEARCH_LIMIT = 12
const ENTITY_POOL_LIMIT = 40
const DEBOUNCE_MS = 180

export interface UnifiedSearchResult {
  memories: MemorySearchHit[]
  facts: FactSearchHit[]
  entities: EntityListItem[]
  /** True while any underlying query is in flight for the active query. */
  isSearching: boolean
  /** True when the hybrid-search endpoint failed for the active query. */
  isError: boolean
}

/** Trailing-edge debounce so typing stays snappy before queries fire. */
export function useDebouncedValue<T>(value: T, delayMs = DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

async function searchMemoriesAndFacts(q: string): Promise<{ query: string; memories: MemorySearchHit[]; facts: FactSearchHit[] }> {
  const params = new URLSearchParams({ q, limit: String(SEARCH_LIMIT) })
  return request(`/memories/search?${params.toString()}`)
}

async function listEntities(): Promise<EntityListItem[]> {
  return request('/entities')
}

/**
 * Unified search across the three searchable corpora:
 * - memories + facts: server hybrid retrieval (`GET /memories/search`)
 * - entities: directory listing (cached) ranked with the same fuzzy matcher
 *   used for commands — entity names/aliases are short, exact-ish strings
 */
export function useUnifiedSearch(query: string): UnifiedSearchResult {
  const trimmed = query.trim()
  const debounced = useDebouncedValue(trimmed)
  const hasQuery = debounced.length > 0

  const corpus = useQuery({
    queryKey: ['palette', 'search', debounced],
    queryFn: () => searchMemoriesAndFacts(debounced),
    enabled: hasQuery,
    staleTime: 30_000,
    placeholderData: (previous) => previous ?? undefined,
  })

  const entities = useQuery({
    queryKey: ['palette', 'entities'],
    queryFn: listEntities,
    enabled: hasQuery,
    staleTime: 5 * 60_000,
  })

  if (!hasQuery) {
    return { memories: [], facts: [], entities: [], isSearching: false, isError: false }
  }

  const matchedEntities = matchEntities(entities.data ?? [], debounced)

  return {
    memories: corpus.data?.memories ?? [],
    facts: corpus.data?.facts ?? [],
    entities: matchedEntities,
    isSearching: (hasQuery && corpus.isPending) || entities.isPending,
    isError: corpus.isError,
  }
}

function matchEntities(all: EntityListItem[], query: string): EntityListItem[] {
  return all
    .map((entity) => ({ entity, score: fuzzyMatch(query, entity.canonicalName) ?? Number.NEGATIVE_INFINITY }))
    .filter((hit) => Number.isFinite(hit.score))
    .sort((a, b) => b.score - a.score || (b.entity.mentionCount ?? 0) - (a.entity.mentionCount ?? 0))
    .slice(0, ENTITY_POOL_LIMIT)
    .map((hit) => hit.entity)
}
