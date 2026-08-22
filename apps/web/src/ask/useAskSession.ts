import { useCallback, useEffect, useRef, useState } from 'react'
import { request } from '../api/client'
import { streamRequest } from '../api/sse'
import type {
  AskEvent,
  AskMode,
  AskStep,
  Citation,
  ConversationSummary,
  ReminderSuggestion,
} from '../api/types'

export type ExchangeStatus = 'streaming' | 'done' | 'stopped' | 'error'

export interface Exchange {
  id: string
  question: string
  text: string
  /** the reasoning trace (accumulates live, finalised on done) */
  steps: AskStep[]
  citations: Citation[]
  confidence: number | null
  mode: AskMode | null
  clarifyOptions: string[]
  status: ExchangeStatus
  error: string | null
  /** true when the stream dropped mid-answer; partial text is kept */
  interrupted: boolean
  /** a reminder the server proposed for this turn (one-tap chip) */
  reminderSuggestion: ReminderSuggestion | null
  /** proactive nudge woven this turn — receipt affordance */
  surfacingId: string | null
  evidence: string[]
}

export interface CapturedFrame {
  memoryId: string
  statement: string
}

interface AskSessionOptions {
  /** called when a `captured` frame arrives (dedup upstream) */
  onCaptured?: (frame: CapturedFrame) => void
  /** called with the id of a conversation lazily created on first send */
  onConversationCreated?: (id: string) => void
}

/** Early-drop auto-reconnect attempts before surfacing an error. */
const MAX_AUTO_RETRIES = 2
const RETRY_BASE_DELAY_MS = 800

function makeExchange(question: string): Exchange {
  return {
    id: crypto.randomUUID(),
    question,
    text: '',
    steps: [],
    citations: [],
    confidence: null,
    mode: null,
    clarifyOptions: [],
    status: 'streaming',
    error: null,
    interrupted: false,
    reminderSuggestion: null,
    surfacingId: null,
    evidence: [],
  }
}

/**
 * Durable Ask session for the web. Mirrors apps/mobile/src/ask/useAskSession.ts
 * with two web additions: token frames are coalesced per animation frame (many
 * tokens land between paints — appending one state per token flickers), and a
 * dropped stream reconnects automatically while nothing has streamed yet.
 *
 * Turns are POSTs (the SSE body), so a reconnect re-sends the question and the
 * server keeps both attempts as turns; we only auto-retry the early-drop case
 * where no answer was ever produced. Partial answers settle with an
 * "interrupted" note and a manual retry instead.
 */
export function useAskSession(options: AskSessionOptions = {}) {
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** pending streamed text, flushed to state once per animation frame */
  const tokenBufferRef = useRef('')
  const rafRef = useRef<number | null>(null)
  /** server conversation id; null means "new chat, create on first send" */
  const conversationIdRef = useRef<string | null>(null)
  /** serializes creates so concurrent first-sends share one conversation */
  const ensureConvoRef = useRef<Promise<string> | null>(null)
  const optionsRef = useRef(options)

  // Latest-value refs are written in effects (never during render) so the
  // React Compiler can keep the hook optimizable; async stream callbacks only
  // fire long after effects have flushed.
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  useEffect(() => {
    const abort = abortRef.current
    const timer = retryTimerRef.current
    return () => {
      abort?.abort()
      if (timer) clearTimeout(timer)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const patch = useCallback(
    (id: string, update: Partial<Exchange> | ((e: Exchange) => Partial<Exchange>)) => {
      setExchanges((list) =>
        list.map((e) =>
          e.id === id ? { ...e, ...(typeof update === 'function' ? update(e) : update) } : e,
        ),
      )
    },
    [],
  )

  const flushTokens = useCallback(
    (id: string) => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      const chunk = tokenBufferRef.current
      if (!chunk) return
      tokenBufferRef.current = ''
      patch(id, (e) => ({ text: e.text + chunk }))
    },
    [patch],
  )

  const bufferToken = useCallback(
    (id: string, text: string) => {
      tokenBufferRef.current += text
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          flushTokens(id)
        })
      }
    },
    [flushTokens],
  )

  const ensureConversation = useCallback(async (): Promise<string> => {
    if (conversationIdRef.current) return conversationIdRef.current
    if (ensureConvoRef.current) return ensureConvoRef.current

    ensureConvoRef.current = (async () => {
      const created = await request<ConversationSummary>('/conversations', { method: 'POST' })
      conversationIdRef.current = created.id
      optionsRef.current.onConversationCreated?.(created.id)
      return created.id
    })()

    try {
      return await ensureConvoRef.current
    } finally {
      ensureConvoRef.current = null
    }
  }, [])

  /** breaks the run ↔ scheduleRetry memo cycle; set in an effect below */
  const runRef = useRef<
    ((exchangeId: string, question: string, attempt: number) => Promise<void>) | undefined
  >(undefined)

  const scheduleRetry = useCallback(
    (exchangeId: string, question: string, attempt: number) => {
      patch(exchangeId, { steps: [], text: '' })
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null
        void runRef.current?.(exchangeId, question, attempt + 1)
      }, RETRY_BASE_DELAY_MS * (attempt + 1))
    },
    [patch],
  )

  const run = useCallback(
    async (exchangeId: string, question: string, attempt: number) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      let sawToken = false
      let settled = false

      // Replacing the controller supersedes any exchange still streaming
      // under the old one — its run() bails on the aborted signal without
      // settling. Settle those here (partial text keeps what arrived,
      // otherwise the turn reads as stopped), or a retry / quick reply fired
      // mid-stream leaves a phantom 'streaming' exchange and the composer
      // stuck on Stop.
      setExchanges((list) =>
        list.map((e) =>
          e.id !== exchangeId && e.status === 'streaming'
            ? { ...e, status: e.text ? 'done' : 'stopped', interrupted: Boolean(e.text) }
            : e,
        ),
      )

      try {
        const conversationId = await ensureConversation()
        if (controller.signal.aborted) return

        const handleEvent = (event: AskEvent) => {
          if (controller.signal.aborted) return
          if (event.type === 'step') {
            const step: AskStep = {
              kind: event.kind,
              label: event.label,
              query: event.query,
              count: event.count,
            }
            patch(exchangeId, (e) => ({ steps: [...e.steps, step] }))
          } else if (event.type === 'token') {
            sawToken = true
            bufferToken(exchangeId, event.text)
          } else if (event.type === 'done') {
            settled = true
            flushTokens(exchangeId)
            patch(exchangeId, {
              status: 'done',
              citations: event.citations ?? [],
              confidence: event.confidence,
              mode: event.mode,
              steps: event.steps ?? [],
              clarifyOptions: event.clarifyOptions ?? [],
              surfacingId: event.surfacingId ?? null,
              evidence: event.evidence ?? [],
            })
          } else if (event.type === 'captured') {
            optionsRef.current.onCaptured?.({
              memoryId: event.memoryId,
              statement: event.statement,
            })
          } else if (event.type === 'reminder_suggestion') {
            patch(exchangeId, {
              reminderSuggestion: {
                text: event.text,
                dueAt: event.dueAt,
                sourceMemoryId: event.sourceMemoryId,
              },
            })
          } else if (event.type === 'error') {
            settled = true
            flushTokens(exchangeId)
            patch(exchangeId, (e) => ({
              status: e.text ? 'done' : 'error',
              interrupted: Boolean(e.text),
              error: event.message,
            }))
          }
        }

        await streamRequest<AskEvent>(
          `/conversations/${conversationId}/turns`,
          { question },
          handleEvent,
          controller.signal,
        )

        // Stream ended: a done/error frame already settled the exchange.
        flushTokens(exchangeId)
        if (controller.signal.aborted || settled) return

        // Ended without a done frame — treat as a drop.
        if (!sawToken && attempt < MAX_AUTO_RETRIES) {
          scheduleRetry(exchangeId, question, attempt)
        } else {
          patch(exchangeId, (e) => ({
            status: e.text ? 'done' : 'error',
            interrupted: true,
            error: e.text ? null : 'The connection was interrupted.',
          }))
        }
      } catch (err) {
        if (controller.signal.aborted) return
        flushTokens(exchangeId)
        if (settled) return

        if (!sawToken && attempt < MAX_AUTO_RETRIES) {
          scheduleRetry(exchangeId, question, attempt)
          return
        }
        patch(exchangeId, (e) => ({
          status: e.text ? 'done' : 'error',
          interrupted: sawToken,
          error:
            err instanceof Error && err.message ? err.message : 'Something went wrong.',
        }))
      }
    },
    [bufferToken, ensureConversation, flushTokens, patch, scheduleRetry],
  )

  useEffect(() => {
    runRef.current = run
  }, [run])

  const send = useCallback(
    (raw: string) => {
      const question = raw.trim()
      if (!question) return
      const exchange = makeExchange(question)
      setExchanges((list) => [...list, exchange])
      void run(exchange.id, question, 0)
    },
    [run],
  )

  /** Re-run a failed / interrupted exchange against the same conversation. */
  const retry = useCallback(
    (id: string, question: string) => {
      patch(id, {
        text: '',
        steps: [],
        citations: [],
        confidence: null,
        mode: null,
        clarifyOptions: [],
        status: 'streaming',
        error: null,
        interrupted: false,
        reminderSuggestion: null,
        surfacingId: null,
        evidence: [],
      })
      void run(id, question, 0)
    },
    [patch, run],
  )

  /** Stop the live stream; keep whatever partial text arrived. */
  const stop = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    abortRef.current?.abort()
    abortRef.current = null
    setExchanges((list) =>
      list.map((e) =>
        e.status === 'streaming'
          ? { ...e, status: e.text ? 'done' : 'stopped', interrupted: Boolean(e.text) }
          : e,
      ),
    )
  }, [])

  /**
   * Point the session at an existing conversation (sidebar selection) or a
   * fresh one (null — created lazily on the next send). Clears the thread.
   */
  const setConversation = useCallback((id: string | null) => {
    abortRef.current?.abort()
    abortRef.current = null
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    conversationIdRef.current = id
    ensureConvoRef.current = null
    setExchanges([])
  }, [])

  const streaming = exchanges.some((e) => e.status === 'streaming')

  return {
    exchanges,
    streaming,
    send,
    retry,
    stop,
    setConversation,
  }
}
