import { AlertTriangle, BookOpen, ChevronUp, RotateCcw } from 'lucide-react'
import type { Exchange } from '../../ask/useAskSession'
import { formatConfidence } from '../../lib/format'
import { AnswerText } from './AnswerText'
import { NudgeReceipt } from './NudgeReceipt'
import { ReasoningStrip } from './ReasoningStrip'
import { ReminderChip } from './ReminderChip'

interface ExchangeViewProps {
  exchange: Exchange
  onRetry: (id: string, question: string) => void
  onQuickReply: (text: string) => void
  onOpenCitations: (exchange: Exchange, focusMemoryId?: string) => void
  onShowEvidence: (memoryIds: string[]) => void
}

/**
 * One question → answer in the thread. The user's message sits in a soft
 * bubble on the right; the agent answers in full-width text on the left with
 * its reasoning trace above, a small kind label naming what the reply is, and
 * citations / reminder / nudge affordances below once it settles.
 */
export function ExchangeView({
  exchange,
  onRetry,
  onQuickReply,
  onOpenCitations,
  onShowEvidence,
}: ExchangeViewProps) {
  const streaming = exchange.status === 'streaming'
  const errored = exchange.status === 'error'
  const clarify = exchange.mode === 'clarify'
  const settled = exchange.status === 'done'
  const searched = exchange.steps.some((s) => s.kind === 'search')
  const grounded = exchange.citations.length > 0
  const foundNothing = settled && !clarify && !grounded && searched

  return (
    <article className="flex flex-col gap-lg pb-xxl">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-br-sm border border-hairline bg-surface-alt px-lg py-md text-body text-ink md:max-w-[70%]">
          <p className="whitespace-pre-wrap">{exchange.question}</p>
        </div>
      </div>

      <div className="flex flex-col gap-md">
        <ReasoningStrip steps={exchange.steps} streaming={streaming} />

        {clarify && exchange.text.length > 0 && (
          <p className="text-micro uppercase tracking-wide text-accent">A quick question</p>
        )}
        {foundNothing && (
          <p className="text-micro uppercase tracking-wide text-ink3">Not in your memory</p>
        )}

        {errored && exchange.text.length === 0 ? (
          <div className="flex flex-col items-start gap-sm rounded-md border border-hairline bg-surface p-md">
            <span className="flex items-center gap-xs text-caption-medium text-danger">
              <AlertTriangle size={14} />
              {exchange.error || 'Can’t reach your memories right now'}
            </span>
            <p className="text-caption text-ink3">Your question wasn’t lost.</p>
            <button
              type="button"
              onClick={() => onRetry(exchange.id, exchange.question)}
              className="inline-flex h-8 items-center gap-xs rounded-pill bg-accent px-sm text-caption-medium text-on-accent transition-colors hover:opacity-90"
            >
              <RotateCcw size={13} />
              Try again
            </button>
          </div>
        ) : (
          <AnswerText
            text={exchange.text}
            citations={exchange.citations}
            streaming={streaming}
            onOpenCitation={(memoryId) => onOpenCitations(exchange, memoryId)}
          />
        )}
      </div>

      {(exchange.interrupted || exchange.status === 'stopped') && !errored && (
        <p className="flex items-center gap-sm text-caption text-ink3">
          {exchange.status === 'stopped' ? 'Stopped.' : 'The answer was interrupted.'}
          <button
            type="button"
            onClick={() => onRetry(exchange.id, exchange.question)}
            className="inline-flex items-center gap-xs text-caption-medium text-accent hover:underline"
          >
            <RotateCcw size={12} />
            Try again
          </button>
        </p>
      )}

      {settled && (
        <div className="flex flex-col gap-lg">
          {exchange.reminderSuggestion && (
            <ReminderChip suggestion={exchange.reminderSuggestion} />
          )}

          {exchange.surfacingId && (
            <NudgeReceipt
              surfacingId={exchange.surfacingId}
              evidence={exchange.evidence}
              onShowEvidence={onShowEvidence}
            />
          )}

          {clarify && exchange.clarifyOptions.length > 0 && (
            <div className="flex flex-wrap gap-xs">
              {exchange.clarifyOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onQuickReply(option)}
                  className="rounded-pill border border-hairline bg-surface-alt px-md py-xs text-caption text-ink2 transition-colors hover:border-accent hover:text-accent"
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          {grounded && (
            <div className="flex items-center gap-sm">
              <button
                type="button"
                onClick={() => onOpenCitations(exchange)}
                aria-label={`Show ${exchange.citations.length} sources`}
                className="inline-flex h-8 items-center gap-xs rounded-pill border border-hairline bg-surface-alt px-md text-caption-medium text-ink2 transition-colors hover:text-ink"
              >
                <BookOpen size={13} />
                {exchange.citations.length} source{exchange.citations.length === 1 ? '' : 's'}
                <ChevronUp size={13} className="text-ink3" />
              </button>
              {exchange.confidence !== null && (
                <span className="text-micro text-ink3">
                  {formatConfidence(exchange.confidence)} confident
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  )
}
