import type { ReactNode } from 'react'
import { Inbox, RotateCcw, ShieldAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'
import { cn } from '../../lib/cn'
import { tabBaseClasses } from './lib'

/**
 * Shared UI primitives for the admin panel: page/panel shells, stat cards,
 * tab bars, table atoms, and the "Admins only" gate notice. Visual language
 * follows the existing overview/insights widgets so admin feels native in
 * both themes.
 */

// --- Page header -----------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-md">
      <div className="flex flex-col gap-xs">
        <h1 className="text-display font-bold tracking-tight">{title}</h1>
        {description ? <p className="text-sub text-ink2">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-sm">{actions}</div> : null}
    </header>
  )
}

// --- Panels ----------------------------------------------------------------------

interface PanelProps {
  title?: string
  description?: string
  action?: ReactNode
  /** Extra node under the header title (kpi row etc.) — hidden while loading/error. */
  headerExtra?: ReactNode
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  isEmpty?: boolean
  emptyMessage?: string
  /** Skip padding for full-bleed tables. */
  flush?: boolean
  className?: string
  children: ReactNode
}

/** Card with header + uniform loading/error/empty/content states. */
export function Panel({
  title,
  description,
  action,
  headerExtra,
  loading = false,
  error,
  onRetry,
  isEmpty = false,
  emptyMessage = 'Nothing here yet.',
  flush = false,
  className,
  children,
}: PanelProps) {
  const showHeader = Boolean(title || action)
  return (
    <Card padded={false} className={cn('flex flex-col', className)}>
      {showHeader ? (
        <div className="flex flex-wrap items-center justify-between gap-md border-b border-hairline px-xl py-md">
          <div>
            {title ? <h2 className="text-sub font-semibold">{title}</h2> : null}
            {description && !loading && !error ? (
              <p className="mt-0.5 text-caption text-ink2">{description}</p>
            ) : null}
            {headerExtra && !loading && !error ? (
              <div className="mt-sm">{headerExtra}</div>
            ) : null}
          </div>
          {action}
        </div>
      ) : null}
      <div className={cn('min-w-0', flush || loading || error || isEmpty ? '' : 'p-xl')}>
        {loading ? (
          <ListSkeleton />
        ) : error ? (
          <StateBlock
            icon={RotateCcw as LucideIcon}
            message="Couldn't load this."
            action={
              onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-pill border border-hairline px-md py-1 text-micro uppercase text-ink2 transition-colors hover:border-accent hover:text-ink"
                >
                  Retry
                </button>
              ) : undefined
            }
          />
        ) : isEmpty ? (
          <StateBlock icon={Inbox} message={emptyMessage} />
        ) : (
          children
        )}
      </div>
    </Card>
  )
}

// --- States -----------------------------------------------------------------------

function StateBlock({
  icon: Icon,
  message,
  action,
}: {
  icon: LucideIcon
  message: string
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-sm px-xl py-lg text-center">
      <span className="flex size-10 items-center justify-center rounded-pill bg-surface-alt text-ink3">
        <Icon size={18} aria-hidden="true" />
      </span>
      <p className="max-w-xs text-caption text-ink2">{message}</p>
      {action}
    </div>
  )
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-sm p-xl" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={i % 3 === 0 ? 'h-10 w-5/6' : 'h-10 w-full'} />
      ))}
    </div>
  )
}

// --- Stats ------------------------------------------------------------------------

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string
  value: string | number
  hint?: string
  icon?: LucideIcon
}) {
  return (
    <Card className="flex flex-col gap-md">
      <div className="flex items-center gap-sm text-ink2">
        {Icon ? (
          <span className="flex size-7 items-center justify-center rounded-sm bg-accent-soft text-accent">
            <Icon size={15} aria-hidden="true" />
          </span>
        ) : null}
        <span className="text-caption-medium uppercase tracking-wide text-ink2">{label}</span>
      </div>
      <div>
        <p className="text-display font-bold tracking-tight tabular-nums">{value}</p>
        {hint ? <p className="mt-1 text-caption text-ink3">{hint}</p> : null}
      </div>
    </Card>
  )
}

/** Small label/value chip used inside tables and run histories. */
export function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="inline-flex items-baseline gap-xs rounded-pill bg-surface-alt px-md py-0.5">
      <span className="text-micro uppercase text-ink3">{label}</span>
      <span className="text-caption font-semibold tabular-nums text-ink">{value}</span>
    </span>
  )
}

// --- Tabs --------------------------------------------------------------------------

export interface TabItem {
  id: string
  label: string
}

/** Button-driven segmented tab bar (user detail inner tabs). */
export function TabBar({
  items,
  active,
  onSelect,
  ariaLabel,
}: {
  items: readonly TabItem[]
  active: string
  onSelect: (id: string) => void
  ariaLabel: string
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex flex-wrap gap-xs">
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={t.id === active}
          onClick={() => onSelect(t.id)}
          className={cn(
            tabBaseClasses,
            t.id === active
              ? 'bg-accent-soft text-accent'
              : 'text-ink2 hover:bg-surface-alt hover:text-ink',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// --- Gate ---------------------------------------------------------------------------

/** Centered shell used by the admin layout while checking / showing the gate. */
export function GateShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-lg">
      <Card className="flex max-w-md flex-col items-center gap-md p-xxl text-center">{children}</Card>
    </div>
  )
}

/**
 * "Admins only" — shown by the layout when /me lacks the admin role, and
 * swapped into any panel whose query fails with 403.
 */
export function AdminOnlyNotice() {
  return (
    <>
      <span className="flex size-12 items-center justify-center rounded-pill bg-accent-soft text-accent">
        <ShieldAlert size={22} aria-hidden="true" />
      </span>
      <h2 className="text-title font-semibold">Admins only</h2>
      <p className="text-caption text-ink2">
        This area is restricted to yaadora administrators. Your account doesn't have
        the admin role.
      </p>
    </>
  )
}
