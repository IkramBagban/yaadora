import { Check, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Skeleton } from '../ui/Skeleton'
import { WidgetCard, WidgetEmpty, WidgetError } from './parts'
import { useReminderActions, useSuggestedReminders } from '../../hooks/useOverviewData'
import { relativeDue } from '../../lib/time'

const VISIBLE = 4

/** Suggested reminder chips awaiting a one-tap confirm or dismiss. */
export function SuggestedReminders() {
  const { data, isError, isPending, refetch } = useSuggestedReminders()
  const { confirm, dismiss } = useReminderActions()
  const items = data?.items.slice(0, VISIBLE) ?? []
  const hidden = (data?.items.length ?? 0) - items.length

  return (
    <WidgetCard
      title="Suggested reminders"
      action={
        data && data.items.length > 0 ? (
          <span className="text-caption text-ink3 tabular-nums">{data.items.length} waiting</span>
        ) : null
      }
    >
      {isError ? (
        <WidgetError onRetry={() => void refetch()} />
      ) : isPending ? (
        <div className="flex flex-col gap-md">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex items-center justify-between gap-md">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <WidgetEmpty>No suggested reminders right now.</WidgetEmpty>
      ) : (
        <ul className="flex flex-col gap-md">
          {items.map((reminder) => {
            const due = relativeDue(reminder.dueAt)
            const busy = confirm.isPending || dismiss.isPending
            return (
              <li key={reminder.id} className="flex items-start justify-between gap-md">
                <div className="min-w-0">
                  <p className="text-sub">{reminder.text}</p>
                  <p className="text-caption text-ink3">{due.label}</p>
                </div>
                <div className="flex shrink-0 gap-xs">
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`Confirm reminder: ${reminder.text}`}
                    disabled={busy}
                    onClick={() => confirm.mutate(reminder.id)}
                  >
                    <Check size={14} aria-hidden="true" />
                    Keep
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Dismiss reminder: ${reminder.text}`}
                    disabled={busy}
                    onClick={() => dismiss.mutate(reminder.id)}
                  >
                    <X size={14} aria-hidden="true" />
                  </Button>
                </div>
              </li>
            )
          })}
          {hidden > 0 && <li className="text-caption text-ink3">and {hidden} more</li>}
        </ul>
      )}
    </WidgetCard>
  )
}
