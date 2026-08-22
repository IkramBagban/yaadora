import { Badge } from '../../components/ui/Badge'
import { formatDate, formatPercent } from '../../lib/format'

/** Horizontal confidence meter (0..1) with numeric label. */
export function ConfidenceBar({ value }: { value: number | null }) {
  const pct = value == null ? 0 : Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div className="flex items-center gap-sm">
      <div
        className="h-1.5 w-24 shrink-0 rounded-pill bg-surface-alt"
        role="progressbar"
        aria-label="Confidence"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-pill bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-caption text-ink2">{formatPercent(value)} confidence</span>
    </div>
  )
}

/** From → to text for one fact's validity; open span ends in a "current" pill. */
export function ValidityRange({ from, to }: { from: string | null; to: string | null }) {
  return (
    <span className="flex flex-wrap items-center gap-xs text-caption text-ink2">
      <span>{formatDate(from)}</span>
      <span aria-hidden className="text-ink3">→</span>
      {to ? <span>{formatDate(to)}</span> : <Badge tone="success">current</Badge>}
    </span>
  )
}

/** A fact's validity span plotted on a shared time axis (chain timelines). */
export function SpanBar({
  from,
  to,
  axisFrom,
  axisTo,
}: {
  from: number
  to: number
  axisFrom: number
  axisTo: number
}) {
  const span = Math.max(axisTo - axisFrom, 1)
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
  const left = clamp01((from - axisFrom) / span) * 100
  const right = clamp01((to - axisFrom) / span) * 100
  const width = Math.max(right - left, 2)
  return (
    <div
      className="h-1.5 w-full rounded-pill bg-surface-alt"
      title={`${formatDate(new Date(from).toISOString())} → ${
        to >= axisTo ? 'now' : formatDate(new Date(to).toISOString())
      }`}
    >
      <div
        className="h-full rounded-pill bg-accent"
        style={{ left: `${left}%`, width: `${width}%`, position: 'relative' }}
      />
    </div>
  )
}
