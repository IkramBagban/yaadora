import { Lightbulb, ThumbsUp, X } from 'lucide-react'
import type { PendingSurfacing } from '../../api/types'
import { usePendingSurfacings, useSurfacingReaction } from '../../ask/useSurfacings'
import { formatRelativeTime } from '../../lib/format'

function kindLabel(kind: string): string {
  return kind
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function Card({
  surfacing,
  onReact,
  busy,
}: {
  surfacing: PendingSurfacing
  onReact: (reaction: 'engaged' | 'dismissed') => void
  busy: boolean
}) {
  return (
    <article className="rounded-md border border-hairline bg-surface p-md">
      <div className="flex items-center gap-xs text-micro uppercase tracking-wide text-ink3">
        <Lightbulb size={13} className="text-accent" />
        {kindLabel(surfacing.kind)}
        <span className="ml-auto font-normal normal-case tracking-normal">
          {formatRelativeTime(surfacing.shownAt)}
        </span>
      </div>
      {surfacing.evidenceSnippets.length > 0 && (
        <p className="mt-xs line-clamp-2 text-caption text-ink2">
          {surfacing.evidenceSnippets[0]}
        </p>
      )}
      <div className="mt-sm flex items-center gap-xs">
        <button
          type="button"
          disabled={busy}
          onClick={() => onReact('engaged')}
          className="inline-flex h-7 items-center gap-xs rounded-pill bg-accent px-sm text-micro font-medium text-on-accent transition-colors hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
        >
          <ThumbsUp size={12} />
          Engage
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onReact('dismissed')}
          aria-label="Dismiss this suggestion"
          className="inline-flex size-7 items-center justify-center rounded-pill text-ink3 transition-colors hover:bg-surface-alt hover:text-ink disabled:pointer-events-none disabled:opacity-50"
        >
          <X size={13} />
        </button>
      </div>
    </article>
  )
}

/**
 * Pending nudge cards (GET /surfacings?status=pending). Every card leaves the
 * page through an explicit reaction — the ledger counts reactions, not views.
 */
export function SurfacingCards() {
  const { data: surfacings, isLoading } = usePendingSurfacings(true)
  const reaction = useSurfacingReaction()

  if (isLoading || !surfacings || surfacings.length === 0) return null

  return (
    <section aria-label="Suggested from your memories" className="grid gap-sm">
      {surfacings.map((surfacing) => (
        <Card
          key={surfacing.id}
          surfacing={surfacing}
          busy={reaction.isPending && reaction.variables?.id === surfacing.id}
          onReact={(value) => reaction.mutate({ id: surfacing.id, reaction: value })}
        />
      ))}
    </section>
  )
}
