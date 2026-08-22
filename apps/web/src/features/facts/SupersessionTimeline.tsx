import { ArrowDown } from 'lucide-react'
import type { AdminFact } from '../../api/types'
import { Badge } from '../../components/ui/Badge'
import { formatDate } from '../../lib/format'
import { FactCard } from './FactCard'
import { SpanBar } from './Indicators'

/**
 * Vertical supersession timeline for one chain, oldest → newest. The rail
 * carries the arrows; each version shows its fact plus its validity span
 * plotted on the chain's shared time axis.
 */
export interface SupersessionTimelineProps {
  chain: AdminFact[]
  onShowSource: (memoryId: string) => void
}

function axisOf(chain: AdminFact[]): { from: number; to: number } {
  const now = Date.now()
  const starts = chain.map((f) => new Date(f.validFrom ?? f.createdAt).getTime())
  const ends = chain.map((f) => (f.validTo ? new Date(f.validTo).getTime() : now))
  return { from: Math.min(...starts), to: Math.max(...ends, now) }
}

export function SupersessionTimeline({ chain, onShowSource }: SupersessionTimelineProps) {
  const axis = axisOf(chain)
  const last = chain.length - 1

  return (
    <div className="rounded-lg border border-hairline bg-surface p-lg">
      <div className="mb-lg flex flex-wrap items-center justify-between gap-sm">
        <h4 className="text-micro uppercase text-ink3">
          Supersession chain · {chain.length} versions
        </h4>
        <span className="text-caption text-ink3">
          {formatDate(new Date(axis.from).toISOString())} →{' '}
          {formatDate(new Date(axis.to).toISOString())}
        </span>
      </div>

      <ol className="relative flex flex-col gap-lg pl-xxl">
        {/* rail the arrows sit on */}
        <span aria-hidden className="absolute inset-y-1 left-[9px] w-px bg-hairline" />
        {chain.map((fact, i) => (
          <li key={fact.id} className="relative">
            <span
              aria-hidden
              className={`absolute -left-xxl top-1.5 h-2.5 w-2.5 rounded-pill border-2 ${
                i === last ? 'border-success bg-surface' : 'border-accent bg-surface'
              }`}
            />
            <div className="mb-sm flex items-center gap-sm">
              {i < last ? (
                <Badge tone="neutral">
                  v{i + 1} superseded <ArrowDown size={11} className="ml-0.5 inline" />
                </Badge>
              ) : (
                <Badge tone="success">v{i + 1} current belief</Badge>
              )}
            </div>
            <FactCard fact={fact} onShowSource={onShowSource} />
            <div className="mt-sm">
              <SpanBar
                from={new Date(fact.validFrom ?? fact.createdAt).getTime()}
                to={fact.validTo ? new Date(fact.validTo).getTime() : axis.to}
                axisFrom={axis.from}
                axisTo={axis.to}
              />
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
