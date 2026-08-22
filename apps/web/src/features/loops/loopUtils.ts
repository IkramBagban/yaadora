import type { DragEvent as ReactDragEvent } from 'react'
import {
  CalendarClock,
  Flag,
  MessageCircle,
  Target,
  CircleHelp,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Loop, LoopKind, LoopStatus } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

// --- display metadata -------------------------------------------------------

export interface KindMeta {
  label: string
  icon: LucideIcon
}

/** Kind chips/headers; unknown extraction kinds fall back to a generic chip. */
export function kindMeta(kind: LoopKind): KindMeta {
  switch (kind) {
    case 'commitment':
      return { label: 'Commitment', icon: Flag }
    case 'goal':
      return { label: 'Goal', icon: Target }
    case 'upcoming_event':
      return { label: 'Upcoming event', icon: CalendarClock }
    case 'unresolved_conflict':
      return { label: 'Unresolved conflict', icon: MessageCircle }
    default:
      return { label: humanize(kind), icon: CircleHelp }
  }
}

export const STATUS_LABELS: Record<LoopStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  expired: 'Expired',
}

function humanize(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

// --- time helpers -----------------------------------------------------------

/** A loop is overdue when it is still open and its due date has passed. */
export function isOverdue(loop: Loop, now = new Date()): boolean {
  return loop.status === 'open' && loop.dueAt !== null && new Date(loop.dueAt) < now
}

/** Whole days between the loop's creation and `now` (floored, ≥ 0). */
export function ageInDays(loop: Loop, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(loop.createdAt).getTime()) / DAY_MS))
}

/** Compact age for card corners: today · 3d · 2w · 4mo · 1y+. */
export function formatAge(days: number): string {
  if (days <= 0) return 'today'
  if (days < 14) return `${days}d`
  if (days < 60) return `${Math.floor(days / 7)}w`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}

/** Due-date chip text; overdue loops get the raw date so urgency reads first. */
export function formatDue(dueAt: string | null, now = new Date()): string | null {
  if (!dueAt) return null
  const due = new Date(dueAt)
  const startOfToday = startOfDay(now)
  const diffDays = Math.round((startOfDay(due).getTime() - startOfToday.getTime()) / DAY_MS)
  if (diffDays === 0) return 'due today'
  if (diffDays === 1) return 'due tomorrow'
  if (diffDays === -1) return 'due yesterday'
  const sameYear = due.getFullYear() === now.getFullYear()
  const date = due.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  return diffDays < 0 ? `due ${date}` : `due in ${diffDays}d`
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// --- datetime-local input helpers -------------------------------------------

/** ISO → value usable by `<input type="datetime-local">`. */
export function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `<input type="datetime-local">` value → ISO datetime (Z), or null when empty/invalid. */
export function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// --- drag & drop ------------------------------------------------------------

/** dataTransfer key carrying the dragged loop id between kanban columns. */
const LOOP_DRAG_MIME = 'application/x-yaadora-loop-id'

export function setLoopDragData(
  event: ReactDragEvent<Element>,
  id: string,
): void {
  event.dataTransfer.setData(LOOP_DRAG_MIME, id)
  event.dataTransfer.effectAllowed = 'move'
}

export function getLoopDragData(event: ReactDragEvent<Element>): string | null {
  return event.dataTransfer.getData(LOOP_DRAG_MIME) || null
}

// --- aging stats ------------------------------------------------------------

export interface AgingStats {
  openCount: number
  /** Mean age of currently-open loops in days (0 when none are open). */
  averageAgeDays: number
  /** Longest-open loop, or null when nothing is open. */
  oldest: Loop | null
  overdueCount: number
}

/** Aging roll-up over the whole board payload. */
export function computeAgingStats(loops: Loop[], now = new Date()): AgingStats {
  let openCount = 0
  let totalAge = 0
  let oldest: Loop | null = null
  let overdueCount = 0

  for (const loop of loops) {
    if (loop.status !== 'open') continue
    openCount += 1
    totalAge += ageInDays(loop, now)
    if (!oldest || new Date(loop.createdAt) < new Date(oldest.createdAt)) {
      oldest = loop
    }
    if (isOverdue(loop, now)) overdueCount += 1
  }

  return {
    openCount,
    averageAgeDays: openCount > 0 ? Math.round(totalAge / openCount) : 0,
    oldest,
    overdueCount,
  }
}
