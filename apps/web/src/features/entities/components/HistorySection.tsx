import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { FactHistoryItem } from '../api'
import { cn } from '../../../lib/cn'
import { formatDate } from '../format'
import { FactCard } from './FactCard'

interface HistorySectionProps {
  /** Closed facts only (valid_to IS NOT NULL) — the caller filters. */
  facts: FactHistoryItem[]
  windowStart: number
  windowEnd: number
}

/** One supersession chain: same predicate, oldest → newest ("what replaced what"). */
function HistoryGroup({ chain, windowStart, windowEnd }: { chain: FactHistoryItem[]; windowStart: number; windowEnd: number }) {
  const label = chain[0]?.predicate ?? 'general'

  return (
    <div>
      <p className="text-caption-medium uppercase text-ink3">{label}</p>
      <ol className="mt-xs flex flex-col">
        {chain.map((fact, i) => (
          <li key={fact.id} className="relative pl-lg">
            {/* Chain rail connecting each claim to its replacement below it. */}
            {i < chain.length - 1 && (
              <span aria-hidden className="absolute left-1 top-6 h-full w-px bg-hairline" />
            )}
            <span
              aria-hidden
              className={cn(
                'absolute -left-px top-4 size-2 rounded-pill border border-hairline',
                i === chain.length - 1 ? 'bg-accent' : 'bg-surface-alt',
              )}
            />
            <div className="pb-md">
              <FactCard fact={fact} windowStart={windowStart} windowEnd={windowEnd} />
              {i < chain.length - 1 && (
                <p className="-mt-sm text-caption text-ink3">
                  replaced by “{chain[i + 1]!.factText}” · {formatDate(chain[i + 1]!.createdAt)}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * E-4 supersession history — collapsed by default (native <details>), expanded
 * per-predicate chains ordered oldest → newest so every closed fact shows what
 * replaced it.
 */
export function HistorySection({ facts, windowStart, windowEnd }: HistorySectionProps) {
  const [open, setOpen] = useState(false)

  const chains = new Map<string, FactHistoryItem[]>()
  for (const fact of facts) {
    const key = fact.predicate ?? 'general'
    const group = chains.get(key)
    if (group) group.push(fact)
    else chains.set(key, [fact])
  }
  // Oldest first inside a chain; heaviest chains first across groups.
  const groups = Array.from(chains.values())
    .map((g) => [...g].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)))
    .sort((a, b) => b.length - a.length)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-md rounded-md px-lg py-sm text-left transition-colors hover:bg-surface-alt"
      >
        <span className="text-sub text-ink2">
          Superseded history{' '}
          <span className="text-caption text-ink3">
            · {facts.length} closed fact{facts.length === 1 ? '' : 's'}
          </span>
        </span>
        <ChevronDown size={16} className={cn('shrink-0 text-ink2 transition-transform', open && 'rotate-180')} />
      </button>

      {open &&
        (groups.length === 0 ? (
          <p className="px-lg pb-md text-caption text-ink3">Nothing superseded yet.</p>
        ) : (
          <div className="flex flex-col gap-xl px-lg pt-md">
            {groups.map((group) => (
              <HistoryGroup key={`${group[0]?.id}-chain`} chain={group} windowStart={windowStart} windowEnd={windowEnd} />
            ))}
          </div>
        ))}
    </div>
  )
}
