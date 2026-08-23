import { Smartphone } from 'lucide-react'
import type { AdminDeviceRow, AdminUserOverview } from '../types'
import { Panel } from '../ui'
import { tableClasses, tdClasses, thClasses } from '../lib'
import { formatRelative } from '../../../lib/format'

/**
 * Overview tab — the user's memory-system counts and registered devices.
 * Data comes from the parent profile query, so this tab renders instantly
 * with no loading state of its own.
 */

const COUNT_LABELS: Array<{ key: keyof AdminUserOverview; label: string }> = [
  { key: 'memoriesTotal', label: 'Memories' },
  { key: 'factsTotal', label: 'Facts' },
  { key: 'entitiesTotal', label: 'Entities' },
  { key: 'openLoopsOpen', label: 'Open loops' },
  { key: 'conversationsTotal', label: 'Conversations' },
  { key: 'turnsTotal', label: 'Turns' },
  { key: 'streakDays', label: 'Streak days' },
  { key: 'activeDays30', label: 'Active days 30d' },
]

export function OverviewTab({
  overview,
  devices,
}: {
  userId: string
  overview: AdminUserOverview
  devices: AdminDeviceRow[]
}) {
  return (
    <div className="grid gap-lg lg:grid-cols-[minmax(0,1fr)_320px]">
      <Panel title="Memory system" description="Lifetime counts across the engine.">
        <div className="flex flex-wrap gap-sm">
          {COUNT_LABELS.map(({ key, label }) => (
            <span key={key} className="flex flex-col items-start gap-2 rounded-md border border-hairline px-lg py-md">
              <span className="text-micro uppercase text-ink3">{label}</span>
              <span className="text-display font-bold tabular-nums leading-none">
                {(overview[key] ?? 0).toLocaleString()}
              </span>
            </span>
          ))}
        </div>
      </Panel>

      <Panel
        title="Devices"
        description="Registered push tokens."
        isEmpty={devices.length === 0}
        emptyMessage="No devices registered."
      >
        <div className="overflow-x-auto">
          <table className={tableClasses}>
            <thead>
              <tr>
                <th className={thClasses}>Device</th>
                <th className={thClasses}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.deviceId}>
                  <td className={tdClasses}>
                    <span className="flex items-center gap-sm">
                      <Smartphone size={14} aria-hidden="true" className="shrink-0 text-ink3" />
                      <code className="max-w-40 truncate text-caption">{d.deviceId}</code>
                    </span>
                  </td>
                  <td className={`${tdClasses} whitespace-nowrap text-ink2`}>
                    {formatRelative(d.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
