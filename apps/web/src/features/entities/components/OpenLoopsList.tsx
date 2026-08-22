import { Link } from '@tanstack/react-router'
import { Badge } from '../../../components/ui/Badge'
import { formatRelative } from '../format'
import { loopKindMeta } from '../meta'
import type { EntityContextLoop } from '../api'
import { EmptyBlock } from './states'

interface OpenLoopsListProps {
  loops: EntityContextLoop[]
}

const isOverdue = (dueAt: string | null): boolean =>
  dueAt !== null && Date.parse(dueAt) < Date.now()

/** Attached open loops for this entity (commitments, threads, goals…). */
export function OpenLoopsList({ loops }: OpenLoopsListProps) {
  if (loops.length === 0) {
    return <EmptyBlock title="No open loops attached." hint="Unresolved commitments about this entity will collect here." />
  }

  return (
    <ul className="flex flex-col divide-y divide-hairline">
      {loops.map((loop) => {
        const Icon = loopKindMeta(loop.kind).icon
        const overdue = isOverdue(loop.dueAt)

        return (
          <li key={loop.id} className="flex items-start gap-md py-md">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm bg-accent-soft text-accent">
              <Icon size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sub text-ink">{loop.title}</p>
              <div className="mt-xs flex flex-wrap items-center gap-sm text-caption">
                <Badge tone="accent">{loop.kind.replace(/_/g, ' ')}</Badge>
                {loop.dueAt && (
                  <span className={overdue ? 'font-medium text-danger' : 'text-ink3'}>
                    {overdue ? 'overdue' : 'due'} {formatRelative(loop.dueAt)}
                  </span>
                )}
              </div>
            </div>
            <Link
              to="/loops"
              className="shrink-0 self-center text-caption text-accent hover:underline"
              title="Open the loops board"
            >
              board
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
