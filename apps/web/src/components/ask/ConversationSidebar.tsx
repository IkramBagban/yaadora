import { Plus } from 'lucide-react'
import type { ConversationSummary } from '../../api/types'
import { formatRelativeTime } from '../../lib/format'
import { cn } from '../../lib/cn'

interface ConversationSidebarProps {
  conversations: ConversationSummary[]
  isLoading: boolean
  /** null = the fresh, not-yet-created "New conversation" slot */
  activeId: string | null
  onSelect: (id: string | null) => void
}

function SidebarSkeleton() {
  return (
    <div className="flex flex-col gap-sm" aria-hidden>
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-14 animate-pulse rounded-md bg-surface-alt" />
      ))}
    </div>
  )
}

/**
 * Conversation list for the Ask page. "New conversation" is a virtual slot —
 * the server row is only created on the first send, so the list never fills
 * with empty conversations.
 */
export function ConversationSidebar({
  conversations,
  isLoading,
  activeId,
  onSelect,
}: ConversationSidebarProps) {
  return (
    <div className="flex h-full w-64 shrink-0 flex-col gap-sm overflow-hidden rounded-lg border border-hairline bg-surface p-sm">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(
          'flex h-10 shrink-0 items-center gap-sm rounded-md px-md text-sub font-medium transition-colors',
          activeId === null
            ? 'bg-accent-soft text-accent'
            : 'text-ink2 hover:bg-surface-alt hover:text-ink',
        )}
      >
        <Plus size={16} />
        New conversation
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <SidebarSkeleton />
        ) : conversations.length === 0 ? (
          <p className="px-md py-lg text-caption text-ink3">
            Past conversations will appear here once you ask something.
          </p>
        ) : (
          <ul className="flex flex-col gap-xs">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  aria-current={conversation.id === activeId}
                  className={cn(
                    'flex w-full flex-col gap-[2px] rounded-md px-md py-sm text-left transition-colors',
                    conversation.id === activeId
                      ? 'bg-accent-soft'
                      : 'hover:bg-surface-alt',
                  )}
                >
                  <span
                    className={cn(
                      'line-clamp-2 text-caption text-ink',
                      conversation.id === activeId && 'text-accent',
                    )}
                  >
                    {conversation.summary?.trim() ||
                      `Conversation · ${conversation.turnCount} turn${conversation.turnCount === 1 ? '' : 's'}`}
                  </span>                  <span className="text-micro text-ink3">
                    {formatRelativeTime(conversation.lastTurnAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
