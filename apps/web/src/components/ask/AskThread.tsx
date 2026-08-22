import { useEffect, useRef } from 'react'
import { History, Sparkles } from 'lucide-react'
import type { Exchange } from '../../ask/useAskSession'
import type { ConversationSummary } from '../../api/types'
import { ExchangeView } from './ExchangeView'
import { SurfacingCards } from './SurfacingCards'

const STARTERS = [
  'What are my open loops?',
  'What did I capture this week?',
  'What should I follow up on?',
]

interface AskThreadProps {
  exchanges: Exchange[]
  /** the resumed conversation, when the thread continues an existing one */
  conversation: ConversationSummary | null
  onRetry: (id: string, question: string) => void
  onQuickReply: (text: string) => void
  onOpenCitations: (exchange: Exchange, focusMemoryId?: string) => void
  onShowEvidence: (memoryIds: string[]) => void
  onStarterPick: (text: string) => void
}

function EmptyThread({
  conversation,
  onStarterPick,
}: {
  conversation: ConversationSummary | null
  onStarterPick: (text: string) => void
}) {
  if (conversation && conversation.turnCount > 0) {
    return (
      <div className="rounded-md border border-hairline bg-surface p-lg">
        <p className="flex items-center gap-xs text-caption-medium text-ink2">
          <History size={14} className="text-ink3" />
          Continuing an earlier conversation
        </p>
        <p className="mt-xs text-caption text-ink3">
          {conversation.turnCount} earlier turn{conversation.turnCount === 1 ? '' : 's'} stay on
          the server and inform the next answer.
          {conversation.summary ? ` Recent thread: ${conversation.summary}` : ''}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-lg py-huge text-center">
      <span className="flex size-12 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <Sparkles size={22} />
      </span>
      <div>
        <h1 className="text-title font-semibold text-ink">Ask your memory</h1>
        <p className="mt-xs text-sub text-ink2">
          Answers cite the memories they came from. Type or speak.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-xs">
        {STARTERS.map((starter) => (
          <button
            key={starter}
            type="button"
            onClick={() => onStarterPick(starter)}
            className="rounded-pill border border-hairline bg-surface px-md py-xs text-caption text-ink2 transition-colors hover:border-accent hover:text-accent"
          >
            {starter}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Scrollable conversation feed. Autoscrolls while pinned to the bottom (the
 * user scrolling up pauses it so streaming never yanks the view).
 */
export function AskThread({
  exchanges,
  conversation,
  onRetry,
  onQuickReply,
  onOpenCitations,
  onShowEvidence,
  onStarterPick,
}: AskThreadProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pinnedRef = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [exchanges])

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const el = event.currentTarget
        pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
      }}
      className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-hairline bg-surface px-lg py-lg md:px-xl"
    >
      <SurfacingCards />

      {exchanges.length === 0 ? (
        <EmptyThread conversation={conversation} onStarterPick={onStarterPick} />
      ) : (
        <div className="flex flex-col pt-md">
          {exchanges.map((exchange) => (
            <ExchangeView
              key={exchange.id}
              exchange={exchange}
              onRetry={onRetry}
              onQuickReply={onQuickReply}
              onOpenCitations={onOpenCitations}
              onShowEvidence={onShowEvidence}
            />
          ))}
        </div>
      )}
    </div>
  )
}
