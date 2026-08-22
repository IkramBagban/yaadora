import { StatCards } from './StatCards'
import { CaptureHeatmap } from './CaptureHeatmap'
import { MemoriesChart } from './MemoriesChart'
import { DigestCard } from './DigestCard'
import { DueSoonLoops } from './DueSoonLoops'
import { SuggestedReminders } from './SuggestedReminders'
import { RecentActivity } from './RecentActivity'

/**
 * Overview dashboard: stat cards up top, heatmap + trend chart as the main
 * column, digest / loops / reminders rail on the side, activity feed below.
 */
export function OverviewDashboard() {
  return (
    <div className="flex flex-col gap-xl md:gap-xxl">
      <header className="flex flex-col gap-xs">
        <h1 className="text-display font-bold tracking-tight">Overview</h1>
        <p className="text-sub text-ink2">Your memory at a glance.</p>
      </header>

      <StatCards />

      <div className="grid items-start gap-xl lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-xxl">
        <div className="flex min-w-0 flex-col gap-xl lg:gap-xxl">
          <CaptureHeatmap />
          <MemoriesChart />
        </div>
        <div className="flex flex-col gap-xl lg:gap-xxl">
          <DigestCard />
          <DueSoonLoops />
          <SuggestedReminders />
        </div>
      </div>

      <RecentActivity />
    </div>
  )
}
