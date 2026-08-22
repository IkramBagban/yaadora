import { TriangleAlert } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { FactHistoryItem } from '../api'
import { FactCard } from './FactCard'
import { EmptyBlock } from './states'

interface FactsSectionProps {
  facts: FactHistoryItem[]
  windowStart: number
  windowEnd: number
}

/**
 * Current truth for this entity: every fact still in force (valid_to IS NULL),
 * each with its validity bar. Conflicted rows are surfaced at the top of the
 * section so contradictions are impossible to miss (E-5).
 */
export function FactsSection({ facts, windowStart, windowEnd }: FactsSectionProps) {
  if (facts.length === 0) {
    return <EmptyBlock title="No current facts." hint="Facts appear once memories about this entity are processed." />
  }

  const conflicted = facts.filter((f) => f.conflicted)

  return (
    <div>
      {conflicted.length > 0 && (
        <Link
          to="/facts"
          className="mb-md flex items-center gap-sm rounded-md border border-hairline bg-accent-soft px-lg py-sm text-caption text-danger transition-opacity hover:opacity-80"
        >
          <TriangleAlert size={14} />
          {conflicted.length} conflicting fact{conflicted.length === 1 ? '' : 's'} need review
          — open the conflicts inbox
        </Link>
      )}

      <ul className="divide-y divide-hairline">
        {facts.map((fact) => (
          <FactCard key={fact.id} fact={fact} windowStart={windowStart} windowEnd={windowEnd} />
        ))}
      </ul>
    </div>
  )
}
