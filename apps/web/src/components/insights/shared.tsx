import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'
import { Card } from '../ui/Card'
import { cn } from '../../lib/cn'
import { CHART } from './lib'

/**
 * Shared primitives for Insights sections. Every section renders through
 * SectionCard so skeletons, error states and empty states stay uniform.
 */

// --- Section shell ---------------------------------------------------------------

interface SectionCardProps {
  title: string
  /** Honest framing of what the data does (and does not) cover. */
  description?: string
  loading?: boolean
  error?: unknown
  isEmpty?: boolean
  emptyMessage?: string
  /** Extra node under the header (kpi row etc.) — hidden while loading. */
  headerExtra?: ReactNode
  onRetry?: () => void
  className?: string
  children: ReactNode
}

export function SectionCard({
  title,
  description,
  loading = false,
  error,
  isEmpty = false,
  emptyMessage = 'Nothing here yet.',
  headerExtra,
  onRetry,
  className,
  children,
}: SectionCardProps) {
  return (
    <Card className={cn('flex flex-col gap-lg', className)}>
      <header className="flex flex-col gap-xs">
        <h2 className="text-title font-semibold">{title}</h2>
        {description && !loading && !error ? (
          <p className="text-caption text-ink2">{description}</p>
        ) : null}
        {headerExtra && !loading && !error ? headerExtra : null}
      </header>

      {loading ? (
        <SkeletonBlock />
      ) : error ? (
        <SectionError onRetry={onRetry} />
      ) : isEmpty ? (
        <EmptyState message={emptyMessage} />
      ) : (
        children
      )}
    </Card>
  )
}

// --- States ------------------------------------------------------------------------

export function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div className={cn('flex min-h-40 flex-col justify-end gap-sm', className)} aria-hidden="true">
      <div className="h-3 w-1/3 animate-pulse rounded-pill bg-surface-alt" />
      <div className="h-28 w-full animate-pulse rounded-md bg-surface-alt" />
      <div className="h-3 w-2/3 animate-pulse rounded-pill bg-surface-alt" />
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-sm py-lg text-center">
      <span className="flex size-10 items-center justify-center rounded-pill bg-surface-alt text-ink3">
        <Inbox size={18} />
      </span>
      <p className="max-w-56 text-caption text-ink2">{message}</p>
    </div>
  )
}

function SectionError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-sm py-lg text-center">
      <p className="text-caption text-ink2">Couldn't load this section.</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-pill border border-hairline px-md py-1 text-micro uppercase text-ink2 transition-colors hover:border-accent hover:text-ink"
        >
          Retry
        </button>
      )}
    </div>
  )
}

// --- Recharts helpers --------------------------------------------------------------
//
// Use as `<Tooltip content={<ChartTooltip …} />` — Recharts clones the element
// and injects active/label/payload at runtime, so those props stay optional.

interface TooltipEntry {
  name?: string | number
  value?: string | number
  color?: string
}

export function ChartTooltip({
  active,
  label,
  payload,
  labelFormatter,
}: {
  active?: boolean
  label?: string | number
  payload?: TooltipEntry[]
  labelFormatter?: (label: string | number) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-sm border border-hairline bg-surface px-md py-sm shadow-lg">
      {label !== undefined && (
        <p className="mb-1 text-micro uppercase text-ink2">
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      )}
      <ul className="flex flex-col gap-0.5">
        {payload.map((e) => (
          <li key={String(e.name)} className="flex items-center gap-sm text-caption text-ink">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-pill"
              style={{ backgroundColor: e.color ?? CHART.muted }}
            />
            <span>{e.name}</span>
            <span className="ml-auto pl-md font-medium tabular-nums">{e.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
