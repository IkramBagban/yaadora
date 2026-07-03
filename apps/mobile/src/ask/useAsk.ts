import { useCallback, useEffect, useRef, useState } from 'react';
import { streamAsk } from '../api/sse';
import type { AskMode, Citation } from '../api/types';

export type AskStatus = 'idle' | 'streaming' | 'done' | 'error';

export interface AskState {
  status: AskStatus;
  question: string;
  text: string;
  citations: Citation[];
  confidence: number | null;
  mode: AskMode | null;
  error: string | null;
}

const INITIAL: AskState = {
  status: 'idle',
  question: '',
  text: '',
  citations: [],
  confidence: null,
  mode: null,
  error: null,
};

/**
 * Streaming state machine for /ask: idle → streaming → done | error.
 * Each ask is fresh — the memory store is the history, not this hook.
 */
export function useAsk() {
  const [state, setState] = useState<AskState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ ...INITIAL, status: 'streaming', question: q });

    try {
      await streamAsk(
        q,
        (event) => {
          if (controller.signal.aborted) return;
          if (event.type === 'token') {
            setState((s) => ({ ...s, text: s.text + event.text }));
          } else if (event.type === 'done') {
            setState((s) => ({
              ...s,
              status: 'done',
              citations: event.citations ?? [],
              confidence: event.confidence,
              mode: event.mode,
            }));
          } else {
            setState((s) => ({ ...s, status: 'error', error: event.message }));
          }
        },
        controller.signal,
      );
      // Stream ended without a done frame (e.g. server closed early): settle.
      setState((s) => (s.status === 'streaming' ? { ...s, status: 'done' } : s));
    } catch (err) {
      if (controller.signal.aborted) return;
      setState((s) => ({
        ...s,
        status: 'error',
        error: err instanceof Error ? err.message : 'Something went wrong.',
      }));
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((s) =>
      s.status === 'streaming' ? { ...s, status: s.text ? 'done' : 'idle' } : s,
    );
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL);
  }, []);

  return { ...state, ask, cancel, reset };
}
