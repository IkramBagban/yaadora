import { useState } from 'react'
import { cn } from '../../../lib/cn'
import { getLoopDragData, STATUS_LABELS } from '../loopUtils'
import { LOOP_STATUSES, type Loop, type LoopStatus } from '../types'
import { LoopCard } from './LoopCard'

interface KanbanBoardProps {
  loops: Loop[]
  now: Date
  onOpen: (loop: Loop) => void
  onConvert: (loop: Loop) => void
  onResolve: (loop: Loop) => void
  /** Persist a card dropped into another lifecycle column. */
  onMove: (id: string, status: LoopStatus) => void
  /** True while a loop action is in flight; disables card actions. */
  busy?: boolean
}

/**
 * L-1 kanban: columns by status. Cards drag between columns; the drop
 * persists through PATCH /open-loops/:id (optimistic in usePatchLoop).
 */
export function KanbanBoard({
  loops,
  now,
  onOpen,
  onConvert,
  onResolve,
  onMove,
  busy = false,
}: KanbanBoardProps) {
  const [hoverColumn, setHoverColumn] = useState<LoopStatus | null>(null)

  const byStatus = groupByStatus(loops)

  return (
    <div className="grid grid-cols-1 gap-lg md:grid-cols-3">
      {LOOP_STATUSES.map((status) => {
        const column = byStatus.get(status) ?? []
        const isHover = hoverColumn === status
        return (
          <section
            key={status}
            aria-label={`${STATUS_LABELS[status]} loops`}
            className={cn(
              'flex min-h-[40vh] flex-col gap-sm rounded-lg border bg-surface-alt/60 p-md transition-colors',
              isHover ? 'border-accent' : 'border-hairline',
            )}
            onDragOver={(event) => {
              event.preventDefault()
              setHoverColumn(status)
            }}
            onDragLeave={() => setHoverColumn((c) => (c === status ? null : c))}
            onDrop={(event) => {
              event.preventDefault()
              setHoverColumn(null)
              const id = getLoopDragData(event)
              if (!id) return
              const dragged = loops.find((l) => l.id === id)
              if (dragged && dragged.status !== status) onMove(id, status)
            }}
          >
            <header className="flex items-center justify-between px-xs">
              <h2 className="text-caption-medium uppercase tracking-wide text-ink2">
                {STATUS_LABELS[status]}
              </h2>
              <span className="text-micro text-ink3">{column.length}</span>
            </header>

            <div className="flex flex-col gap-sm">
              {column.map((loop) => (
                <LoopCard
                  key={loop.id}
                  loop={loop}
                  now={now}
                  draggable={!busy}
                  busy={busy}
                  onOpen={onOpen}
                  onConvert={onConvert}
                  onResolve={onResolve}
                />
              ))}
              {column.length === 0 && (
                <p className="rounded-md border border-dashed border-hairline px-md py-lg text-center text-caption text-ink3">
                  {status === 'open' ? 'Nothing pending — plant one?' : 'Empty'}
                </p>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** Bucket loops per status; within a column soonest-due first (undated sink). */
function groupByStatus(loops: Loop[]): Map<LoopStatus, Loop[]> {
  const byStatus = new Map<LoopStatus, Loop[]>(
    LOOP_STATUSES.map((status) => [status, []]),
  )
  for (const loop of loops) {
    byStatus.get(loop.status)?.push(loop)
  }
  for (const column of byStatus.values()) {
    column.sort((a, b) => {
      if (!a.dueAt && !b.dueAt) return 0
      if (!a.dueAt) return 1
      if (!b.dueAt) return -1
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
    })
  }
  return byStatus
}
