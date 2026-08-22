import { useMemo, useRef, useState } from 'react'
import { WidgetCard, WidgetEmpty, WidgetError } from './parts'
import { Skeleton } from '../ui/Skeleton'
import { useDailyTimeseries } from '../../hooks/useOverviewData'
import { utcDayLabel, utcMonthLabel } from '../../lib/time'

/**
 * GitHub-style capture calendar over the daily timeseries. The server buckets
 * by UTC day, so the grid is built on UTC calendar dates to stay aligned.
 */

const DAY_MS = 86_400_000
const WEEKS = 16 // 15 full weeks + the current one

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function utcSunday(d: Date): Date {
  const day = startOfUtcDay(d)
  return new Date(day.getTime() - day.getUTCDay() * DAY_MS)
}

const dayKey = (d: Date): string => d.toISOString().slice(0, 10)

/** Opacity tier for a day's count: 0 empty, 1..4 increasing intensity. */
function levelFor(count: number): number {
  if (count >= 10) return 4
  if (count >= 6) return 3
  if (count >= 3) return 2
  if (count >= 1) return 1
  return 0
}

const LEVEL_MIX: Record<number, string> = {
  0: 'var(--c-surface-alt)',
  1: 'color-mix(in srgb, var(--c-accent) 25%, var(--c-surface))',
  2: 'color-mix(in srgb, var(--c-accent) 45%, var(--c-surface))',
  3: 'color-mix(in srgb, var(--c-accent) 70%, var(--c-surface))',
  4: 'var(--c-accent)',
}

interface Hover {
  x: number
  y: number
  label: string
  count: number
}

export function CaptureHeatmap() {
  const { data, isError, isPending, refetch } = useDailyTimeseries()
  const containerRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<Hover | null>(null)

  const weeks = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of data?.points ?? []) counts.set(p.bucketStart.slice(0, 10), p.total)

    const today = startOfUtcDay(new Date())
    const firstSunday = new Date(utcSunday(today).getTime() - (WEEKS - 1) * 7 * DAY_MS)

    const columns: Array<Array<{ date: Date; count: number; future: boolean }>> = []
    for (let w = 0; w < WEEKS; w++) {
      const column: Array<{ date: Date; count: number; future: boolean }> = []
      for (let dow = 0; dow < 7; dow++) {
        const date = new Date(firstSunday.getTime() + (w * 7 + dow) * DAY_MS)
        column.push({ date, count: counts.get(dayKey(date)) ?? 0, future: date.getTime() > today.getTime() })
      }
      columns.push(column)
    }

    const total = [...counts.values()].reduce((a, b) => a + b, 0)
    let best = 0
    for (const n of counts.values()) best = Math.max(best, n)
    return { columns, total, best }
  }, [data])

  const showCell = (cell: HTMLElement, date: Date, count: number) => {
    const cellRect = cell.getBoundingClientRect()
    const box = containerRef.current?.getBoundingClientRect()
    if (!box) return
    setHover({
      x: cellRect.left - box.left + cellRect.width / 2,
      y: cellRect.top - box.top,
      label: utcDayLabel(dayKey(date)),
      count,
    })
  }

  return (
    <WidgetCard
      title="Capture activity"
      action={
        data ? (
          <span className="text-caption text-ink3 tabular-nums">
            {weeks.total.toLocaleString()} memories, busiest day {weeks.best}
          </span>
        ) : null
      }
    >
      {isError ? (
        <WidgetError onRetry={() => void refetch()} />
      ) : isPending ? (
        <Skeleton className="h-[132px] w-full" />
      ) : weeks.total === 0 ? (
        <WidgetEmpty>Captured memories will appear here, one square per day.</WidgetEmpty>
      ) : (
        <div
          ref={containerRef}
          role="group"
          aria-label="Capture calendar, one day button per square"
          className="relative w-fit"
          onMouseLeave={() => setHover(null)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(null)
          }}
        >
          <div className="flex gap-[3px]">
            <div className="mr-xs flex flex-col gap-[3px] pt-[14px]" aria-hidden="true">
              {[1, 3, 5].map((dow) => (
                <div key={dow} className="flex h-[13px] items-center text-micro leading-none text-ink3">
                  {['M', 'W', 'F'][Math.floor(dow / 2)]}
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-[3px]">
              <div className="flex h-[11px] gap-[3px]">
                {weeks.columns.map((column, i) => {
                  const first = column[0]
                  const prev = i > 0 ? weeks.columns[i - 1]![0] : null
                  const monthChanged = !prev || prev.date.getUTCMonth() !== first.date.getUTCMonth()
                  return (
                    <div key={dayKey(first.date)} className="w-[13px] text-micro leading-none text-ink3">
                      {monthChanged ? utcMonthLabel(dayKey(first.date)) : ''}
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-[3px]">
                {weeks.columns.map((column) => (
                  <div key={dayKey(column[0]!.date)} className="flex flex-col gap-[3px]">
                    {column.map(({ date, count, future }) => (
                      <button
                        key={dayKey(date)}
                        type="button"
                        aria-label={`${utcDayLabel(dayKey(date))}: ${count} ${count === 1 ? 'memory' : 'memories'}`}
                        className={`h-[13px] w-[13px] rounded-[3px] border-0 p-0 ${
                          future
                            ? 'invisible'
                            : 'cursor-default focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'
                        }`}
                        style={{ backgroundColor: future ? undefined : LEVEL_MIX[levelFor(count)] }}
                        onMouseEnter={(e) => showCell(e.currentTarget, date, count)}
                        onFocus={(e) => showCell(e.currentTarget, date, count)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setHover(null)
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {hover && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-sm border border-hairline bg-surface px-sm py-xs text-caption shadow-sm"
              style={{ left: hover.x, top: hover.y - 6 }}
            >
              <span className="font-medium">{hover.count === 1 ? '1 memory' : `${hover.count} memories`}</span>{' '}
              <span className="text-ink2">{hover.label}</span>
            </div>
          )}
        </div>
      )}
    </WidgetCard>
  )
}
