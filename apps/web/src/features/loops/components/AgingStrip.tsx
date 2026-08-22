import { Card } from '../../../components/ui/Card'
import { ageInDays, formatAge, type AgingStats as Stats } from '../loopUtils'

interface AgingStripProps {
  stats: Stats
}

/**
 * Aging roll-up for the board header (issue #11): how much is open, how old
 * it is on average, the single oldest loop, and how much is overdue.
 */
export function AgingStrip({ stats }: AgingStripProps) {
  return (
    <div className="grid grid-cols-2 gap-sm lg:grid-cols-4">
      <Stat label="Open loops" value={String(stats.openCount)} />
      <Stat
        label="Avg. days open"
        value={stats.openCount > 0 ? String(stats.averageAgeDays) : '—'}
        hint={stats.openCount > 0 ? `${formatAge(stats.averageAgeDays)} avg` : undefined}
      />
      <Stat
        label="Oldest loop"
        value={stats.oldest ? formatAge(ageInDays(stats.oldest)) : '—'}
        title={stats.oldest?.title}
      />
      <Stat label="Overdue" value={String(stats.overdueCount)} tone={stats.overdueCount > 0 ? 'danger' : undefined} />
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  hint,
  title,
}: {
  label: string
  value: string
  tone?: 'danger'
  hint?: string
  title?: string
}) {
  return (
    <Card className="flex flex-col gap-xs px-lg py-md" padded={false} title={title}>
      <span className="text-micro uppercase tracking-wide text-ink3">{label}</span>
      <span className={`text-title font-semibold ${tone === 'danger' ? 'text-danger' : 'text-ink'}`}>
        {value}
      </span>
      {hint && <span className="text-caption text-ink3">{hint}</span>}
    </Card>
  )
}
