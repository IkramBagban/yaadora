import { Link } from '@tanstack/react-router'
import { ArrowUpDown } from 'lucide-react'
import type { EntityContextEdge } from '../api'
import { Badge } from '../../../components/ui/Badge'
import { formatRelative } from '../format'
import { EDGE_STATUS_TONE, entityTypeMeta } from '../meta'
import { EmptyBlock } from './states'

interface RelationsMapProps {
  edges: EntityContextEdge[]
}

/**
 * E-2 relationship map section: 1-hop edges with derived status, strength
 * meter (co-mention frequency × recency) and evidence counts.
 */
export function RelationsMap({ edges }: RelationsMapProps) {
  if (edges.length === 0) {
    return (
      <EmptyBlock
        title="No mapped relationships yet."
        hint="Connections are re-derived from facts during the nightly consolidation rebuild."
      />
    )
  }

  return (
    <ul className="flex flex-col divide-y divide-hairline">
      {edges.map((edge) => {
        const Icon = entityTypeMeta(edge.otherType).icon
        const tone = EDGE_STATUS_TONE[edge.status] ?? 'neutral'

        return (
          <li key={edge.id} className="py-md">
            <div className="flex flex-wrap items-center gap-sm">
              <span className="flex size-7 items-center justify-center rounded-sm bg-accent-soft text-accent">
                <Icon size={14} />
              </span>
              {edge.otherIsKnownEntity ? (
                <Link
                  to="/entities/$id"
                  params={{ id: edge.otherId }}
                  className="text-sub font-medium text-accent hover:underline"
                >
                  {edge.otherName}
                </Link>
              ) : (
                <span className="text-sub font-medium">{edge.otherName}</span>
              )}
              <Badge>{edge.relType}</Badge>
              <Badge tone={tone}>{edge.status}</Badge>
              <span className="ml-auto inline-flex items-center gap-1 text-caption text-ink3">
                seen {formatRelative(edge.lastMentioned)}
              </span>
            </div>

            <div className="mt-sm flex items-center gap-md">
              <ArrowUpDown size={12} className="shrink-0 text-ink3" aria-hidden />
              <div
                className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-pill bg-surface-alt"
                title={`tie weight: ${edge.evidence.length} supporting memor${edge.evidence.length === 1 ? 'y' : 'ies'}`}
              >
                {/* The context payload carries evidence counts, not raw strength
                    scores — scale the meter over a 5-receipt ceiling. */}
                <div
                  className="h-full rounded-pill bg-accent/70"
                  style={{ width: `${Math.min(100, Math.round((edge.evidence.length / 5) * 100))}%` }}
                />
              </div>
              <span className="w-28 shrink-0 text-right text-caption text-ink3">
                {edge.evidence.length} receipt{edge.evidence.length === 1 ? '' : 's'}
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
