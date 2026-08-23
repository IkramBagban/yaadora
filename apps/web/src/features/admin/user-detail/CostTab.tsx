import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAdminUserUsage } from '../api'
import type { UsageGranularity } from '../types'
import { Panel, TabBar } from '../ui'
import {
  aggregateByField,
  aggregateByPeriod,
  CHART,
  formatCompact,
  formatUsd,
  periodLabel,
  SERIES_PALETTE,
  tableClasses,
  tdClasses,
  thClasses,
} from '../lib'
import { ChartTooltip } from '../../../components/insights/shared'

/**
 * AI & Cost tab — token usage by day/week/month. Stacked input/output bars
 * per period, a per-model table, a phase-split donut, and one big estimated
 * cost figure that is always explicitly labelled as an estimate.
 */

const GRANULARITIES = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
] as const

export function CostTab({ userId }: { userId: string }) {
  const [granularity, setGranularity] = useState<UsageGranularity>('day')
  const usage = useAdminUserUsage(userId, granularity, 6)

  // Stable rows reference so the aggregations below don't recompute per render.
  const rows = useMemo(() => usage.data?.rows ?? [], [usage.data])
  const totals = usage.data?.totals
  const periods = useMemo(() => aggregateByPeriod(rows), [rows])
  const byModel = useMemo(() => aggregateByField(rows, 'model'), [rows])
  const byPhase = useMemo(() => aggregateByField(rows, 'phase'), [rows])
  const chartPeriods = useMemo(
    () => periods.map((p) => ({ ...p, label: periodLabel(p.key, granularity) })),
    [periods, granularity],
  )

  return (
    <div className="flex flex-col gap-lg">
      <Panel
        title="AI usage"
        description="Token consumption across the last ~6 months."
        loading={usage.isPending}
        error={usage.isError}
        onRetry={() => void usage.refetch()}
        isEmpty={rows.length === 0 && !usage.isPending}
        emptyMessage="No AI usage recorded for this window yet."
        action={
          <TabBar
            items={GRANULARITIES}
            active={granularity}
            onSelect={(id) => setGranularity(id as UsageGranularity)}
            ariaLabel="Usage granularity"
          />
        }
      >
        <div className="flex flex-col gap-xl">
          <CostFigure totals={totals} />

          <section className="flex flex-col gap-sm">
            <h3 className="text-micro uppercase tracking-wide text-ink3">
              Tokens per period (input / output stacked)
            </h3>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartPeriods} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART.hairline} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 12, fill: CHART.ink2 }}
                    tickLine={false}
                    axisLine={{ stroke: CHART.hairline }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickFormatter={formatCompact}
                    tick={{ fontSize: 12, fill: CHART.ink2 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="inputTokens" name="Input" stackId="tokens" fill={CHART.accent} isAnimationActive={false} />
                  <Bar
                    dataKey="outputTokens"
                    name="Output"
                    stackId="tokens"
                    fill={CHART.success}
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="grid gap-xl lg:grid-cols-[minmax(0,1fr)_280px]">
            <ModelTable models={byModel} />

            <section className="flex flex-col gap-sm">
              <h3 className="text-micro uppercase tracking-wide text-ink3">Calls by phase</h3>
              {byPhase.length === 0 ? (
                <p className="text-caption text-ink3">No phase data.</p>
              ) : (
                <PhaseDonut phases={byPhase} />
              )}
            </section>
          </div>
        </div>
      </Panel>
    </div>
  )
}

function CostFigure({
  totals,
}: {
  totals: { costEstimateUsd: number; calls: number; inputTokens: number; outputTokens: number } | undefined
}) {
  const usd = totals?.costEstimateUsd ?? 0
  return (
    <div className="flex flex-wrap items-end justify-between gap-md rounded-md bg-surface-alt px-xl py-lg">
      <div>
        <p className="text-micro uppercase tracking-wide text-ink3">Estimated cost</p>
        <p className="text-display font-bold tabular-nums leading-tight">
          ≈ {formatUsd(usd)}
          <span
            title="Derived from model list prices — not a bill."
            className="ml-sm align-middle text-caption font-medium uppercase text-pending"
          >
            estimate
          </span>
        </p>
      </div>
      <p className="text-caption text-ink2">
        {formatCompact(totals?.calls ?? 0)} API calls ·{' '}
        {formatCompact(totals?.inputTokens ?? 0)} in / {formatCompact(totals?.outputTokens ?? 0)} out tokens
      </p>
    </div>
  )
}

interface ModelRow {
  key: string
  calls: number
  inputTokens: number
  outputTokens: number
}

function ModelTable({ models }: { models: ModelRow[] }) {
  return (
    <section className="flex flex-col gap-sm">
      <h3 className="text-micro uppercase tracking-wide text-ink3">Per-model</h3>
      <div className="overflow-x-auto rounded-md border border-hairline">
        <table className={tableClasses}>
          <thead>
            <tr>
              <th className={thClasses}>Model</th>
              <th className={`${thClasses} text-right`}>Calls</th>
              <th className={`${thClasses} text-right`}>In</th>
              <th className={`${thClasses} text-right`}>Out</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.key}>
                <td className={`${tdClasses} font-mono text-caption`}>{m.key}</td>
                <td className={`${tdClasses} text-right tabular-nums`}>{formatCompact(m.calls)}</td>
                <td className={`${tdClasses} text-right tabular-nums`}>{formatCompact(m.inputTokens)}</td>
                <td className={`${tdClasses} text-right tabular-nums`}>{formatCompact(m.outputTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function PhaseDonut({ phases }: { phases: ModelRow[] }) {
  const total = phases.reduce((sum, p) => sum + p.calls, 0)
  return (
    <div className="flex items-center gap-lg">
      <div className="h-36 w-36 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={phases}
              dataKey="calls"
              nameKey="key"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="var(--c-surface)"
              isAnimationActive={false}
            >
              {phases.map((p, i) => (
                <Cell key={p.key} fill={SERIES_PALETTE[i % SERIES_PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex min-w-0 flex-col gap-xs">
        {phases.map((p, i) => (
          <li key={p.key} className="flex items-center gap-sm text-caption text-ink2">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-pill"
              style={{ backgroundColor: SERIES_PALETTE[i % SERIES_PALETTE.length] }}
            />
            <span className="truncate">{p.key}</span>
            <span className="ml-auto pl-sm font-medium text-ink tabular-nums">
              {total > 0 ? Math.round((p.calls / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
