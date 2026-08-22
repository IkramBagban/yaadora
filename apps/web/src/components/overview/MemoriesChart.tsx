import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { WidgetCard, WidgetEmpty, WidgetError } from './parts'
import { Button } from '../ui/Button'
import { Skeleton } from '../ui/Skeleton'
import { useChartTimeseries, type ChartRange } from '../../hooks/useOverviewData'
import { useTheme } from '../../theme/useTheme'

/** Known capture sources in display order; unknown ones sort after these. */
const SOURCE_ORDER = ['manual', 'voice', 'conversation', 'import'] as const

const TOKEN_BY_SOURCE: Record<string, string> = {
  manual: '--c-accent',
  voice: '--c-pending',
  conversation: '--c-ink3',
  import: '--c-success',
}

const FALLBACK_TOKEN = '--c-ink2'

/** Axis ticks and gridlines, resolved as raw token names (not source keys). */
const AXIS_TOKENS = ['--c-ink3', '--c-hairline'] as const

/** Reads a raw CSS variable from the document root. */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/**
 * Resolves raw CSS variables and keeps them fresh across theme flips. The
 * theme class is applied in a parent effect, so the post-commit read is
 * deferred one frame; render-time reads would lag one flip behind.
 * `tokens` must have a stable identity (module const or memoized).
 */
function useThemeVars(tokens: readonly string[]): string[] {
  const { resolved } = useTheme()
  const [values, setValues] = useState<string[]>(() => tokens.map(cssVar))
  useEffect(() => {
    if (resolved !== 'light' && resolved !== 'dark') return
    const frame = requestAnimationFrame(() => setValues(tokens.map(cssVar)))
    return () => cancelAnimationFrame(frame)
  }, [resolved, tokens])
  return values
}

const sourceRank = (source: string): number => {
  const i = (SOURCE_ORDER as readonly string[]).indexOf(source)
  return i === -1 ? SOURCE_ORDER.length : i
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

function tickLabel(iso: string, bucket: 'day' | 'week' | 'month'): string {
  const date = new Date(iso)
  const opts: Intl.DateTimeFormatOptions =
    bucket === 'month'
      ? { month: 'short', timeZone: 'UTC' }
      : { month: 'short', day: 'numeric', timeZone: 'UTC' }
  return new Intl.DateTimeFormat(undefined, opts).format(date)
}

/** Theme-matched tooltip: total plus the per-source split. */
function ChartTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null
  const total = payload.reduce((sum, entry) => sum + Number(entry.value ?? 0), 0)
  return (
    <div className="rounded-sm border border-hairline bg-surface px-sm py-xs shadow-sm">
      <p className="text-caption-medium text-ink">{label}</p>
      {payload.map((entry, i) => (
        <p key={entry.name !== undefined ? `${entry.name}` : i} className="flex items-center gap-xs text-caption text-ink2 tabular-nums">
          <span className="size-2 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden="true" />
          {capitalize(`${entry.name ?? ''}`)}: {entry.value}
        </p>
      ))}
      <p className="mt-1 border-t border-hairline pt-1 text-caption-medium text-ink tabular-nums">
        Total: {total}
      </p>
    </div>
  )
}

const RANGES: Array<{ id: ChartRange; label: string }> = [
  { id: 'daily', label: '30 days' },
  { id: 'weekly', label: '12 weeks' },
]

export function MemoriesChart() {
  const [range, setRange] = useState<ChartRange>('daily')
  const { data, isError, isPending, refetch } = useChartTimeseries(range)
  const bucket = range === 'daily' ? 'day' : 'week'

  const { rows, sources } = useMemo(() => {
    const points = data?.points ?? []
    const sourceSet = new Set<string>()
    for (const p of points) for (const s of Object.keys(p.bySource)) sourceSet.add(s)
    const sources = [...sourceSet].sort((a, b) => sourceRank(a) - sourceRank(b) || a.localeCompare(b))
    const rows = points.map((p) => {
      const row: Record<string, string | number> = { date: tickLabel(p.bucketStart, bucket) }
      for (const s of sources) row[s] = p.bySource[s] ?? 0
      return row
    })
    return { rows, sources }
  }, [data, bucket])

  const sourceTokens = useMemo(
    () => sources.map((source) => TOKEN_BY_SOURCE[source] ?? FALLBACK_TOKEN),
    [sources],
  )
  const colors = useThemeVars(sourceTokens)
  const [axisColor, gridColor] = useThemeVars(AXIS_TOKENS)
  const hasData = rows.length > 0 && rows.some((r) => sources.some((s) => (r[s] as number) > 0))

  return (
    <WidgetCard
      title="Memories over time"
      action={
        <div className="flex gap-xs" role="group" aria-label="Time range">
          {RANGES.map(({ id, label }) => (
            <Button
              key={id}
              size="sm"
              variant={range === id ? 'secondary' : 'ghost'}
              aria-pressed={range === id}
              onClick={() => setRange(id)}
            >
              {label}
            </Button>
          ))}
        </div>
      }
    >
      {isError ? (
        <WidgetError onRetry={() => void refetch()} />
      ) : isPending ? (
        <Skeleton className="h-[240px] w-full" />
      ) : !hasData ? (
        <WidgetEmpty>Capture a few memories and the trend will show up here.</WidgetEmpty>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} stroke={gridColor} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={{ stroke: gridColor }}
                tick={{ fontSize: 11, fill: axisColor }}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: axisColor }}
              />
              <Tooltip content={(props) => <ChartTooltip {...props} />} cursor={{ fill: gridColor }} />
              {sources.map((source, i) => (
                <Bar
                  key={source}
                  dataKey={source}
                  name={capitalize(source)}
                  stackId="memories"
                  fill={colors[i]}
                  radius={i === sources.length - 1 ? [3, 3, 0, 0] : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-md flex flex-wrap gap-lg">
            {sources.map((source, i) => (
              <span key={source} className="flex items-center gap-xs text-caption text-ink2">
                <span className="size-2 rounded-full" style={{ backgroundColor: colors[i] }} aria-hidden="true" />
                {capitalize(source)}
              </span>
            ))}
          </div>
        </>
      )}
    </WidgetCard>
  )
}
