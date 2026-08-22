import { useMemo, type ReactNode } from 'react'
import type { Citation } from '../../api/types'

/**
 * The grounded-answer prompt makes the model cite sources inline, either as
 * "[M3]" or "(memory M3)". Tag numbers index the done-frame citations array
 * (relevance order, 1-based — see packages/core/retrieval/answer.ts).
 */
const CITE_PATTERN = /\[M(\d+)\]|\(memory\s+M(\d+)\)/gi

type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'cite'; label: string; citation: Citation | null }

function segmentAnswer(text: string, citations: Citation[]): Segment[] {
  const segments: Segment[] = []
  let cursor = 0

  for (const match of text.matchAll(CITE_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) {
      segments.push({ kind: 'text', value: text.slice(cursor, index) })
    }
    const number = Number(match[1] ?? match[2])
    const citation = number >= 1 && number <= citations.length ? citations[number - 1]! : null
    segments.push({ kind: 'cite', label: `M${number}`, citation })
    cursor = index + match[0].length
  }
  if (cursor < text.length) {
    segments.push({ kind: 'text', value: text.slice(cursor) })
  }
  return segments
}

interface AnswerTextProps {
  text: string
  citations: Citation[]
  streaming: boolean
  onOpenCitation: (memoryId: string) => void
}

/**
 * Answer body with live caret while streaming. Citation tags become inline
 * chips; unknown tags (server trimmed the citation list) stay as plain text.
 */
export function AnswerText({ text, citations, streaming, onOpenCitation }: AnswerTextProps) {
  const segments = useMemo(() => segmentAnswer(text, citations), [text, citations])

  const render = (): ReactNode => {
    if (text.length === 0) return null
    return segments.map((segment, index) => {
      if (segment.kind === 'text') {
        return <span key={index}>{segment.value}</span>
      }
      if (!segment.citation) {
        return <span key={index}>{segment.label}</span>
      }
      return (
        <button
          key={index}
          type="button"
          onClick={() => onOpenCitation(segment.citation!.memoryId)}
          aria-label={`Show source ${segment.label}`}
          className="mx-0.5 inline-flex h-5 min-w-5 translate-y-[-1px] items-center justify-center rounded-pill border border-accent-soft bg-accent-soft px-1 align-middle text-micro font-semibold text-accent transition-colors hover:border-accent"
        >
          {segment.label}
        </button>
      )
    })
  }

  return (
    <p className="whitespace-pre-wrap text-body leading-relaxed text-ink">
      {render()}
      {streaming && text.length > 0 && (
        <span aria-hidden className="ml-px inline-block h-4 w-[2px] animate-pulse rounded-sm bg-accent align-middle" />
      )}
    </p>
  )
}
