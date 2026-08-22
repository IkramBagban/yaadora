import { createFileRoute } from '@tanstack/react-router'
import { CaptureHabitsSection } from '../components/insights/CaptureHabitsSection'
import { FadingRelationshipsSection } from '../components/insights/FadingRelationshipsSection'
import { MemoryGrowthSection } from '../components/insights/MemoryGrowthSection'
import { NudgeEngagementSection } from '../components/insights/NudgeEngagementSection'
import { PatternInsightsSection } from '../components/insights/PatternInsightsSection'
import { SuppressionSection } from '../components/insights/SuppressionSection'
import { TokenUsageSection } from '../components/insights/TokenUsageSection'

/**
 * Insights & Analytics — how the memory system is actually living: nudge
 * engagement, what the gates held back, capture habits, growth, relationships
 * going quiet, and consolidation-mined patterns. Stacked cards, collapsing to
 * a single column on narrow screens; chart pairs share a row when wide.
 */
export const Route = createFileRoute('/insights')({
  component: function InsightsPage() {
    return (
      <div className="flex flex-col gap-lg pb-xl">
        <header className="flex flex-col gap-xs">
          <h1 className="text-display font-bold tracking-tight">Insights</h1>
          <p className="text-sub text-ink2">
            How your memory system is doing: engagement, habits, growth, and the
            patterns hiding in your captures.
          </p>
        </header>

        <NudgeEngagementSection />

        <div className="grid gap-lg lg:grid-cols-2">
          <SuppressionSection />
          <MemoryGrowthSection />
        </div>

        <CaptureHabitsSection />

        <div className="grid gap-lg lg:grid-cols-2">
          <FadingRelationshipsSection />
          <TokenUsageSection />
        </div>

        <PatternInsightsSection />
      </div>
    )
  },
})
