import { CircleHelp, Minus, NotebookPen, Share2, ShieldCheck, TrendingDown, TrendingUp, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '../ui/Card'
import { Skeleton } from '../ui/Skeleton'
import { WidgetError } from './parts'
import { dueSoonLoops, useDailyTimeseries, useOpenLoops, useStatsOverview, weekTrend } from '../../hooks/useOverviewData'

interface StatDef {
  label: string
  value: number
  hint?: { text: string; trend?: 'up' | 'down' | 'flat' }
  icon: LucideIcon
}

function trendIcon(trend: 'up' | 'down' | 'flat') {
  if (trend === 'up') return <TrendingUp size={13} aria-hidden="true" />
  if (trend === 'down') return <TrendingDown size={13} aria-hidden="true" />
  return <Minus size={13} aria-hidden="true" />
}

function StatCard({ stat }: { stat: StatDef }) {
  const Icon = stat.icon
  return (
    <Card className="flex flex-col gap-md">
      <div className="flex items-center gap-sm text-ink2">
        <span className="flex size-7 items-center justify-center rounded-sm bg-accent-soft text-accent">
          <Icon size={15} aria-hidden="true" />
        </span>
        <span className="text-caption-medium uppercase tracking-wide text-ink2">{stat.label}</span>
      </div>
      <div>
        <p className="text-display font-bold tracking-tight tabular-nums">{stat.value.toLocaleString()}</p>
        {stat.hint ? (
          <p className="mt-2 flex items-center gap-xs text-caption text-ink3">
            {stat.hint.trend && trendIcon(stat.hint.trend)}
            {stat.hint.text}
          </p>
        ) : (
          <p className="mt-2 text-caption text-transparent select-none">&nbsp;</p>
        )}
      </div>
    </Card>
  )
}

function StatCardSkeleton() {
  return (
    <Card className="flex flex-col gap-md">
      <div className="flex items-center gap-sm">
        <Skeleton className="size-7 rounded-sm" />
        <Skeleton className="h-3.5 w-20" />
      </div>
      <Skeleton className="h-8 w-14" />
      <Skeleton className="h-3.5 w-24" />
    </Card>
  )
}

/** Top row: memories, current facts, entities, open loops, active rules. */
export function StatCards() {
  const stats = useStatsOverview()
  const daily = useDailyTimeseries()
  const loops = useOpenLoops()

  if (stats.isError) {
    return (
      <Card className="col-span-full">
        <WidgetError onRetry={() => void stats.refetch()} />
      </Card>
    )
  }
  if (!stats.data) {
    return (
      <div className="grid grid-cols-2 gap-lg md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  const s = stats.data
  const trend = daily.data ? weekTrend(daily.data.points) : null
  const dueSoon = loops.data ? dueSoonLoops(loops.data.items, 14).length : null
  const topTypes = Object.entries(s.entities.byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([type]) => type)

  const cards: StatDef[] = [
    {
      label: 'Memories',
      value: s.memories.total,
      icon: NotebookPen,
      hint: trend
        ? {
            text: `${trend.thisWeek} this week`,
            trend:
              trend.thisWeek > trend.lastWeek ? 'up' : trend.thisWeek < trend.lastWeek ? 'down' : 'flat',
          }
        : undefined,
    },
    {
      label: 'Current facts',
      value: s.facts.currentCount,
      icon: Share2,
      hint: s.facts.supersededCount > 0 ? { text: `${s.facts.supersededCount} superseded` } : undefined,
    },
    {
      label: 'Entities',
      value: s.entities.total,
      icon: Users,
      hint: topTypes.length > 0 ? { text: topTypes.join(', ') } : undefined,
    },
    {
      label: 'Open loops',
      value: s.openLoops.byStatus.open ?? 0,
      icon: CircleHelp,
      hint: dueSoon !== null && dueSoon > 0 ? { text: `${dueSoon} due soon` } : undefined,
    },
    { label: 'Active rules', value: s.rules.active, icon: ShieldCheck },
  ]

  return (
    <div className="grid grid-cols-2 gap-lg md:grid-cols-3 xl:grid-cols-5">
      {cards.map((stat) => (
        <StatCard key={stat.label} stat={stat} />
      ))}
    </div>
  )
}
