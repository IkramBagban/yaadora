import type { ReactNode } from 'react'
import { Bell, CheckCircle2, Link2 } from 'lucide-react'
import { Badge } from '../../../components/ui/Badge'
import { cn } from '../../../lib/cn'
import {
  ageInDays,
  formatAge,
  formatDue,
  isOverdue,
  kindMeta,
  setLoopDragData,
} from '../loopUtils'
import type { Loop } from '../types'

interface LoopCardProps {
  loop: Loop
  now: Date
  /** Open the detail/edit dialog. */
  onOpen: (loop: Loop) => void
  onConvert: (loop: Loop) => void
  onResolve: (loop: Loop) => void
  /** Wired by the kanban column; rows view renders cards static. */
  draggable?: boolean
  isDragging?: boolean
  /**
   * True while any loop action is in flight — disables the card's action
   * buttons so double-clicks cannot fire duplicate requests.
   */
  busy?: boolean
}

/**
 * One loop on the board: kind chip, title, due chip with overdue tone, age,
 * provenance hints and the two one-click actions (convert / resolve).
 */
export function LoopCard({
  loop,
  now,
  onOpen,
  onConvert,
  onResolve,
  draggable = false,
  isDragging = false,
  busy = false,
}: LoopCardProps) {
  const meta = kindMeta(loop.kind)
  const KindIcon = meta.icon
  const overdue = isOverdue(loop, now)
  const due = formatDue(loop.dueAt, now)
  const isOpen = loop.status === 'open'

  return (
    <div
      className={cn(
        'group rounded-md border border-hairline bg-surface p-md shadow-xs transition-colors',
        overdue && 'border-danger/40',
        isDragging && 'opacity-50',
      )}
      draggable={draggable}
      onDragStart={(event) => {
        if (!draggable) return
        setLoopDragData(event, loop.id)
      }}
    >
      <div className="mb-xs flex items-center justify-between gap-sm">
        <Badge tone={overdue ? 'danger' : 'neutral'}>
          <KindIcon size={11} className="mr-1" />
          {meta.label}
        </Badge>
        <span className="text-micro text-ink3" title={`created ${new Date(loop.createdAt).toLocaleDateString()}`}>
          {formatAge(ageInDays(loop, now))}
        </span>
      </div>

      <button
        type="button"
        onClick={() => onOpen(loop)}
        className="block w-full text-left"
        title={loop.title}
      >
        <span className="line-clamp-2 text-body font-medium leading-snug text-ink">
          {loop.title}
        </span>
      </button>

      {(due || loop.entityName || loop.sourceMemory === null) && (
        <div className="mt-sm flex flex-wrap items-center gap-xs">
          {due && (
            <Badge tone={overdue ? 'danger' : 'pending'} className={cn(overdue && 'animate-pulse')}>
              {due}
            </Badge>
          )}
          {loop.entityName && (
            <Badge tone="neutral">
              <Link2 size={11} className="mr-1" />
              {loop.entityName}
            </Badge>
          )}
          {loop.sourceMemory === null && (
            <Badge tone="accent" title="Planted manually — no source memory">
              planted
            </Badge>
          )}
        </div>
      )}

      {isOpen ? (
        <div className="mt-md flex items-center gap-xs opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          <CardAction
            label="Convert to reminder"
            onClick={() => onConvert(loop)}
            disabled={busy}
          >
            <Bell size={13} className="mr-1" /> Reminder
          </CardAction>
          <CardAction
            label="Resolve this loop"
            onClick={() => onResolve(loop)}
            disabled={busy}
          >
            <CheckCircle2 size={13} className="mr-1" /> Resolve
          </CardAction>
        </div>
      ) : (
        loop.status === 'resolved' &&
        loop.resolvedBy && (
          <p className="mt-sm flex items-center gap-xs text-caption text-success">
            <CheckCircle2 size={12} /> closed by evidence memory
          </p>
        )
      )}
    </div>
  )
}

function CardAction({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        if (!disabled) onClick()
      }}
      className="inline-flex items-center rounded-pill border border-hairline px-sm py-0.5 text-micro text-ink2 hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  )
}
