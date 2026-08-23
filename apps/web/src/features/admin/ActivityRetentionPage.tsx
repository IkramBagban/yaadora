import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Flame } from 'lucide-react'
import { useGlobalActivity } from './api'
import { AdminOnlyNotice, PageHeader, Panel } from './ui'
import { isForbidden, tableClasses, tdClasses, thClasses } from './lib'
import { ChartTooltip } from '../../components/insights/shared'
import { CHART } from '../../components/insights/lib'

/**
 * Activity & Retention — DAU/WAU curves over the last ~90 days plus the
 * streak leaderboard. Both series come from GET /admin/activity.
 */

export function ActivityRetentionPage() {
  const activity = useGlobalActivity(90)
  const leaders = useMemo(
    () => [...(activity.data?.streakLeaderboard ?? [])].sort((a, b) => b.days - a.days),
    [activity.data],
  )

  if (activity.isError && isForbidden(activity.error)) {
    return <AdminOnlyNotice />
  }

  return (
    <div className="flex flex-col gap-xl">
      <PageHeader
        title="Activity & Retention"
        description="Daily and weekly active users, and who keeps coming back."
      />

      <div className="grid gap-lg lg:grid-cols-2">
        <CountChart
          title="Daily active users"
          description="Unique active users per day."
          points={activity.data?.dau ?? []}
          color={CHART.accent}
          loading={activity.isPending}
          error={activity.isError}
          onRetry={() => void activity.refetch()}
        />
        <CountChart
          title="Weekly active users"
          description="Unique active users per week."
          points={activity.data?.wau ?? []}
          color={CHART.success}
          loading={activity.isPending}
          error={activity.isError}
          onRetry={() => void activity.refetch()}
        />
      </div>

      <Panel
        title="Streak leaderboard"
        description="Longest current capture streaks."
        flush
        loading={activity.isPending}
        error={activity.isError}
        onRetry={() => void activity.refetch()}
        isEmpty={leaders.length === 0}
        emptyMessage="No active streaks right now."
      >
        <div className="overflow-x-auto">
          <table className={tableClasses}>
            <thead>
              <tr>
                <th className={thClasses}>#</th>
                <th className={thClasses}>User</th>
                <th className={`${thClasses} text-right`}>Streak</th>
              </tr>
            </thead>
            <tbody>
              {leaders.map((leader, i) => (
                <tr key={leader.userId}>
                  <td className={`${tdClasses} w-10 tabular-nums text-ink3`}>{i + 1}</td>
                  <td className={tdClasses}>{leader.email}</td>
                  <td className={`${tdClasses} text-right`}>
                    <span className="inline-flex items-center gap-xs font-medium tabular-nums">
                      <Flame size={13} aria-hidden="true" className="text-accent" />
                      {leader.days} day{leader.days === 1 ? '' : 's'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function CountChart({
  title,
  description,
  points,
  color,
  loading,
  error,
  onRetry,
}: {
  title: string
  description: string
  points: Array<{ day: string; count: number }>
  color: string
  loading: boolean
  error: unknown
  onRetry: () => void
}) {
  const rows = useMemo(
    () =>
      points.map((p) => ({
        t: new Date(`${p.day}T00:00:00Z`).getTime(),
        count: p.count,
      })),
    [points],
  )
  const latest = rows.length > 0 ? rows[rows.length - 1]!.count : null

  return (
    <Panel
      title={title}
      description={description}
      loading={loading}
      error={error}
      onRetry={onRetry}
      isEmpty={!loading && rows.length === 0}
      emptyMessage="No activity recorded in this window yet."
      headerExtra={
        !loading && !error && latest !== null ? (
          <p className="text-sub text-ink2">
            <span className="text-display font-bold text-ink tabular-nums">{latest}</span> latest
          </p>
        ) : undefined
      }
    >
      <div className="h-56 w-full p-xl pt-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 12, right: 4, left: -28, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={CHART.hairline} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v: number) =>
                new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              }
              tick={{ fontSize: 12, fill: CHART.ink2 }}
              tickLine={false}
              axisLine={{ stroke: CHART.hairline }}
              minTickGap={48}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 12, fill: CHART.ink2 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              content={
                <ChartTooltip
                  labelFormatter={(l) =>
                    new Date(l).toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })
                  }
                />
              }
            />
            <Line
              type="monotone"
              dataKey="count"
              name="Users"
              stroke={color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}
