import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { History, X } from 'lucide-react'
import { useAskSession, type Exchange } from './useAskSession'
import { useConversations } from './useConversations'
import { AskThread } from '../components/ask/AskThread'
import { Composer } from '../components/ask/Composer'
import { ConversationSidebar } from '../components/ask/ConversationSidebar'
import { MemoryDrawer, type DrawerEntry } from '../components/ask/MemoryDrawer'
import { Toasts, type Toast } from '../components/ask/Toasts'

const TOAST_MS = 4500

interface DrawerState {
  open: boolean
  title: string
  entries: DrawerEntry[]
  focusId: string | null
}

const CLOSED_DRAWER: DrawerState = { open: false, title: '', entries: [], focusId: null }

/**
 * Ask page: conversation sidebar + streaming thread + composer, with the
 * source drawer and toasts layered on top. Conversation rows are owned by the
 * server; a "new" chat only becomes one on first send.
 */
export function AskPage() {
  const queryClient = useQueryClient()
  const conversationsQuery = useConversations()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [drawer, setDrawer] = useState<DrawerState>(CLOSED_DRAWER)
  const [conversationsOpen, setConversationsOpen] = useState(false)

  /** dedupe keys for currently-visible toasts (captured memoryIds) */
  const toastKeysRef = useRef(new Set<string>())
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
    }
  }, [])

  const addToast = useCallback((toast: Omit<Toast, 'toastId'>, dedupeKey?: string) => {
    if (dedupeKey) {
      if (toastKeysRef.current.has(dedupeKey)) return
      toastKeysRef.current.add(dedupeKey)
    }
    const toastId = crypto.randomUUID()
    setToasts((list) => [...list, { ...toast, toastId }])
    timersRef.current.set(
      toastId,
      setTimeout(() => {
        setToasts((list) => list.filter((t) => t.toastId !== toastId))
        timersRef.current.delete(toastId)
        if (dedupeKey) toastKeysRef.current.delete(dedupeKey)
      }, TOAST_MS),
    )
  }, [])

  const session = useAskSession({
    onCaptured: (frame) => addToast({ tone: 'saved', message: frame.statement }, frame.memoryId),
    onConversationCreated: (id) => {
      setActiveId(id)
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  const selectConversation = useCallback(
    (id: string | null) => {
      setActiveId(id)
      setConversationsOpen(false)
      session.setConversation(id)
    },
    [session],
  )

  const openCitations = useCallback((exchange: Exchange, focusMemoryId?: string) => {
    setDrawer({
      open: true,
      title: 'Sources for this answer',
      entries: exchange.citations.map((c) => ({
        memoryId: c.memoryId,
        snippet: c.snippet,
        occurredAt: c.occurredAt,
      })),
      focusId: focusMemoryId ?? null,
    })
  }, [])

  const openEvidence = useCallback((memoryIds: string[]) => {
    setDrawer({
      open: true,
      title: 'Nudge evidence',
      entries: memoryIds.map((id) => ({ memoryId: id })),
      focusId: null,
    })
  }, [])

  const activeConversation =
    conversationsQuery.data?.find((conversation) => conversation.id === activeId) ?? null

  const sidebar = (
    <ConversationSidebar
      conversations={conversationsQuery.data ?? []}
      isLoading={conversationsQuery.isLoading}
      activeId={activeId}
      onSelect={selectConversation}
    />
  )

  return (
    <div className="flex h-[calc(100dvh-5rem)] gap-lg md:h-[calc(100dvh-6.5rem)]">
      <aside className="hidden lg:flex">{sidebar}</aside>

      <div className="flex min-w-0 flex-1 flex-col gap-md">
        <button
          type="button"
          onClick={() => setConversationsOpen(true)}
          className="flex h-8 w-fit items-center gap-xs rounded-pill border border-hairline bg-surface-alt px-md text-caption-medium text-ink2 transition-colors hover:text-ink lg:hidden"
        >
          <History size={13} />
          Conversations
        </button>

        <AskThread
          exchanges={session.exchanges}
          conversation={activeConversation}
          onRetry={session.retry}
          onQuickReply={session.send}
          onOpenCitations={openCitations}
          onShowEvidence={openEvidence}
          onStarterPick={setDraft}
        />

        <Composer
          streaming={session.streaming}
          draft={draft}
          onDraftChange={setDraft}
          onSend={session.send}
          onStop={session.stop}
          onNotice={(message) => addToast({ tone: 'error', message })}
        />
      </div>

      {conversationsOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Conversations"
        >
          <button
            type="button"
            aria-label="Close conversations"
            onClick={() => setConversationsOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute inset-y-0 left-0 flex flex-col p-sm">
            <button
              type="button"
              aria-label="Close conversations"
              onClick={() => setConversationsOpen(false)}
              className="mb-xs self-end rounded-sm p-xs text-ink2 hover:text-ink"
            >
              <X size={18} />
            </button>
            <div className="min-h-0 flex-1">{sidebar}</div>
          </div>
        </div>
      )}

      <MemoryDrawer
        open={drawer.open}
        title={drawer.title}
        entries={drawer.entries}
        focusId={drawer.focusId}
        onClose={() => setDrawer(CLOSED_DRAWER)}
      />

      <Toasts
        toasts={toasts}
        onDismiss={(toastId) => setToasts((list) => list.filter((t) => t.toastId !== toastId))}
      />
    </div>
  )
}
