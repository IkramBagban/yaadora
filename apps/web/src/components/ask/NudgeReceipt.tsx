import { BookOpen, ThumbsUp, X } from 'lucide-react'
import { useSurfacingReaction } from '../../ask/useSurfacings'

interface NudgeReceiptProps {
  surfacingId: string
  /** evidence memory ids woven into the nudge (done frame) */
  evidence: string[]
  onShowEvidence: (memoryIds: string[]) => void
}

/**
 * Receipt for a proactive nudge the server wove into this answer (P2): names
 * its evidence and records the user's reaction via POST /surfacings/:id/reaction.
 */
export function NudgeReceipt({ surfacingId, evidence, onShowEvidence }: NudgeReceiptProps) {
  const reaction = useSurfacingReaction()

  if (reaction.isSuccess) return null

  return (
    <div className="flex flex-wrap items-center gap-sm text-caption text-ink3">
      <span>Woven from a nudge</span>
      <button
        type="button"
        onClick={() => onShowEvidence(evidence)}
        disabled={evidence.length === 0}
        className="inline-flex h-7 items-center gap-xs rounded-pill border border-hairline bg-surface-alt px-sm text-caption-medium text-ink2 transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-50"
      >
        <BookOpen size={12} />
        {evidence.length} source{evidence.length === 1 ? '' : 's'}
      </button>
      <span className="flex items-center gap-xs">
        <button
          type="button"
          aria-label="Mark nudge as engaged"
          disabled={reaction.isPending}
          onClick={() => reaction.mutate({ id: surfacingId, reaction: 'engaged' })}
          className="inline-flex size-7 items-center justify-center rounded-pill text-ink3 transition-colors hover:bg-surface-alt hover:text-success disabled:pointer-events-none disabled:opacity-50"
        >
          <ThumbsUp size={13} />
        </button>
        <button
          type="button"
          aria-label="Dismiss nudge"
          disabled={reaction.isPending}
          onClick={() => reaction.mutate({ id: surfacingId, reaction: 'dismissed' })}
          className="inline-flex size-7 items-center justify-center rounded-pill text-ink3 transition-colors hover:bg-surface-alt hover:text-ink disabled:pointer-events-none disabled:opacity-50"
        >
          <X size={13} />
        </button>
      </span>
    </div>
  )
}
