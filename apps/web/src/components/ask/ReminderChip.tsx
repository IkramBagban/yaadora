import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { BellRing, Check, X } from 'lucide-react'
import { request } from '../../api/client'
import type { Reminder, ReminderSuggestion } from '../../api/types'
import { formatDateTime } from '../../lib/format'
import { Spinner } from '../ui/Spinner'

/**
 * Transient reminder chip proposed by the capture pipeline. Nothing is stored
 * until the user confirms (POST /reminders/confirm, origin "suggested");
 * dismissing costs nothing because the suggestion was never persisted
 * (apps/server/src/routes/reminders.ts).
 */
export function ReminderChip({ suggestion }: { suggestion: ReminderSuggestion }) {
  const [outcome, setOutcome] = useState<'idle' | 'confirmed' | 'dismissed'>('idle')

  const confirm = useMutation({
    mutationFn: () =>
      request<Reminder>('/reminders/confirm', {
        method: 'POST',
        body: JSON.stringify({
          text: suggestion.text,
          dueAt: suggestion.dueAt,
          ...(suggestion.sourceMemoryId ? { sourceMemoryId: suggestion.sourceMemoryId } : {}),
          origin: 'suggested',
          recurrence: 'once',
        }),
      }),
    onSuccess: () => setOutcome('confirmed'),
  })

  if (outcome === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-xs rounded-pill border border-hairline bg-accent-soft px-md py-sm text-caption-medium text-success">
        <Check size={13} />
        Reminder set
      </span>
    )
  }

  if (outcome === 'dismissed') return null

  return (
    <div className="flex flex-wrap items-center gap-sm rounded-md border border-hairline bg-surface px-md py-sm">
      <BellRing size={14} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 text-caption text-ink">
        <span className="font-medium">{suggestion.text}</span>
        <span className="ml-xs text-ink3">{formatDateTime(suggestion.dueAt)}</span>
      </span>
      <span className="flex shrink-0 items-center gap-xs">
        <button
          type="button"
          onClick={() => confirm.mutate()}
          disabled={confirm.isPending}
          className="inline-flex h-7 items-center gap-xs rounded-pill bg-accent px-sm text-micro font-medium text-on-accent transition-colors hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
        >
          {confirm.isPending ? <Spinner size={12} /> : <Check size={12} />}
          Remind me
        </button>
        <button
          type="button"
          onClick={() => setOutcome('dismissed')}
          disabled={confirm.isPending}
          aria-label="Dismiss reminder suggestion"
          className="inline-flex size-7 items-center justify-center rounded-pill text-ink3 transition-colors hover:bg-surface-alt hover:text-ink"
        >
          <X size={13} />
        </button>
      </span>
      {confirm.isError && (
        <span className="w-full text-micro text-danger">
          Couldn’t save that reminder. {confirm.error instanceof Error ? confirm.error.message : ''}
        </span>
      )}
    </div>
  )
}
