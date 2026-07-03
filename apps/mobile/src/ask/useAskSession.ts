import { useCallback, useEffect, useRef, useState } from 'react';
import { streamAsk } from '../api/sse';
import type { AskHistoryTurn, AskMode, AskStep, Citation } from '../api/types';
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
}

/** How many prior transcript messages to replay to the stateless server. */
const HISTORY_TURNS = 6;

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
  };
}

/**
 * The ephemeral Ask conversation. Holds an in-memory list of exchanges (the
 * session) and streams each send through /ask, replaying the trimmed transcript
 * so follow-ups resolve. Nothing is persisted — a fresh session each launch.
 */
export function useAskSession() {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const exchangesRef = useRef<Exchange[]>([]);
  const abortRef = useRef<AbortController | null>(null);

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

  /** Build the transcript to replay: all prior completed exchanges, last N msgs. */
  const buildHistory = useCallback((upTo: Exchange[]): AskHistoryTurn[] => {
    const turns: AskHistoryTurn[] = [];
    for (const e of upTo) {
      if (e.status !== 'done' || !e.text.trim()) continue;
      turns.push({ role: 'user', content: e.question });
      turns.push({ role: 'assistant', content: e.text });
    }
    return turns.slice(-HISTORY_TURNS);
  }, []);

  const run = useCallback(
    async (exchangeId: string, question: string, history: AskHistoryTurn[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await streamAsk(
          question,
          history,
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
              });
            } else {
              patch(exchangeId, (e) => ({
                status: 'error',
                error: event.message,
                liveStep: null,
                // keep whatever text streamed so far
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
    [patch],
  );

  const send = useCallback(
    (raw: string) => {
      const question = raw.trim();
      if (!question) return;
      const history = buildHistory(exchangesRef.current);
      const exchange = makeExchange(question);
      setExchanges((list) => [...list, exchange]);
      void run(exchange.id, question, history);
    },
    [buildHistory, run],
  );

  /** Re-run a failed / interrupted exchange, rebuilding history up to it. */
  const retry = useCallback(
    (id: string) => {
      const list = exchangesRef.current;
      const idx = list.findIndex((e) => e.id === id);
      if (idx === -1) return;
      const question = list[idx]!.question;
      const history = buildHistory(list.slice(0, idx));
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
      });
      void run(id, question, history);
    },
    [buildHistory, patch, run],
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

  /** Clear the session back to idle. */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setExchanges([]);
  }, []);

  const streaming = exchanges.some((e) => e.status === 'streaming');

  return { exchanges, streaming, send, retry, cancel, reset };
}
