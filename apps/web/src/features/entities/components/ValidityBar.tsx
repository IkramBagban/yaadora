import { formatDate } from '../format'

interface ValidityBarProps {
  /** Bitemporal span of a fact or relationship (ISO strings). */
  validFrom: string | null
  /** null = still currently true. */
  validTo: string | null
  /** Observation window (epoch ms) the bar is positioned within — usually the entity's first-seen → now. */
  windowStart: number
  windowEnd: number
}

const pct = (value: number, start: number, end: number): number => {
  if (end <= start) return 0
  return Math.min(100, Math.max(0, ((value - start) / (end - start)) * 100))
}

/**
 * E-3 validity bar: renders a fact's `valid_from → valid_to` span inside the
 * entity observation window. Current facts render in accent; closed spans are
 * visually distinct (muted) per the track checklist.
 */
export function ValidityBar({ validFrom, validTo, windowStart, windowEnd }: ValidityBarProps) {
  const start = validFrom ? new Date(validFrom).getTime() : null
  const end = validTo ? new Date(validTo).getTime() : null

  // Unknown bounds can't be placed honestly — render an indeterminate sliver.
  const leftPct = start !== null && !Number.isNaN(start) ? pct(start, windowStart, windowEnd) : null
  const rightPct = end !== null && !Number.isNaN(end) ? pct(end, windowStart, windowEnd) : 100

  const isCurrent = validTo === null
  const title = `${formatDate(validFrom) || '?'} → ${formatDate(validTo) || 'now'}${isCurrent ? ' · current' : ' · superseded'}`

  return (
    <div
      className="relative h-1.5 w-full overflow-hidden rounded-pill bg-surface-alt"
      role="img"
      aria-label={title}
      title={title}
    >
      {leftPct === null ? (
        <div className="absolute inset-y-0 left-0 w-1/3 rounded-pill bg-hairline" />
      ) : (
        <div
          className={`absolute inset-y-0 rounded-pill ${isCurrent ? 'bg-accent' : 'bg-ink3/50'}`}
          style={{ left: `${leftPct}%`, width: `${Math.max(2, rightPct - leftPct)}%` }}
        />
      )}
    </div>
  )
}
