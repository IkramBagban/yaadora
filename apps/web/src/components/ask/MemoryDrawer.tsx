import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, X } from 'lucide-react'
import { request } from '../../api/client'
import type { MemoryDetail } from '../../api/types'
import { formatDateTime, formatRelativeTime } from '../../lib/format'
import { cn } from '../../lib/cn'
import { Spinner } from '../ui/Spinner'

/** One source listed in the drawer: a citation (with snippet) or raw evidence id. */
export interface DrawerEntry {
  memoryId: string
  snippet?: string
  occurredAt?: string | null
}

interface MemoryDrawerProps {
  open: boolean
  title: string
  entries: DrawerEntry[]
  /** entry to highlight + scroll to when the drawer opens */
  focusId: string | null
  onClose: () => void
}

function MemoryRow({ entry, focused }: { entry: DrawerEntry; focused: boolean }) {
  const ref = useRef<HTMLElement | null>(null)
  const detail = useQuery({
    queryKey: ['memory', entry.memoryId],
    queryFn: () =>
      request<MemoryDetail>(`/memories/${encodeURIComponent(entry.memoryId)}`),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' })
  }, [focused])

  const memory = detail.data?.memory

  return (
    <article
      ref={ref}
      className={cn(
        'rounded-md border p-md',
        focused ? 'border-accent bg-accent-soft' : 'border-hairline bg-surface',
      )}
    >
      {memory ? (
        <>
          <p className="whitespace-pre-wrap text-caption text-ink">{memory.rawText}</p>
          <p className="mt-xs flex flex-wrap gap-xs text-micro text-ink3">
            <span>{formatRelativeTime(memory.occurredAt ?? memory.createdAt)}</span>
            {memory.occurredAt && <span>· {formatDateTime(memory.occurredAt)}</span>}
            {detail.data && detail.data.facts.length > 0 && (
              <span>· {detail.data.facts.length} fact{detail.data.facts.length === 1 ? '' : 's'}</span>
            )}
            {detail.data && detail.data.entities.length > 0 && (
              <span>
                · {detail.data.entities.map((e) => e.canonicalName).slice(0, 3).join(', ')}
              </span>
            )}
          </p>
        </>
      ) : detail.isPending ? (
        <div className="flex items-center gap-sm text-caption text-ink3">
          <Spinner size={14} />
          Loading memory…
        </div>
      ) : detail.isError ? (
        <p className="text-caption text-danger">
          Couldn’t load this memory.
          {entry.snippet ? ' Showing the cited snippet instead:' : ''}
        </p>
      ) : null}

      {(!memory || detail.isError) && entry.snippet && (
        <p className="mt-xs whitespace-pre-wrap border-l-2 border-hairline pl-sm text-caption text-ink2">
          {entry.snippet}
        </p>
      )}
    </article>
  )
}

/**
 * Right-side source drawer for one answer. Citations (and nudge evidence)
 * become entries; full rows are fetched by id (GET /memories/:id) so the
 * snippet shows instantly and detail streams in behind it.
 */
export function MemoryDrawer({ open, title, entries, focusId, onClose }: MemoryDrawerProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  return (
    <>
      <div
        aria-hidden={!open}
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-black/30 transition-opacity',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        role="dialog"
        aria-label={title}
        aria-hidden={!open}
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-96 max-w-[90vw] flex-col border-l border-hairline bg-bg transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex h-14 shrink-0 items-center gap-sm border-b border-hairline px-lg">
          <BookOpen size={16} className="text-ink3" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sub font-semibold text-ink">{title}</h2>
            <p className="text-micro text-ink3">
              {entries.length} memor{entries.length === 1 ? 'y' : 'ies'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close sources"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-pill text-ink2 transition-colors hover:bg-surface-alt hover:text-ink"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-md">
          {entries.length === 0 ? (
            <p className="px-sm py-xl text-center text-caption text-ink3">
              Nothing to show yet.
            </p>
          ) : (
            <div className="flex flex-col gap-sm">
              {entries.map((entry) => (
                <MemoryRow
                  key={entry.memoryId}
                  entry={entry}
                  focused={open && entry.memoryId === focusId}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
