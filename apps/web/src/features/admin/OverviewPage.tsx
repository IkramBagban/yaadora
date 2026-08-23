import { Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  CalendarClock,
  Flame,
  HeartPulse,
  TrendingUp,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEngineHealth, useGlobalActivity } from './api'
import { AdminOnlyNotice, PageHeader, Panel, StatCard } from './ui'
import { formatCompact, isForbidden } from './lib'

/**
 * Admin overview: global stat cards from /admin/activity + /admin/engine and
 * quick links into the admin sections. There is no global-counts endpoint in
 * the contract, so these cards stick to what those two payloads honestly
 * provide — engagement now, streak leaders, failures, run history.
 */

export function AdminOverviewPage() {
  const activity = useGlobalActivity(90)
  const engine = useEngineHealth()

  if (
    (activity.isError && isForbidden(activity.error)) ||
    (engine.isError && isForbidden(engine.error))
  ) {
    return <AdminOnlyNotice />
  }

  const dau = activity.data?.dau ?? []
  const wau = activity.data?.wau ?? []
  const today = dau.length > 0 ? dau[dau.length - 1]!.count : null
  const week = wau.length > 0 ? wau[wau.length - 1]!.count : null
  const leaders = activity.data?.streakLeaderboard ?? []
  const runs = engine.data?.consolidationRuns ?? []
  const lastRun = runs[0]
  const failures7d = engine.data?.ingestionFailures7d

  return (
    <div className="flex flex-col gap-xl">
      <PageHeader
        title="Overview"
        description="Platform-wide engagement and engine state at a glance."
      />

      <div className="grid grid-cols-2 gap-lg xl:grid-cols-4">
        <StatCard
          label="DAU (today)"
          value={activity.isPending ? '…' : (today ?? 0).toLocaleString()}
          hint="Active users today"
          icon={Users}
        />
        <StatCard
          label="WAU"
          value={activity.isPending ? '…' : (week ?? 0).toLocaleString()}
          hint="Latest weekly window"
          icon={CalendarClock}
        />
        <StatCard
          label="Streak leader"
          value={
            activity.isPending ? '…' : leaders.length > 0 ? `${leaders[0]!.days}d` : '—'
          }
          hint={leaders.length > 0 ? leaders[0]!.email : 'No active streaks yet'}
          icon={Flame}
        />
        <StatCard
          label="Ingestion failures"
          value={engine.isPending ? '…' : (failures7d ?? 0).toLocaleString()}
          hint="Last 7 days"
          icon={AlertTriangle}
        />
      </div>

      <div className="grid gap-lg lg:grid-cols-2">
        <Panel title="Quick links" description="Jump straight into the admin sections.">
          <div className="grid gap-sm sm:grid-cols-3">
            <QuickLink to="/admin/users" label="Users" hint="Search & inspect" icon={Users} />
            <QuickLink
              to="/admin/activity"
              label="Activity & Retention"
              hint="DAU/WAU · streaks"
              icon={TrendingUp}
            />
            <QuickLink
              to="/admin/engine"
              label="Engine Health"
              hint={`${runs.length > 0 ? `${runs.length} runs` : 'Consolidation'} · failures`}
              icon={HeartPulse}
            />
          </div>
        </Panel>

        <Panel
          title="Engine snapshot"
          description="Most recent consolidation run."
          loading={engine.isPending}
          error={engine.isError}
          onRetry={() => void engine.refetch()}
          isEmpty={runs.length === 0}
          emptyMessage="No consolidation runs recorded yet."
        >
          {lastRun ? (
            <dl className="flex flex-col gap-sm text-sub">
              <div className="flex justify-between gap-md">
                <dt className="text-ink2">Started</dt>
                <dd>{new Date(lastRun.startedAt).toLocaleString()}</dd>
              </div>
              <div className="flex justify-between gap-md">
                <dt className="text-ink2">Status</dt>
                <dd className="capitalize">{lastRun.status}</dd>
              </div>
              <div className="flex justify-between gap-md">
                <dt className="text-ink2">Counters</dt>
                <dd className="text-right tabular-nums">
                  {Object.entries(lastRun.counters)
                    .map(([key, value]) => `${key}: ${formatCompact(value)}`)
                    .join(' · ') || '—'}
                </dd>
              </div>
            </dl>
          ) : null}
        </Panel>
      </div>
    </div>
  )
}

function QuickLink({
  to,
  label,
  hint,
  icon: Icon,
}: {
  to: '/admin/users' | '/admin/activity' | '/admin/engine'
  label: string
  hint: string
  icon: LucideIcon
}) {
  return (
    <Link
      to={to}
      className="flex flex-col gap-xs rounded-md border border-hairline bg-surface p-md transition-colors hover:border-accent-soft hover:bg-accent-soft"
    >
      <span className="flex size-8 items-center justify-center rounded-sm bg-accent-soft text-accent">
        <Icon size={16} aria-hidden="true" />
      </span>
      <span className="text-caption-medium font-semibold text-ink">{label}</span>
      <span className="text-micro text-ink3">{hint}</span>
    </Link>
  )
}
