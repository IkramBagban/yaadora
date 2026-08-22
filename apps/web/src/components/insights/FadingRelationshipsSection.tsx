import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRight, UserRound } from 'lucide-react'
import { useEntities } from './useInsightsData'
import { SectionCard } from './shared'
import { humanizeToken } from './lib'
import { Badge } from '../ui/Badge'

/**
 * Fading relationships — well-established entities (≥10 lifetime mentions)
 * whose last seen is older than 6 months. The point is a gentle nudge list,
 * not an exhaustive report: entities with no lastSeen can't be judged and are
 * skipped rather than guessed about.
 */

const SIX_MONTHS_MS = 182.5 * 24 * 60 * 60 * 1000
const MIN_MENTIONS = 10

function sinceLabel(lastSeen: string, now: number): string {
  const months = (now - new Date(lastSeen).getTime()) / (30.44 * 24 * 3600 * 1000)
  if (months < 12) return `${Math.round(months)} month${Math.round(months) === 1 ? '' : 's'} ago`
  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? '' : 's'} ago`
}

export function FadingRelationshipsSection() {
  const { data, isPending, isError, refetch } = useEntities()
  // Anchor "now" once per mount; recomputing it every render is both impure
  // and enough to make labels flicker near month boundaries.
  const [now] = useState(() => Date.now())

  const fading = useMemo(() => {
    const cutoff = now - SIX_MONTHS_MS
    return (data?.entities ?? [])
      .filter(
        (e) =>
          e.mentionCount >= MIN_MENTIONS &&
          e.lastSeen !== null &&
          new Date(e.lastSeen).getTime() < cutoff,
      )
      .sort(
        (a, b) =>
          new Date(a.lastSeen ?? 0).getTime() - new Date(b.lastSeen ?? 0).getTime(),
      )
  }, [data, now])

  return (
    <SectionCard
      title="Fading relationships"
      description={`People and projects with ${MIN_MENTIONS}+ lifetime mentions that haven't come up in over 6 months.`}
      loading={isPending}
      error={isError}
      onRetry={() => void refetch()}
      isEmpty={fading.length === 0}
      emptyMessage="Nothing is going quiet. Your most-mentioned people and projects have all come up recently."
    >
      <ul className="flex flex-col">
        {fading.map((e) => (
          <li key={e.id} className="border-b border-hairline last:border-b-0">
            <Link
              to="/entities/$id"
              params={{ id: e.id }}
              className="flex items-center gap-md py-sm transition-colors hover:bg-surface-alt"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-surface-alt text-ink3">
                <UserRound size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sub font-medium text-ink">{e.canonicalName}</p>
                <p className="text-caption text-ink2">
                  {e.mentionCount} mentions · last seen{' '}
                  {new Date(e.lastSeen ?? 0).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}{' '}
                  ({sinceLabel(e.lastSeen ?? '', now)})
                </p>
              </div>
              <Badge tone="neutral">{humanizeToken(e.type)}</Badge>
              <ChevronRight size={16} className="shrink-0 text-ink3" />
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}
