import type { PaletteGroupId } from './types'

/**
 * Recent palette selections, persisted to localStorage (same guarded pattern
 * as ThemeProvider). Recents re-run their stored target; only cheap, stable
 * identity is stored — never closures.
 */
const STORAGE_KEY = 'yaadora-palette-recents'
const MAX_RECENTS = 5

export interface RecentEntry {
  id: string
  groupId: PaletteGroupId
  label: string
  /** Absolute href the selection navigated to. */
  href: string
}

export function getRecents(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecentEntry).slice(0, MAX_RECENTS)
  } catch {
    return []
  }
}

export function pushRecent(entry: Omit<RecentEntry, 'id'> & { id: string }): void {
  const next = [entry, ...getRecents().filter((r) => r.id !== entry.id)].slice(0, MAX_RECENTS)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // storage unavailable (private mode); recents are best-effort
  }
}

function isRecentEntry(value: unknown): value is RecentEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.label === 'string' &&
    typeof v.href === 'string' &&
    typeof v.groupId === 'string'
  )
}
