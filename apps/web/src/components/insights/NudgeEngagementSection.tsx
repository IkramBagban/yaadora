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
import { CHART, humanizeToken, pct } from './lib'

/**
 * Nudge engagement — reactions per surfacing kind. Pending nudges (shown, not
 * yet reacted to) and gate-suppressed candidates are excluded from the rate;
 * the rate is "of nudges you reacted to".
 */

const SEGMENTS = [
  { key: 'engaged', label: 'Engaged', color: CHART.success },
  { key: 'dismissed', label: 'Dismissed', color: CHART.danger },
  { key: 'ignored', label: 'Ignored', color: CHART.muted },
] as const

export function NudgeEngagementSection() {
  const { data, isPending, isError, refetch } = useSurfacingsSummary()

  const summaries = data?.summaries ?? []
  const rows = summaries
    .map((s) => ({
      kind: s.kind,
      label: humanizeToken(s.kind),
      engaged: s.reactionCounts.engaged ?? 0,
      dismissed: s.reactionCounts.dismissed ?? 0,
      ignored: s.reactionCounts.ignored ?? 0,
    }))
    .filter((r) => r.engaged + r.dismissed + r.ignored > 0)

  const engaged = rows.reduce((a, r) => a + r.engaged, 0)
  const reacted = rows.reduce((a, r) => a + r.engaged + r.dismissed + r.ignored, 0)
  const rate = pct(engaged, reacted)
  const anyLedgerRows = summaries.some((s) => s.total > 0)

  return (
    <SectionCard
      title="Nudge engagement"
      description={
        anyLedgerRows
          ? 'How you reacted to proactive nudges, by kind. The rate counts only nudges you reacted to.'
          : undefined
      }
      loading={isPending}
      error={isError}
      onRetry={() => void refetch()}
      isEmpty={!anyLedgerRows}
      emptyMessage="No nudges have been shown yet. They appear once Yaadora starts surfacing memories proactively."
      headerExtra={
        rows.length > 0 ? (
          <p className="text-sub text-ink2">
            <span className="text-display font-bold text-ink tabular-nums">{rate}%</span>{' '}
            overall engagement · {engaged} of {reacted} reacted nudges
          </p>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <p className="text-caption text-ink2">
          Nudges exist but none have reactions yet. Bars appear after you engage
          with or dismiss one.
        </p>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 4, left: -28, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke={CHART.hairline} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: CHART.ink2 }}
                tickLine={false}
                axisLine={{ stroke: CHART.hairline }}
                interval={0}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 12, fill: CHART.ink2 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: 'var(--c-accent-soft)', opacity: 0.4 }}
                content={<ChartTooltip />}
              />
              {SEGMENTS.map((seg) => (
                <Bar
                  key={seg.key}
                  dataKey={seg.key}
                  name={seg.label}
                  stackId="reactions"
                  fill={seg.color}
                  radius={seg.key === 'ignored' ? [4, 4, 0, 0] : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  )
}
