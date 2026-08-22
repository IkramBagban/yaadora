import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AdminFact, FactView } from '../../api/types'
import { Badge } from '../../components/ui/Badge'
import { buildChains, type SubjectGroup } from './chain'
import { FactCard } from './FactCard'
import { SupersessionTimeline } from './SupersessionTimeline'

/**
 * One collapsible subject group. In history view, facts that supersession
 * linked collapse into chain timelines; everything else renders as cards.
 */
export interface SubjectSectionProps {
  group: SubjectGroup
  view: FactView
  onShowSource: (memoryId: string) => void
}

export function SubjectSection({ group, view, onShowSource }: SubjectSectionProps) {
  const [open, setOpen] = useState(true)
  const { chains, singles } = view === 'history' ? buildChains(group.facts) : { chains: [], singles: group.facts }

  return (
    <section className="rounded-lg border border-hairline bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-sm rounded-lg px-lg py-md text-left hover:bg-surface-alt"
      >
        {open ? <ChevronDown size={16} className="text-ink3" /> : <ChevronRight size={16} className="text-ink3" />}
        <h3 className="text-sub font-medium text-ink">{group.label}</h3>
        <Badge tone="neutral">{group.facts.length}</Badge>
        {chains.length > 0 && <Badge tone="accent">{chains.length} chains</Badge>}
      </button>

      {open && (
        <div className="flex flex-col gap-lg border-t border-hairline p-lg">
          {chains.map((chain) => (
            <SupersessionTimeline key={chain[0]?.id} chain={chain} onShowSource={onShowSource} />
          ))}
          {singles.length > 0 && <CardGrid facts={singles} onShowSource={onShowSource} />}
        </div>
      )}
    </section>
  )
}

function CardGrid({
  facts,
  onShowSource,
}: {
  facts: AdminFact[]
  onShowSource: (memoryId: string) => void
}): ReactNode {
  return (
    <div className="grid gap-lg sm:grid-cols-2">
      {facts.map((f) => (
        <FactCard key={f.id} fact={f} onShowSource={onShowSource} />
      ))}
    </div>
  )
}
