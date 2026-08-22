import { Link } from '@tanstack/react-router'
import { Badge } from '../ui/Badge'
import { Skeleton } from '../ui/Skeleton'
import { WidgetCard, WidgetEmpty, WidgetError } from './parts'
import { dueSoonLoops, useOpenLoops } from '../../hooks/useOverviewData'
import { relativeDue } from '../../lib/time'

const VISIBLE = 5

const kindLabel = (kind: string): string => kind.replaceAll('_', ' ')

export function DueSoonLoops() {
  const { data, isError, isPending, refetch } = useOpenLoops()
  const dueSoon = data ? dueSoonLoops(data.items, 14).slice(0, VISIBLE) : []

  return (
    <WidgetCard
      title="Due soon"
      action={
        <Link to="/loops" className="text-caption-medium text-accent hover:underline">
          All loops
        </Link>
      }
    >
      {isError ? (
        <WidgetError onRetry={() => void refetch()} />
      ) : isPending ? (
        <div className="flex flex-col gap-md">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center justify-between gap-md">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-5 w-16 rounded-pill" />
            </div>
          ))}
        </div>
      ) : dueSoon.length === 0 ? (
        <WidgetEmpty>Nothing due in the next two weeks.</WidgetEmpty>
      ) : (
        <ul className="flex flex-col gap-md">
          {dueSoon.map((loop) => {
            const due = loop.dueAt ? relativeDue(loop.dueAt) : null
            return (
              <li key={loop.id} className="flex items-start justify-between gap-md">
                <div className="min-w-0">
                  <p className="truncate text-sub">{loop.title}</p>
                  <p className="text-caption text-ink3">
                    {loop.entityName ?? kindLabel(loop.kind)}
                  </p>
                </div>
                {due && (
                  <Badge tone={due.overdue ? 'danger' : due.label === 'today' ? 'pending' : 'neutral'} className="shrink-0">
                    {due.label}
                  </Badge>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </WidgetCard>
  )
}
