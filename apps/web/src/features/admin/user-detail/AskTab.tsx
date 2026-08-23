import { useState } from 'react'
import { BookOpen, MessageCircle, Search, ShieldCheck } from 'lucide-react'
import { useAdminConversationTurns, useAdminUserConversations } from '../api'
import { parseToolTrace } from '../lib'
import { AdminOnlyNotice, Panel } from '../ui'
import { Badge } from '../../../components/ui/Badge'
import { Spinner } from '../../../components/ui/Spinner'
import { isForbidden } from '../lib'
import { cn } from '../../../lib/cn'
import { formatRelative, formatDateTime } from '../../../lib/format'

/**
 * Ask tab — read-only thread viewer. Conversation list on the left (first
 * conversation preselected); the selected thread renders turn-by-turn with
 * tool-trace chips extracted from each turn's opaque meta JSON.
 */

export function AskTab({ userId }: { userId: string }) {
  const conversations = useAdminUserConversations(userId)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const items = conversations.data?.items ?? []
  // Derived preselection: first conversation until the admin picks one —
  // no effect needed, so no cascading renders.
  const selectedId = pickedId ?? items[0]?.id ?? null

  const turns = useAdminConversationTurns(userId, selectedId)

  if (conversations.isError && isForbidden(conversations.error)) {
    return <AdminOnlyNotice />
  }

  return (
    <div className="grid items-start gap-lg lg:grid-cols-[280px_minmax(0,1fr)]">
      <Panel
        title="Conversations"
        flush
        loading={conversations.isPending}
        error={conversations.isError}
        onRetry={() => void conversations.refetch()}
        isEmpty={items.length === 0}
        emptyMessage="No conversations yet."
      >
        <ul className="max-h-[32rem] overflow-y-auto p-sm">
          {items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setPickedId(c.id)}
                aria-current={c.id === selectedId}
                className={cn(
                  'flex w-full flex-col gap-0.5 rounded-md px-md py-sm text-left transition-colors',
                  c.id === selectedId ? 'bg-accent-soft' : 'hover:bg-surface-alt',
                )}
              >
                <span
                  className={cn(
                    'line-clamp-2 text-caption text-ink',
                    c.id === selectedId && 'text-accent',
                  )}
                >
                  {c.summarySnippet?.trim() ||
                    `Conversation · ${c.turnCount} turn${c.turnCount === 1 ? '' : 's'}`}
                </span>
                <span className="flex items-center gap-xs text-micro text-ink3">
                  <MessageCircle size={11} aria-hidden="true" />
                  {formatRelative(c.startedAt)} · {c.turnCount} turns · {c.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <ThreadViewer conversationId={selectedId} turnsQuery={turns} />
    </div>
  )
}

interface TurnRow {
  role: string
  content: string
  meta: unknown
  createdAt: string
}

function ThreadViewer({
  conversationId,
  turnsQuery,
}: {
  conversationId: string | null
  turnsQuery: ReturnType<typeof useAdminConversationTurns>
}) {
  if (conversationId === null) {
    return (
      <Panel title="Thread">
        <p className="text-caption text-ink3">Select a conversation to read its thread.</p>
      </Panel>
    )
  }
  if (turnsQuery.isPending) {
    return (
      <Panel title="Thread">
        <div className="flex justify-center py-xl">
          <Spinner />
        </div>
      </Panel>
    )
  }
  if (turnsQuery.isError) {
    return (
      <Panel
        title="Thread"
        error={turnsQuery.error}
        onRetry={() => void turnsQuery.refetch()}
      >
        <span />
      </Panel>
    )
  }
  const turns: TurnRow[] = turnsQuery.data?.turns ?? []
  return (
    <Panel
      title={`Thread · ${turns.length} turn${turns.length === 1 ? '' : 's'}`}
      description={`Started ${turns.length > 0 ? formatDateTime(turns[0]!.createdAt) : ''}`}
      action={
        turnsQuery.isFetching ? <Spinner size={14} /> : undefined
      }
    >
      <ol className="flex flex-col gap-lg">
        {turns.map((t, i) => (
          <li key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <TurnBubble turn={t} />
          </li>
        ))}
      </ol>
    </Panel>
  )
}

function TurnBubble({ turn }: { turn: TurnRow }) {
  const trace = parseToolTrace(turn.meta)
  const hasTrace =
    trace.searches.length > 0 || trace.citationCount > 0 || trace.rulesApplied.length > 0

  return (
    <div
      className={cn(
        'max-w-prose rounded-lg border px-lg py-md',
        turn.role === 'user'
          ? 'border-hairline bg-surface-alt'
          : 'border-accent-soft bg-accent-soft/50',
      )}
    >
      <p className="mb-xs flex items-center gap-xs text-micro uppercase tracking-wide text-ink3">
        {turn.role === 'user' ? 'User' : 'Assistant'} · {formatDateTime(turn.createdAt)}
      </p>
      <p className="whitespace-pre-wrap text-sub text-ink">{turn.content}</p>
      {hasTrace ? (
        <div className="mt-md flex flex-wrap gap-xs border-t border-hairline pt-md">
          {trace.searches.map((q) => (
            <Badge key={`s-${q}`} tone="neutral">
              <Search size={10} aria-hidden="true" className="mr-1" />
              {q}
            </Badge>
          ))}
          {trace.citationCount > 0 ? (
            <Badge tone="accent">
              <BookOpen size={10} aria-hidden="true" className="mr-1" />
              {trace.citationCount} citation{trace.citationCount === 1 ? '' : 's'}
            </Badge>
          ) : null}
          {trace.rulesApplied.map((r) => (
            <Badge key={`r-${r}`} tone="pending">
              <ShieldCheck size={10} aria-hidden="true" className="mr-1" />
              rule: {r}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}
