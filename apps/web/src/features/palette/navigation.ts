import { useCallback } from 'react'
import { useRouter } from '@tanstack/react-router'

/**
 * Deep-link contracts used by palette selections. The target pages are owned
 * by other track issues and are placeholders today; they ignore these params
 * until implemented. Keeping the mapping here is the single place that
 * documents where each result kind lands.
 */
export type SearchTarget =
  | { kind: 'memory'; memoryId: string }
  | { kind: 'fact'; query: string }
  | { kind: 'entity'; entityId: string }
  | { kind: 'path'; path: string }

function withParams(path: string, params: Record<string, string>): string {
  const search = new URLSearchParams(params).toString()
  return search ? `${path}?${search}` : path
}

export function targetToHref(target: SearchTarget): string {
  switch (target.kind) {
    case 'memory':
      return withParams('/timeline', { memory: target.memoryId })
    case 'fact':
      return withParams('/facts', { q: target.query })
    case 'entity':
      return withParams(`/entities/${encodeURIComponent(target.entityId)}`, {})
    case 'path':
      return target.path
  }
}

/** Navigate to an absolute in-app href (SPA push, no reload). */
export function usePaletteNavigate(): (href: string) => void {
  const router = useRouter()
  return useCallback(
    (href: string) => {
      void router.history.push(href)
    },
    [router],
  )
}

export const COMPOSER_PATHS = {
  newMemory: withParams('/timeline', { compose: 'memory' }),
  newReminder: withParams('/reminders', { compose: 'reminder' }),
} as const
