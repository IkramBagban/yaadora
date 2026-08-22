import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useSurfacingsSummary } from './useInsightsData'
import { ChartTooltip, SectionCard } from './shared'
import { CHART, humanizeToken } from './lib'

/**
 * "What stayed silent" — suppression_reason breakdown. These candidates were
 * blocked by a gate and never shown; they're the tuning signal for the
 * proactive system (which is why /surfacings/summary includes them).
 */

export function SuppressionSection() {
  const { data, isPending, isError, refetch } = useSurfacingsSummary()

  const byReason = new Map<string, number>()
  for (const r of data?.suppressionReasons ?? []) {
    byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + r.count)
  }
  const rows = [...byReason.entries()]
    .map(([reason, count]) => ({ reason, label: humanizeToken(reason), count }))
    .sort((a, b) => b.count - a.count)

  const kindSplit = new Map<string, Map<string, number>>()
  for (const r of data?.suppressionReasons ?? []) {
    const inner = kindSplit.get(r.reason) ?? new Map<string, number>()
    inner.set(r.kind, (inner.get(r.kind) ?? 0) + r.count)
    kindSplit.set(r.reason, inner)
  }

  return (
    <SectionCard
      title="What stayed silent"
      description="Nudge candidates blocked before reaching you, by gate reason. Blocked nudges are never shown; this is the system holding itself back."
      loading={isPending}
      error={isError}
      onRetry={() => void refetch()}
      isEmpty={rows.length === 0}
      emptyMessage="Nothing has been held back yet. When a gate blocks a nudge, the reason shows up here."
    >
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 4, right: 12, left: 8, bottom: 0 }}
            barCategoryGap="24%"
          >
            <CartesianGrid horizontal={false} stroke={CHART.hairline} />
            <XAxis
              type="number"
              allowDecimals={false}
              tick={{ fontSize: 12, fill: CHART.ink2 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={110}
              tick={{ fontSize: 12, fill: CHART.ink2 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: 'var(--c-accent-soft)', opacity: 0.4 }}
              content={
                <ChartTooltip
                  labelFormatter={(label) => {
                    const reason = rows.find((r) => r.label === label)?.reason
                    const split = reason ? kindSplit.get(reason) : undefined
                    const detail =
                      split && split.size > 0
                        ? [...split.entries()]
                            .map(([k, n]) => `${humanizeToken(k)}: ${n}`)
                            .join(', ')
                        : ''
                    return detail || String(label)
                  }}
                />
              }
            />
            <Bar dataKey="count" name="Blocked" fill={CHART.accent} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  )
}
