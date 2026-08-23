import { useMemo, useState } from 'react'
import { useAdminUserActivity } from '../api'
import type { AdminActivityDay } from '../types'
import { Panel, TabBar } from '../ui'
import { formatDurationMs, httpStatusTone, tableClasses, tdClasses, thClasses } from '../lib'
import { Badge } from '../../../components/ui/Badge'

/**
 * Tracks tab — engagement heatmap (one cell per day over the activity
 * window) plus a recent API request feed with status colour coding.
 */

type HeatMetric = 'requests' | 'memoriesCreated' | 'turns'

const METRICS = [
  { id: 'requests', label: 'Requests' },
  { id: 'memoriesCreated', label: 'Memories' },
  { id: 'turns', label: 'Turns' },
] as const

function heatCellColor(level: number): string {
  if (level === 0) return 'var(--c-surface-alt)'
  const mix = [0, 20, 42, 66, 90][level] ?? 90
  return `color-mix(in srgb, var(--c-accent) ${mix}%, var(--c-surface-alt))`
}

export function TracksTab({ userId }: { userId: string }) {
  const activity = useAdminUserActivity(userId)
  const [metric, setMetric] = useState<HeatMetric>('requests')

  if (activity.isError) {
    return (
      <Panel title="Tracks" error={activity.error} onRetry={() => void activity.refetch()}>
        <span />
      </Panel>
    )
  }

  return (
    <div className="flex flex-col gap-lg">
      <Panel
        title="Engagement heatmap"
        description="Daily buckets across the last ~90 days."
        loading={activity.isPending}
        isEmpty={(activity.data?.days.length ?? 0) === 0}
        emptyMessage="No tracked activity in this window yet."
        action={
          <TabBar
            items={METRICS}
            active={metric}
            onSelect={(id) => setMetric(id as HeatMetric)}
            ariaLabel="Heatmap metric"
          />
        }
      >
        {activity.data ? <DayHeatmap days={activity.data.days} metric={metric} /> : null}
      </Panel>

      <RequestFeedTable
        rows={activity.data?.apiRequests ?? []}
        loading={activity.isPending}
        isEmpty={!activity.isPending && (activity.data?.apiRequests.length ?? 0) === 0}
      />
    </div>
  )
}

function DayHeatmap({ days, metric }: { days: AdminActivityDay[]; metric: HeatMetric }) {
  const max = useMemo(() => Math.max(1, ...days.map((d) => d[metric])), [days, metric])

  // Contribution-style columns of 7 (Mon…Sun). Days arrive as consecutive
  // daily buckets; leading/trailing slots are padded with null.
  const weeks = useMemo<(AdminActivityDay | null)[][]>(() => {
    const cols: (AdminActivityDay | null)[][] = []
    let current: (AdminActivityDay | null)[] = []
    days.forEach((d, i) => {
      if (i === 0) {
        const firstWeekday = (new Date(`${d.day}T00:00:00Z`).getUTCDay() + 6) % 7
        for (let p = 0; p < firstWeekday; p++) current.push(null)
      }
      current.push(d)
      const weekday = (new Date(`${d.day}T00:00:00Z`).getUTCDay() + 6) % 7
      if (weekday === 6) {
        cols.push(current)
        current = []
      }
    })
    if (current.length > 0) {
      while (current.length < 7) current.push(null)
      cols.push(current)
    }
    return cols
  }, [days])

  return (
    <div className="overflow-x-auto p-xl">
      <div className="flex gap-[3px]">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.map((day, di) =>
              day ? (
                (() => {
                  const value = day[metric]
                  const level = value === 0 ? 0 : Math.max(1, Math.ceil((value / max) * 4))
                  return (
                    <span
                      key={day.day}
                      role="img"
                      aria-label={`${day.day}: ${value} ${metric}`}
                      title={`${day.day} · ${value} ${metric}`}
                      className="size-4 rounded-[4px]"
                      style={{ backgroundColor: heatCellColor(level) }}
                    />
                  )
                })()
              ) : (
                <span key={`${wi}-${di}`} className="size-4 rounded-[4px] opacity-0" aria-hidden="true" />
              ),
            )}
          </div>
        ))}
      </div>
      <div className="mt-md flex items-center gap-xs text-micro uppercase text-ink3">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className="size-2.5 rounded-[3px]" style={{ backgroundColor: heatCellColor(l) }} />
        ))}
        <span>More</span>
        <span className="ml-auto">UTC days · {metric}</span>
      </div>
    </div>
  )
}

const FEED_ROWS = 50

function RequestFeedTable({
  rows,
  loading,
  isEmpty,
}: {
  rows: Array<{ ts: string; method: string; path: string; status: number; durationMs: number }>
  loading: boolean
  isEmpty: boolean
}) {
  return (
    <Panel title="Recent API requests" flush loading={loading} isEmpty={isEmpty} emptyMessage="No API requests recorded.">
      <div className="overflow-x-auto">
        <table className={tableClasses}>
          <thead>
            <tr>
              <th className={thClasses}>Time</th>
              <th className={thClasses}>Method</th>
              <th className={thClasses}>Path</th>
              <th className={`${thClasses} text-right`}>Status</th>
              <th className={`${thClasses} text-right`}>Duration</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, FEED_ROWS).map((r, i) => {
              const tone = httpStatusTone(r.status)
              return (
                <tr key={`${r.ts}-${i}`}>
                  <td className={`${tdClasses} whitespace-nowrap text-ink2`}>
                    {new Date(r.ts).toLocaleTimeString()}
                  </td>
                  <td className={tdClasses}>
                    <Badge tone="neutral">{r.method}</Badge>
                  </td>
                  <td className={`${tdClasses} max-w-sm truncate font-mono text-caption`}>{r.path}</td>
                  <td className={`${tdClasses} text-right`}>
                    <Badge tone={tone === 'success' ? 'success' : tone === 'pending' ? 'pending' : tone === 'danger' ? 'danger' : 'neutral'}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className={`${tdClasses} text-right tabular-nums text-ink2`}>
                    {formatDurationMs(r.durationMs)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
