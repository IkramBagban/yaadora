import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import type { EntityContextPayload } from '../api'
import { Badge } from '../../../components/ui/Badge'
import { formatRelative } from '../format'
import { entityTypeMeta } from '../meta'
import { buildMentionTrend } from '../trend'
import { Sparkline } from './Sparkline'

interface ProfileHeaderProps {
  payload: EntityContextPayload
  /** Directory row for this entity when loaded (supplies mention count / last seen). */
  directoryRow: { mentionCount: number; lastSeen: string | null } | null
}

/**
 * E-2 profile overview header: identity block (name, type, mention count,
 * last seen) beside the E-6 mention-trend sparkline.
 */
export function ProfileHeader({ payload, directoryRow }: ProfileHeaderProps) {
  const Icon = entityTypeMeta(payload.entity.type).icon
  const trend = buildMentionTrend(payload.receipts)

  return (
    <header className="flex flex-col gap-xl">
      <Link
        to="/entities"
        className="inline-flex items-center gap-1 self-start text-caption text-ink2 transition-colors hover:text-accent"
      >
        <ArrowLeft size={13} /> All entities
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-xl">
        <div className="flex min-w-0 items-center gap-lg">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
            <Icon size={22} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-display font-bold tracking-tight">{payload.entity.canonicalName}</h1>
            <div className="mt-xs flex flex-wrap items-center gap-sm text-caption text-ink2">
              <Badge tone="accent">{payload.entity.type}</Badge>
              {directoryRow && (
                <>
                  <span>{directoryRow.mentionCount} mentions</span>
                  <span aria-hidden>·</span>
                  <span>seen {formatRelative(directoryRow.lastSeen)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="w-full max-w-56 shrink-0 rounded-md border border-hairline p-md">
          {/* Receipts-backed, not total mentions: /entities/:id/context returns
              only top-facts/edges provenance, so the series undercounts until a
              per-entity timeseries endpoint exists (see track learnings). */}
          <p
            className="text-micro uppercase text-ink3"
            title="Dossier receipts per month — a lower bound on real mentions until a per-entity timeseries exists"
          >
            receipts · last 12 months
          </p>
          <div className="mt-sm h-9 text-accent">
            <Sparkline points={trend.counts} label="Dossier receipts per month over the last 12 months" />
          </div>
        </div>
      </div>
    </header>
  )
}
