import { useState } from 'react'
import { ChevronRight, Lightbulb } from 'lucide-react'
import { usePatternFacts } from './useInsightsData'
import { PatternDrawer } from './PatternDrawer'
import { SectionCard } from './shared'
import { supportingMemoryIds } from '../../api/insights'
import type { Fact } from '../../api/types'

/**
 * Pattern insights feed — observations mined by nightly consolidation
 * (origin='consolidation' facts). Each item shows the insight text, how many
 * memories support it, and opens a receipt drawer. These are candidates, not
 * conclusions; the copy stays neutral.
 */

export function PatternInsightsSection() {
  const { data: facts, isPending, isError, refetch } = usePatternFacts()
  const [selected, setSelected] = useState<Fact | null>(null)

  return (
    <>
      <SectionCard
        title="Pattern insights"
        description="Recurring threads and connections consolidation noticed across your memories. Neutral observations with receipts; tap one to see the supporting memories."
        loading={isPending}
        error={isError}
        onRetry={() => void refetch()}
        isEmpty={!facts?.length}
        emptyMessage="No patterns yet. Insights appear once enough memories accumulate for consolidation to find recurring threads."
      >
        <ul className="flex flex-col">
          {facts?.map((fact) => {
            const support = supportingMemoryIds(fact).length
            return (
              <li key={fact.id} className="border-b border-hairline last:border-b-0">
                <button
                  type="button"
                  onClick={() => setSelected(fact)}
                  className="flex w-full items-start gap-md py-sm text-left transition-colors hover:bg-surface-alt"
                >
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-accent">
                    <Lightbulb size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sub text-ink">{fact.factText}</span>
                    <span className="mt-1 block text-caption text-ink2">
                      {support} supporting {support === 1 ? 'memory' : 'memories'} ·
                      confidence {Math.round((fact.confidence ?? 0) * 100)}%
                    </span>
                  </span>
                  <ChevronRight size={16} className="mt-1 shrink-0 text-ink3" />
                </button>
              </li>
            )
          })}
        </ul>
      </SectionCard>

      {selected && (
        <PatternDrawer key={selected.id} fact={selected} onClose={() => setSelected(null)} />
      )}
    </>
  )
}
