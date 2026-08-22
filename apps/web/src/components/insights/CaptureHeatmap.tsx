import { useMemo } from 'react'
import { buildHourGrid, HEAT_DAYS, HEAT_HOUR_LABELS, heatCellColor } from './lib'
import type { Memory } from '../../api/types'

/**
 * Capture heatmap — weekday × hour-of-day, computed from REAL memory
 * timestamps (the timeseries endpoint only buckets by day, so hour-level
 * shape has to come from the raw list). Honest edges, kept visible in the UI:
 * - event time falls back to save time when `occurredAt` is unknown
 * - bucketed in the browser's local timezone
 * - covers only the sampled recent captures, not all history
 */

export function CaptureHeatmap({
  memories,
  sampleTruncated,
}: {
  memories: Memory[]
  sampleTruncated: boolean
}) {
  const { grid, bucketed } = useMemo(() => buildHourGrid(memories), [memories])
  const max = useMemo(() => Math.max(1, ...grid.flatMap((row) => row)), [grid])

  return (
    <div className="flex flex-col gap-sm">
      <div className="overflow-x-auto">
        <div className="min-w-[430px]">
          <div className="grid grid-cols-[2.25rem_repeat(24,1fr)] gap-[3px]">
            {grid.map((row, dayIdx) => (
              <div key={HEAT_DAYS[dayIdx]} className="col-span-25 grid grid-cols-subgrid">
                <span className="text-micro uppercase text-ink3">{HEAT_DAYS[dayIdx]}</span>
                {row.map((count, hour) => {
                  const level = count === 0 ? 0 : Math.max(1, Math.ceil((count / max) * 4))
                  return (
                    <div
                      key={hour}
                      role="img"
                      aria-label={`${HEAT_DAYS[dayIdx]} ${hour}:00, ${count} captures`}
                      title={`${HEAT_DAYS[dayIdx]} ${String(hour).padStart(2, '0')}:00, ${count}`}
                      className="aspect-square w-full rounded-[4px]"
                      style={{ backgroundColor: heatCellColor(level) }}
                    />
                  )
                })}
              </div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-[2.25rem_repeat(24,1fr)] gap-[3px]">
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="text-center text-micro text-ink3 tabular-nums">
                {HEAT_HOUR_LABELS.includes(h as (typeof HEAT_HOUR_LABELS)[number]) ? h : ''}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-sm">
        <div className="flex items-center gap-xs text-micro uppercase text-ink3">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <span
              key={l}
              aria-hidden="true"
              className="size-2.5 rounded-[3px]"
              style={{ backgroundColor: heatCellColor(l) }}
            />
          ))}
          <span>More</span>
        </div>
        <p className="text-micro uppercase text-ink3">
          Local time · {bucketed} captures{sampleTruncated ? ' (recent sample)' : ''}
        </p>
      </div>
      <p className="text-caption text-ink3">
        Approximate: buckets each capture's event time, falling back to save
        time when the event time is unknown. Hours aren't available as an
        aggregate, so this is computed from your recent captures
        {sampleTruncated ? ' (latest sample, not full history)' : ''}.
      </p>
    </div>
  )
}
