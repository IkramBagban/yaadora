import { useMemo } from 'react'
import { WidgetCard, WidgetEmpty, WidgetError } from './parts'
import { Skeleton } from '../ui/Skeleton'
import { useWeekDigest } from '../../hooks/useOverviewData'
import { relativeTime } from '../../lib/time'

/**
 * This week's digest, rendered as markdown-lite: ATX headings, bullet lists,
 * blank-line paragraphs, and **bold** inline. Anything heavier is out of scope
 * for a side-column card.
 */

type Block = { kind: 'heading'; text: string } | { kind: 'para'; text: string } | { kind: 'list'; items: string[] }

function parseBlocks(content: string): Block[] {
  const blocks: Block[] = []
  let list: string[] | null = null

  const flush = () => {
    if (list && list.length > 0) blocks.push({ kind: 'list', items: list })
    list = null
  }

  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    const heading = /^#{1,3}\s+(.*)$/.exec(line)
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({ kind: 'heading', text: heading[1]! })
    } else if (bullet) {
      list = list ?? []
      list.push(bullet[1]!)
    } else {
      flush()
      blocks.push({ kind: 'para', text: line })
    }
  }
  flush()
  return blocks
}

/** Renders **bold** spans; any other inline syntax stays literal. */
function InlineText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <strong key={i} className="font-semibold text-ink">{part}</strong> : <span key={i}>{part}</span>,
      )}
    </>
  )
}

export function DigestCard() {
  const { week, isError, isPending, refetch } = useWeekDigest()
  const blocks = useMemo(() => (week ? parseBlocks(week.content) : []), [week])

  return (
    <WidgetCard
      title="This week"
      action={
        week ? <span className="text-caption text-ink3">Updated {relativeTime(week.updatedAt)}</span> : null
      }
    >
      {isError ? (
        <WidgetError onRetry={() => void refetch()} />
      ) : isPending ? (
        <div className="flex flex-col gap-sm">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-5/6" />
          <Skeleton className="h-3.5 w-4/6" />
        </div>
      ) : !week ? (
        <WidgetEmpty>The weekly digest lands here after the next nightly consolidation run.</WidgetEmpty>
      ) : (
        <div className="max-h-[300px] space-y-sm overflow-y-auto pr-xs">
          {blocks.map((block, i) => {
            if (block.kind === 'heading') {
              return (
                <p key={i} className="pt-xs text-caption-medium text-ink first:pt-0">
                  <InlineText text={block.text} />
                </p>
              )
            }
            if (block.kind === 'para') {
              return (
                <p key={i} className="text-caption leading-relaxed text-ink2">
                  <InlineText text={block.text} />
                </p>
              )
            }
            return (
              <ul key={i} className="space-y-xs">
                {block.items.map((item, j) => (
                  <li key={j} className="flex gap-xs text-caption leading-relaxed text-ink2">
                    <span aria-hidden="true" className="text-ink3">·</span>
                    <InlineText text={item} />
                  </li>
                ))}
              </ul>
            )
          })}
        </div>
      )}
    </WidgetCard>
  )
}
