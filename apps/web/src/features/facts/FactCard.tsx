import type { ReactNode } from 'react'
import { Link2 } from 'lucide-react'
import type { AdminFact } from '../../api/types'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { cn } from '../../lib/cn'
import { ConfidenceBar, ValidityRange } from './Indicators'

/** origin badge copy: extraction facts came from a capture, consolidation
 *  facts were mined out of recurring patterns. */
const ORIGIN_LABELS: Record<string, { label: string; tone: 'neutral' | 'accent' }> = {
  extraction: { label: 'extracted', tone: 'neutral' },
  consolidation: { label: 'pattern-mined', tone: 'accent' },
}

function originBadge(origin: string) {
  const known = ORIGIN_LABELS[origin]
  return <Badge tone={known?.tone ?? 'neutral'}>{known?.label ?? origin}</Badge>
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-pill bg-surface-alt px-sm py-0.5 text-micro text-ink2">
      {children}
    </code>
  )
}

export interface FactCardProps {
  fact: AdminFact
  onShowSource: (memoryId: string) => void
  /** extra actions rendered next to the source link (hide, keep both, …) */
  actions?: ReactNode
  className?: string
}

/** One atomic fact with its metadata: chips, confidence, validity, provenance. */
export function FactCard({ fact, onShowSource, actions, className }: FactCardProps) {
  return (
    <Card className={cn('flex flex-col gap-md', fact.hidden && 'opacity-55', className)}>
      <div className="flex items-start justify-between gap-sm">
        <p className="text-body text-ink">{fact.factText}</p>
        <span className="flex shrink-0 gap-xs">
          {fact.conflicted && <Badge tone="danger">conflict</Badge>}
          {fact.hidden && <Badge tone="pending">hidden</Badge>}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-sm">
        {fact.predicate && <Chip>{fact.predicate}</Chip>}
        <Chip>{fact.factType}</Chip>
        {originBadge(fact.origin)}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-sm">
        <ConfidenceBar value={fact.confidence} />
        <ValidityRange from={fact.validFrom} to={fact.validTo} />
      </div>

      {fact.conflictNote && (
        <p className="rounded-sm bg-surface-alt px-md py-sm text-caption text-ink2">
          {fact.conflictNote}
        </p>
      )}

      <footer className="mt-auto flex flex-wrap items-center gap-sm border-t border-hairline pt-md">
        <Button variant="ghost" size="sm" onClick={() => onShowSource(fact.sourceMemory)}>
          <Link2 size={14} /> Source memory
        </Button>
        {actions}
      </footer>
    </Card>
  )
}
