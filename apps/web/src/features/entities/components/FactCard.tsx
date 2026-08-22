import { Link } from '@tanstack/react-router'
import { Badge } from '../../../components/ui/Badge'
import { ReceiptText, TriangleAlert } from 'lucide-react'
import { formatDate } from '../format'
import type { FactHistoryItem } from '../api'
import { ValidityBar } from './ValidityBar'

interface FactCardProps {
  fact: FactHistoryItem
  /** Observation window (epoch ms) used to position the validity bar. */
  windowStart: number
  windowEnd: number
}

/**
 * One fact with its E-3 validity bar and provenance. Conflicted facts render
 * the E-5 danger badge linking into the Facts Explorer inbox.
 */
export function FactCard({ fact, windowStart, windowEnd }: FactCardProps) {
  const isCurrent = fact.validTo === null

  return (
    <li className="flex flex-col gap-xs py-md">
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <p className="text-sub text-ink">{fact.factText}</p>
        <span className="shrink-0 text-micro uppercase text-ink3">
          {isCurrent ? 'current' : 'closed'}
        </span>
      </div>

      <div className="flex items-center gap-md">
        <div className="min-w-32 flex-1">
          <ValidityBar
            validFrom={fact.validFrom ?? fact.createdAt}
            validTo={fact.validTo}
            windowStart={windowStart}
            windowEnd={windowEnd}
          />
        </div>
        <span className="shrink-0 text-caption text-ink3">
          {formatDate(fact.validFrom ?? fact.createdAt) || '?'} →{' '}
          {fact.validTo ? formatDate(fact.validTo) : 'now'}
        </span>
      </div>

      {(fact.conflicted || fact.conflictNote) && (
        <div className="flex flex-wrap items-center gap-sm">
          {fact.conflicted && (
            <Link
              to="/facts"
              className="inline-flex items-center gap-1 rounded-pill bg-accent-soft px-sm py-0.5 text-micro uppercase text-danger hover:opacity-80"
              title="Open in the Facts Explorer conflicts inbox"
            >
              <TriangleAlert size={11} /> conflict — review
            </Link>
          )}
          {fact.conflictNote && (
            <span className="text-caption text-ink2">“{fact.conflictNote}”</span>
          )}
        </div>
      )}

      <div className="flex items-center gap-lg text-caption text-ink3">
        <Badge>{fact.origin}</Badge>
        <span>{Math.round(fact.confidence * 100)}% confidence</span>
        <a
          href={`/timeline?memory=${encodeURIComponent(fact.sourceMemory)}`}
          className="ml-auto inline-flex items-center gap-1 text-accent hover:underline"
          title="Open the source memory in the timeline"
        >
          <ReceiptText size={12} /> receipt
        </a>
      </div>
    </li>
  )
}
