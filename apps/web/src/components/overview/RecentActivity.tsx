import { Link } from '@tanstack/react-router'
import { Circle, FileUp, MessagesSquare, Mic, PenLine } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Skeleton } from '../ui/Skeleton'
import { WidgetCard, WidgetEmpty, WidgetError } from './parts'
import { useRecentMemories } from '../../hooks/useOverviewData'
import { relativeTime } from '../../lib/time'
import type { MemorySource } from '../../api/types'

const ICON_BY_SOURCE: Record<string, LucideIcon> = {
  manual: PenLine,
  voice: Mic,
  conversation: MessagesSquare,
  import: FileUp,
}

const sourceIcon = (source: MemorySource): LucideIcon => ICON_BY_SOURCE[source] ?? Circle

export function RecentActivity() {
  const { data, isError, isPending, refetch } = useRecentMemories()
  const items = data?.items ?? []

  return (
    <WidgetCard
      title="Recent activity"
      action={
        <Link to="/timeline" className="text-caption-medium text-accent hover:underline">
          View timeline
        </Link>
      }
    >
      {isError ? (
        <WidgetError onRetry={() => void refetch()} />
      ) : isPending ? (
        <div className="flex flex-col gap-lg">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-start gap-md">
              <Skeleton className="size-8 rounded-pill" />
              <div className="flex w-full flex-col gap-xs">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3.5 w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <WidgetEmpty>Your latest captures will appear here.</WidgetEmpty>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {items.map((memory) => {
            const Icon = sourceIcon(memory.source)
            return (
              <li key={memory.id} className="flex items-start gap-md py-md first:pt-0 last:pb-0">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-accent">
                  <Icon size={14} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sub leading-snug">{memory.rawText}</p>
                  <p className="mt-xs flex items-center gap-sm text-caption text-ink3">
                    <span>{memory.source}</span>
                    <span>{relativeTime(memory.createdAt)}</span>
                    {memory.status === 'pending' && <Badge tone="neutral">processing</Badge>}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </WidgetCard>
  )
}
