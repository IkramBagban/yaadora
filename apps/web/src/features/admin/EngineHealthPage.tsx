import { AlertTriangle, HeartPulse } from 'lucide-react'
import { useEngineHealth } from './api'
import type { ConsolidationRun } from './types'
import {
  AdminOnlyNotice,
  MiniStat,
  PageHeader,
  Panel,
  StatCard,
} from './ui'
import {
  formatCompact,
  formatDurationMs,
  isForbidden,
  tableClasses,
  tdClasses,
  thClasses,
} from './lib'
import { Badge } from '../../components/ui/Badge'
import { formatDateTime } from '../../lib/time'

/**
 * Engine Health — consolidation run history (counters as mini stat chips)
 * and the ingestion failure rate card. Data comes from GET /admin/engine.
 */

export function EngineHealthPage() {
  const engine = useEngineHealth()

  if (engine.isError && isForbidden(engine.error)) {
    return <AdminOnlyNotice />
  }

  const runs = engine.data?.consolidationRuns ?? []
  const failures7d = engine.data?.ingestionFailures7d
  const lastRun = runs[0]
  const healthy = (failures7d ?? 0) === 0

  return (
    <div className="flex flex-col gap-xl">
      <PageHeader
        title="Engine Health"
        description="Consolidation history and ingestion reliability."
      />

      <div className="grid grid-cols-1 gap-lg sm:grid-cols-2">
        <StatCard
          label="Ingestion failures"
          value={engine.isPending ? '…' : (failures7d ?? 0).toLocaleString()}
          hint={healthy ? 'No failures in the last 7 days' : `${failures7d} in the last 7 days`}
          icon={healthy ? HeartPulse : AlertTriangle}
        />
        <StatCard
          label="Last consolidation"
          value={engine.isPending ? '…' : runs.length > 0 ? (lastRun?.status ?? '—') : '—'}
          hint={lastRun ? `Started ${formatDateTime(lastRun.startedAt)}` : 'No runs recorded'}
          icon={HeartPulse}
        />
      </div>

      <Panel
        title="Consolidation runs"
        description="Newest first. Counters summarize what each pass produced."
        flush
        loading={engine.isPending}
        error={engine.isError}
        onRetry={() => void engine.refetch()}
        isEmpty={runs.length === 0}
        emptyMessage="No consolidation runs recorded yet."
      >
        <div className="overflow-x-auto">
          <table className={tableClasses}>
            <thead>
              <tr>
                <th className={thClasses}>Started</th>
                <th className={thClasses}>Finished</th>
                <th className={`${thClasses} text-right`}>Duration</th>
                <th className={thClasses}>Status</th>
                <th className={thClasses}>Counters</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <RunRow key={run.startedAt} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

const OK_STATUSES = new Set(['ok', 'success', 'completed', 'complete'])

function RunRow({ run }: { run: ConsolidationRun }) {
  const duration =
    run.finishedAt !== null
      ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
      : null
  const tone: 'success' | 'danger' | 'pending' | 'neutral' = OK_STATUSES.has(run.status)
    ? 'success'
    : run.status === 'failed' || run.status === 'error'
      ? 'danger'
      : run.status === 'running'
        ? 'pending'
        : 'neutral'

  return (
    <tr className="transition-colors hover:bg-surface-alt">
      <td className={`${tdClasses} whitespace-nowrap text-ink2`}>{formatDateTime(run.startedAt)}</td>
      <td className={`${tdClasses} whitespace-nowrap text-ink2`}>
        {run.finishedAt ? formatDateTime(run.finishedAt) : '—'}
      </td>
      <td className={`${tdClasses} text-right tabular-nums text-ink2`}>
        {duration !== null && Number.isFinite(duration) ? formatDurationMs(duration) : '—'}
      </td>
      <td className={tdClasses}>
        <Badge tone={tone}>{run.status}</Badge>
      </td>
      <td className={tdClasses}>
        <div className="flex max-w-lg flex-wrap gap-xs">
          {Object.entries(run.counters).length === 0 ? (
            <span className="text-ink3">—</span>
          ) : (
            Object.entries(run.counters).map(([key, value]) => (
              <MiniStat key={key} label={key.replaceAll('_', ' ').toLowerCase()} value={formatCompact(value)} />
            ))
          )}
        </div>
      </td>
    </tr>
  )
}
