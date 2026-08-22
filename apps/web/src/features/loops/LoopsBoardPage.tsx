import { useState, type ReactNode } from 'react'
import { List, LayoutGrid, Plus, AlertCircle } from 'lucide-react'
import { ApiError } from '../../api/client'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { cn } from '../../lib/cn'
import { computeAgingStats, isOverdue } from './loopUtils'
import {
  useConvertToReminder,
  useLoopsQuery,
  usePatchLoop,
} from './useLoops'
import type { Loop, LoopStatus } from './types'
import { AgingStrip } from './components/AgingStrip'
import { ConvertReminderDialog } from './components/ConvertReminderDialog'
import { EditLoopDialog } from './components/EditLoopDialog'
import { KanbanBoard } from './components/KanbanBoard'
import { KindRows } from './components/KindRows'
import { PlantLoopDialog } from './components/PlantLoopDialog'
import { ResolveLoopDialog } from './components/ResolveLoopDialog'

type ViewMode = 'board' | 'list'
type ActiveDialog =
  | { type: 'plant' }
  | { type: 'edit'; loop: Loop }
  | { type: 'resolve'; loop: Loop }
  | { type: 'convert'; loop: Loop }
  | null

/** Open Loops board page (issue #11): intentions tracker over open_loops. */
export function LoopsBoardPage() {
  const loopsQuery = useLoopsQuery()
  const patchLoop = usePatchLoop()
  const convert = useConvertToReminder()

  const [view, setView] = useState<ViewMode>('board')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [dialog, setDialog] = useState<ActiveDialog>(null)

  const all = loopsQuery.data?.items ?? []
  // A stable-ish "now" per render keeps overdue chips and ages consistent.
  const now = new Date()
  const visible = overdueOnly ? all.filter((loop) => isOverdue(loop, now)) : all
  const stats = computeAgingStats(all, now)

  if (loopsQuery.isPending) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-ink2">
        <Spinner size={24} />
      </div>
    )
  }

  if (loopsQuery.isError) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-sm text-center">
        <AlertCircle className="text-danger" />
        <p className="text-sub text-ink2">
          {loopsQuery.error instanceof ApiError
            ? loopsQuery.error.message
            : 'Could not load your loops.'}
        </p>
        <Button variant="secondary" onClick={() => void loopsQuery.refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  const closeDialog = () => setDialog(null)

  /** One-click convert when a due date exists; otherwise ask for a fire time. */
  const handleConvertClick = (loop: Loop) => {
    if (loop.dueAt) convert.mutate({ loop })
    else setDialog({ type: 'convert', loop })
  }

  return (
    <section className="flex flex-col gap-xl">
      <header className="flex flex-wrap items-center justify-between gap-md">
        <div>
          <h1 className="text-display font-bold tracking-tight">Open loops</h1>
          <p className="text-sub text-ink2">
            Everything unfinished — commitments, goals, events, threads.
          </p>
        </div>
        <Button onClick={() => setDialog({ type: 'plant' })}>
          <Plus size={15} /> Plant loop
        </Button>
      </header>

      <AgingStrip stats={stats} />

      <div className="flex flex-wrap items-center justify-between gap-sm">
        <Segmented<ViewMode>
          value={view}
          onChange={setView}
          options={[
            { value: 'board', label: 'Kanban', icon: LayoutGrid },
            { value: 'list', label: 'By kind', icon: List },
          ]}
        />
        <FilterChip active={overdueOnly} onClick={() => setOverdueOnly((v) => !v)}>
          Overdue only ({stats.overdueCount})
        </FilterChip>
      </div>

      {view === 'board' ? (
        <KanbanBoard
          loops={visible}
          now={now}
          onOpen={(loop) => setDialog({ type: 'edit', loop })}
          onConvert={handleConvertClick}
          onResolve={(loop) => setDialog({ type: 'resolve', loop })}
          onMove={(id: string, status: LoopStatus) => patchLoop.mutate({ id, patch: { status } })}
        />
      ) : (
        <KindRows
          loops={visible}
          now={now}
          onOpen={(loop) => setDialog({ type: 'edit', loop })}
          onConvert={handleConvertClick}
          onResolve={(loop) => setDialog({ type: 'resolve', loop })}
        />
      )}

      {dialog?.type === 'plant' && <PlantLoopDialog onClose={closeDialog} onPlanted={closeDialog} />}
      {dialog?.type === 'edit' && (
        <EditLoopDialog
          loop={dialog.loop}
          busy={patchLoop.isPending}
          onSave={(loop, patch) =>
            patchLoop.mutate(
              { id: loop.id, patch },
              { onSuccess: closeDialog },
            )
          }
          onClose={closeDialog}
        />
      )}
      {dialog?.type === 'resolve' && (
        <ResolveLoopDialog
          loop={dialog.loop}
          busy={patchLoop.isPending}
          onConfirm={(loop, evidenceId) =>
            patchLoop.mutate(
              {
                id: loop.id,
                patch: evidenceId
                  ? { status: 'resolved', resolvedBy: evidenceId }
                  : { status: 'resolved' },
              },
              { onSuccess: closeDialog },
            )
          }
          onClose={closeDialog}
        />
      )}
      {dialog?.type === 'convert' && (
        <ConvertReminderDialog
          loop={dialog.loop}
          busy={convert.isPending}
          onConfirm={(loop, dueAt) => convert.mutate({ loop, dueAt }, { onSuccess: closeDialog })}
          onClose={closeDialog}
        />
      )}
    </section>
  )
}

interface SegmentedProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: Array<{ value: T; label: string; icon: typeof LayoutGrid }>
}

function Segmented<T extends string>({ value, onChange, options }: SegmentedProps<T>) {
  return (
    <div className="inline-flex rounded-pill border border-hairline bg-surface p-xs" role="tablist">
      {options.map(({ value: option, label, icon: Icon }) => (
        <button
          key={option}
          role="tab"
          aria-selected={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'inline-flex items-center gap-xs rounded-pill px-lg py-1 text-caption-medium transition-colors',
            value === option ? 'bg-accent-soft text-accent' : 'text-ink2 hover:text-ink',
          )}
        >
          <Icon size={13} /> {label}
        </button>
      ))}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded-pill border px-lg py-1 text-caption-medium transition-colors',
        active
          ? 'border-danger bg-accent-soft text-danger'
          : 'border-hairline text-ink2 hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}
