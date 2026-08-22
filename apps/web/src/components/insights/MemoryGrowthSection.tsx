import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useStatsTimeseries } from './useInsightsData'
import { ChartTooltip, SectionCard } from './shared'
import { CHART } from './lib'

/**
 * Memory growth — cumulative area over the timeseries window. The y value is
 * NET NEW memories since the window started (not the lifetime total); the
 * description says so. "Last 30 days" is anchored to the newest bucket, not
 * the wall clock, so the figure stays stable across re-renders.
 */

const DAY = 24 * 60 * 60 * 1000

interface GrowthRow {
  t: number
  total: number
}

const fmtDay = (v: string | number) =>
  new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export function MemoryGrowthSection() {
  const { data, isPending, isError, refetch } = useStatsTimeseries(90)

  const rows = useMemo<GrowthRow[]>(
    () =>
      (data?.points ?? []).reduce<GrowthRow[]>((acc, p) => {
        const prev = acc.length > 0 ? acc[acc.length - 1]!.total : 0
        return acc.concat([{ t: new Date(p.bucketStart).getTime(), total: prev + p.total }])
      }, []),
    [data],
  )

  const windowTotal = rows.length > 0 ? rows[rows.length - 1]!.total : 0
  const last30 = useMemo(() => {
    const anchor = rows.length > 0 ? rows[rows.length - 1]!.t : 0
    const cutoff = anchor - 30 * DAY
    const start = rows.find((r) => r.t >= cutoff)?.total
    return start === undefined ? windowTotal : windowTotal - start
  }, [rows, windowTotal])

  return (
    <SectionCard
      title="Memory growth"
      description={`Net new memories captured over the last ${data?.days ?? 90} days (cumulative).`}
      loading={isPending}
      error={isError}
      onRetry={() => void refetch()}
      isEmpty={windowTotal === 0}
      emptyMessage="No captures in this window yet. Save a memory and growth starts tracking here."
      headerExtra={
        <p className="text-sub text-ink2">
          <span className="text-display font-bold text-ink tabular-nums">+{windowTotal}</span> in
          the window · +{last30} in the last 30 days
        </p>
      }
    >
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
            <defs>
              <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART.accent} stopOpacity={0.28} />
                <stop offset="100%" stopColor={CHART.accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={CHART.hairline} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={fmtDay}
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
            <Tooltip content={<ChartTooltip labelFormatter={fmtDay} />} />
            <Area
              type="monotone"
              dataKey="total"
              name="Captures"
              stroke={CHART.accent}
              strokeWidth={2}
              fill="url(#growthFill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  )
}
