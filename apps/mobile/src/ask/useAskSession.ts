import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { streamConversationTurn } from '../api/sse';
import type {
  AskMode,
  AskStep,
  Citation,
  ReminderSuggestion,
} from '../api/types';
import { newClientId } from '../lib/ids';

export type ExchangeStatus = 'streaming' | 'done' | 'error';

export interface Exchange {
  id: string;
  question: string;
  text: string;
  /** the reasoning trace (accumulates live, finalised on done) */
  steps: AskStep[];
  /** most recent step — drives the shimmering thinking line before the answer */
  liveStep: AskStep | null;
  citations: Citation[];
  confidence: number | null;
  mode: AskMode | null;
  clarifyOptions: string[];
  status: ExchangeStatus;
  error: string | null;
  /** A reminder the server proposed for this turn (one-tap chip). Null if none. */
  reminderSuggestion: ReminderSuggestion | null;
  /** Proactive nudge woven this turn — receipt affordance (P2). */
  surfacingId: string | null;
  evidence: string[];
}

function makeExchange(question: string): Exchange {
  return {
    id: newClientId(),
    question,
    text: '',
    steps: [],
    liveStep: null,
    citations: [],
    confidence: null,
    mode: null,
    clarifyOptions: [],
    status: 'streaming',
    error: null,
    reminderSuggestion: null,
    surfacingId: null,
    evidence: [],
  };
}

/**
 * Durable Ask session (spec 02 §2.1, P0 item 2).
 *
 * Holds an in-memory list of exchanges for the UI and sends each turn with a
 * server-side `conversationId`. Transcript history is loaded on the server —
 * the client no longer replays prior turns.
 */
export function useAskSession() {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const exchangesRef = useRef<Exchange[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  /** Server conversation id for this session; created lazily on first send. */
  const conversationIdRef = useRef<string | null>(null);
  /** Serializes creates so concurrent first-sends share one conversation. */
  const ensureConvoRef = useRef<Promise<string> | null>(null);

  exchangesRef.current = exchanges;

  useEffect(() => () => abortRef.current?.abort(), []);

  const patch = useCallback(
    (id: string, update: Partial<Exchange> | ((e: Exchange) => Partial<Exchange>)) => {
      setExchanges((list) =>
        list.map((e) =>
          e.id === id
            ? { ...e, ...(typeof update === 'function' ? update(e) : update) }
            : e,
        ),
      );
    },
    [],
  );

  const ensureConversation = useCallback(async (): Promise<string> => {
    if (conversationIdRef.current) return conversationIdRef.current;
    if (ensureConvoRef.current) return ensureConvoRef.current;

    ensureConvoRef.current = (async () => {
      const created = await api.createConversation();
      conversationIdRef.current = created.id;
      return created.id;
    })();

    try {
      return await ensureConvoRef.current;
    } finally {
      ensureConvoRef.current = null;
    }
  }, []);

  const run = useCallback(
    async (exchangeId: string, question: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const conversationId = await ensureConversation();
        if (controller.signal.aborted) return;

        await streamConversationTurn(
          conversationId,
          question,
          (event) => {
            if (controller.signal.aborted) return;
            if (event.type === 'step') {
              const step: AskStep = {
                kind: event.kind,
                label: event.label,
                query: event.query,
                count: event.count,
              };
              patch(exchangeId, (e) => ({
                liveStep: step,
                steps: [...e.steps, step],
              }));
            } else if (event.type === 'token') {
              patch(exchangeId, (e) => ({ text: e.text + event.text }));
            } else if (event.type === 'done') {
              patch(exchangeId, {
                status: 'done',
                citations: event.citations ?? [],
                confidence: event.confidence,
                mode: event.mode,
                steps: event.steps ?? [],
                clarifyOptions: event.clarifyOptions ?? [],
                liveStep: null,
                surfacingId: event.surfacingId ?? null,
                evidence: event.evidence ?? [],
              });
            } else if (event.type === 'reminder_suggestion') {
              patch(exchangeId, {
                reminderSuggestion: {
                  text: event.text,
                  dueAt: event.dueAt,
                  sourceMemoryId: event.sourceMemoryId,
                },
              });
            } else if (event.type === 'captured') {
              // A memory was quietly captured from this turn — nothing to render.
            } else if (event.type === 'error') {
              patch(exchangeId, (e) => ({
                status: 'error',
                error: event.message,
                liveStep: null,
                text: e.text,
              }));
            }
          },
          controller.signal,
        );
        // Stream ended without a done frame: settle gracefully.
        patch(exchangeId, (e) =>
          e.status === 'streaming' ? { status: 'done', liveStep: null } : {},
        );
      } catch (err) {
        if (controller.signal.aborted) return;
        patch(exchangeId, (e) => ({
          status: e.text ? 'done' : 'error',
          liveStep: null,
          error: err instanceof Error ? err.message : 'Something went wrong.',
        }));
      }
    },
    [ensureConversation, patch],
  );

  const send = useCallback(
    (raw: string) => {
      const question = raw.trim();
      if (!question) return;
      const exchange = makeExchange(question);
      setExchanges((list) => [...list, exchange]);
      void run(exchange.id, question);
    },
    [run],
  );

  /** Re-run a failed / interrupted exchange against the same conversation. */
  const retry = useCallback(
    (id: string) => {
      const list = exchangesRef.current;
      const idx = list.findIndex((e) => e.id === id);
      if (idx === -1) return;
      const question = list[idx]!.question;
      patch(id, {
        text: '',
        steps: [],
        liveStep: null,
        citations: [],
        confidence: null,
        mode: null,
        clarifyOptions: [],
        status: 'streaming',
        error: null,
        reminderSuggestion: null,
        surfacingId: null,
        evidence: [],
      });
      void run(id, question);
    },
    [patch, run],
  );

  /** Stop the live stream; keep whatever partial text arrived. */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setExchanges((list) =>
      list.map((e) =>
        e.status === 'streaming'
          ? { ...e, status: e.text ? 'done' : 'error', liveStep: null }
          : e,
      ),
    );
  }, []);

  /** Clear the session back to idle and start a fresh conversation next send. */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    conversationIdRef.current = null;
    ensureConvoRef.current = null;
    setExchanges([]);
  }, []);

  const streaming = exchanges.some((e) => e.status === 'streaming');

  return {
    exchanges,
    streaming,
    send,
    retry,
    cancel,
    reset,
    conversationId: conversationIdRef.current,
  };
}
