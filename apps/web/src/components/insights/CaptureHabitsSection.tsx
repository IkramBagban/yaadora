import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { Flame } from 'lucide-react'
import { useMemoriesSample, useStatsTimeseries } from './useInsightsData'
import { CaptureHeatmap } from './CaptureHeatmap'
import { ChartTooltip, SectionCard } from './shared'
import { CHART, humanizeToken } from './lib'

/**
 * Capture habits — when and how you capture. Heatmap from real memory
 * timestamps, source mix + streak from the day-bucket timeseries.
 */

const SOURCE_PALETTE = [CHART.accent, CHART.success, CHART.pending, CHART.danger, CHART.muted]

/** Consecutive UTC days with ≥1 capture, ending today (or yesterday). */
function computeStreak(points: { bucketStart: string; total: number }[]): number {
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
  const day = 86_400_000
  const active = new Set(
    points.filter((p) => p.total > 0).map((p) => p.bucketStart.slice(0, 10)),
  )
  const todayUtc = new Date(`${iso(Date.now())}T00:00:00Z`).getTime()
  let cursor = active.has(iso(todayUtc)) ? todayUtc : todayUtc - day
  let streak = 0
  while (active.has(iso(cursor))) {
    streak += 1
    cursor -= day
  }
  return streak
}

function StreakStat({ streak }: { streak: number }) {
  return (
    <div className="flex items-center gap-md">
      <span className="flex size-11 items-center justify-center rounded-pill bg-accent-soft text-accent">
        <Flame size={20} />
      </span>
      <div>
        <p className="text-display font-bold tabular-nums">
          {streak} <span className="text-sub font-medium text-ink2">day{streak === 1 ? '' : 's'}</span>
        </p>
        <p className="text-caption text-ink2">
          {streak > 0 ? 'Current capture streak' : 'No active streak; save a memory today'}
        </p>
      </div>
    </div>
  )
}

function SourceDonut({ bySource, total }: { bySource: Record<string, number>; total: number }) {
  const slices = Object.entries(bySource)
    .filter(([, n]) => n > 0)
    .map(([source, n]) => ({ source, label: humanizeToken(source), n }))

  if (slices.length === 0) {
    return <p className="text-caption text-ink2">No captures in this window yet.</p>
  }

  return (
    <div className="flex items-center gap-lg">
      <div className="h-36 w-36 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="n"
              nameKey="label"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="var(--c-surface)"
              isAnimationActive={false}
            >
              {slices.map((s, i) => (
                <Cell key={s.source} fill={SOURCE_PALETTE[i % SOURCE_PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex min-w-0 flex-col gap-xs">
        {slices.map((s, i) => (
          <li key={s.source} className="flex items-center gap-sm text-caption text-ink2">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-pill"
              style={{ backgroundColor: SOURCE_PALETTE[i % SOURCE_PALETTE.length] }}
            />
            <span className="truncate">{s.label}</span>
            <span className="ml-auto pl-sm font-medium text-ink tabular-nums">
              {Math.round((s.n / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function CaptureHabitsSection() {
  const timeseries = useStatsTimeseries(90)
  const sample = useMemoriesSample()

  const loading = timeseries.isPending || sample.isPending
  const error = timeseries.isError || sample.isError
  const refetch = () => {
    void timeseries.refetch()
    void sample.refetch()
  }

  const { bySource, sourceTotal, streak } = useMemo(() => {
    const points = timeseries.data?.points ?? []
    const bySource: Record<string, number> = {}
    let sourceTotal = 0
    for (const p of points) {
      for (const [src, n] of Object.entries(p.bySource)) {
        bySource[src] = (bySource[src] ?? 0) + n
        sourceTotal += n
      }
    }
    return { bySource, sourceTotal, streak: computeStreak(points) }
  }, [timeseries.data])

  const memories = sample.data?.items ?? []

  return (
    <SectionCard
      title="Capture habits"
      description="When and how you save memories: hour shape from your recent captures, source mix and streak from the last 90 days."
      loading={loading}
      error={error}
      onRetry={refetch}
      isEmpty={memories.length === 0}
      emptyMessage="No captures yet. Once you start saving memories, your rhythm shows up here."
    >
      <div className="grid gap-xl lg:grid-cols-[minmax(0,1fr)_240px]">
        <CaptureHeatmap
          memories={memories}
          sampleTruncated={sample.data?.truncated ?? false}
        />
        <div className="flex flex-col gap-xl lg:border-l lg:border-hairline lg:pl-xl">
          <StreakStat streak={streak} />
          <p className="-mt-md text-micro uppercase text-ink3">Streak counts UTC days</p>
          <SourceDonut bySource={bySource} total={sourceTotal} />
        </div>
      </div>
    </SectionCard>
  )
}
