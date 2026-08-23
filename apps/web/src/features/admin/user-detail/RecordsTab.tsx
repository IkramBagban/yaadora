import { Fragment, useState } from 'react'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { useAdminUserMemories, useReprocessMemory } from '../api'
import type { AdminMemoryRow, MemoryStatusFilter } from '../types'
import { Panel, TabBar } from '../ui'
import { tableClasses, tdClasses, thClasses } from '../lib'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Spinner } from '../../../components/ui/Spinner'
import { formatDate, formatDateTime } from '../../../lib/format'

/**
 * Records tab — the user's raw captures. Filter All | ⚠ Failed; failed rows
 * are highlighted with a Reprocess action (POST reprocess) that flips the
 * row's status badge optimistically while the request is in flight. Rows
 * expand to show the full snippet + derived counts.
 */

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'failed', label: '⚠ Failed' },
] as const

export function RecordsTab({ userId }: { userId: string }) {
  const [status, setStatus] = useState<MemoryStatusFilter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const memories = useAdminUserMemories(userId, status)

  const pages = memories.data?.pages ?? []
  const items = pages.flatMap((p) => p.items)
  const nextCursor = pages.length > 0 ? pages[pages.length - 1]!.nextCursor : null
  const failedCount =
    status === 'all' ? items.filter((m) => m.status === 'failed').length : items.length

  return (
    <Panel
      title="Records"
      description={
        status === 'failed'
          ? `${items.length} failed capture${items.length === 1 ? '' : 's'}`
          : `Latest ${items.length} capture${items.length === 1 ? '' : 's'}${failedCount > 0 ? ` · ${failedCount} failed` : ''}`
      }
      flush
      loading={memories.isPending}
      error={memories.isError}
      onRetry={() => void memories.refetch()}
      isEmpty={items.length === 0}
      emptyMessage={
        status === 'failed'
          ? 'No failed captures — this user’s ingestion is healthy.'
          : 'No records yet.'
      }
      action={<TabBar items={FILTERS} active={status} onSelect={(id) => setStatus(id as MemoryStatusFilter)} ariaLabel="Filter by ingestion status" />}
    >
      <div className="overflow-x-auto">
        <table className={tableClasses}>
          <thead>
            <tr>
              <th className={thClasses}>
                <span className="sr-only">Expand</span>
              </th>
              <th className={thClasses}>Snippet</th>
              <th className={thClasses}>Source</th>
              <th className={thClasses}>Status</th>
              <th className={thClasses}>Occurred</th>
              <th className={`${thClasses} text-right`}>Facts</th>
              <th className={thClasses}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <RecordRow
                key={m.id}
                memory={m}
                userId={userId}
                expanded={expanded === m.id}
                onToggle={() => setExpanded(expanded === m.id ? null : m.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-center border-t border-hairline px-xl py-md">
        {memories.isFetching ? (
          <Spinner size={16} />
        ) : nextCursor ? (
          <Button variant="secondary" size="sm" onClick={() => void memories.fetchNextPage()}>
            Load more
          </Button>
        ) : items.length > 0 ? (
          <p className="text-micro uppercase text-ink3">End of results</p>
        ) : null}
      </div>
    </Panel>
  )
}

function RecordRow({
  memory,
  userId,
  expanded,
  onToggle,
}: {
  memory: AdminMemoryRow
  userId: string
  expanded: boolean
  onToggle: () => void
}) {
  const reprocess = useReprocessMemory(userId)
  const [overrideStatus, setOverrideStatus] = useState<string | null>(null)
  const failed = memory.status === 'failed'
  // Optimistic flip: while the POST is pending (or once queued), render the
  // overridden badge instead of the stale server status.
  const effectiveStatus = overrideStatus ?? memory.status
  const isQueued = overrideStatus !== null && !reprocess.isPending

  const startReprocess = () => {
    setOverrideStatus('processing')
    reprocess.mutate(memory.id, {
      onSuccess: () => setOverrideStatus('queued'),
      onError: () => setOverrideStatus(null), // revert to the real server state
    })
  }

  return (
    <Fragment>
      <tr className={failed ? 'bg-accent-soft/60' : undefined}>
        <td className={`${tdClasses} w-8`}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse row' : 'Expand row'}
            onClick={onToggle}
            className="rounded-sm p-1 text-ink3 transition-transform hover:text-ink data-[expanded=true]:rotate-180"
            data-expanded={expanded}
          >
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </td>
        <td className={`${tdClasses} max-w-md`}>
          <span className="line-clamp-1">{memory.rawTextSnippet}</span>
        </td>
        <td className={`${tdClasses} whitespace-nowrap`}>
          <Badge tone="neutral">{memory.source}</Badge>
        </td>
        <td className={tdClasses}>
          <StatusBadge
            status={effectiveStatus}
            queued={isQueued}
            spinning={overrideStatus !== null && reprocess.isPending}
            wasFailed={failed}
          />
        </td>
        <td className={`${tdClasses} whitespace-nowrap text-ink2`}>
          {memory.occurredAt ? formatDate(memory.occurredAt) : '—'}
        </td>
        <td className={`${tdClasses} text-right tabular-nums`}>{memory.factsCount}</td>
        <td className={tdClasses}>
          {effectiveStatus === 'failed' || effectiveStatus === 'processing' ? (
            <Button variant="secondary" size="sm" disabled={overrideStatus !== null} onClick={startReprocess}>
              {overrideStatus !== null ? (
                <Spinner size={12} />
              ) : (
                <RefreshCw size={13} aria-hidden="true" />
              )}
              Reprocess
            </Button>
          ) : null}
        </td>
      </tr>
      {expanded ? (
        <tr className={failed ? 'bg-accent-soft/40' : 'bg-surface-alt/50'}>
          <td colSpan={7} className="px-xl py-md">
            <p className="max-w-prose whitespace-pre-wrap text-caption text-ink">
              {memory.rawTextSnippet}
            </p>
            <p className="mt-sm flex flex-wrap gap-md text-micro uppercase tracking-wide text-ink3">
              <span>id: {memory.id}</span>
              <span>created: {formatDateTime(memory.createdAt)}</span>
              <span>facts extracted: {memory.factsCount}</span>
            </p>
          </td>
        </tr>
      ) : null}
    </Fragment>
  )
}

function StatusBadge({
  status,
  queued,
  spinning,
  wasFailed,
}: {
  status: string
  queued: boolean
  spinning: boolean
  wasFailed: boolean
}) {
  if (spinning) {
    return (
      <Badge tone="pending">
        <Spinner size={10} />
        <span className="ml-1">reprocessing…</span>
      </Badge>
    )
  }
  if (queued) {
    return (
      <Badge tone="accent">queued ✓</Badge>
    )
  }
  switch (status) {
    case 'processed':
      return <Badge tone="success">processed</Badge>
    case 'failed':
      return (
        <Badge tone="danger">
          {wasFailed ? '⚠ needs attention' : 'failed'}
        </Badge>
      )
    default:
      return <Badge tone="neutral">{status}</Badge>
  }
}
