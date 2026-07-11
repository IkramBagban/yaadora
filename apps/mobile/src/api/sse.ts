import { fetch as streamingFetch } from 'expo/fetch';
import { API_URL } from './config';
import { ApiError, authHeaders } from './client';
import { createMobileLogger } from '../lib/log';
import type { AskEvent, AskHistoryTurn } from './types';

const log = createMobileLogger('api:ask');

/**
 * POST /ask and consume its SSE stream. Uses expo/fetch, which (unlike RN's
 * global fetch) exposes the response body as a ReadableStream.
 *
 * `history` is the ephemeral in-session transcript replayed for follow-up
 * context; the server stays stateless. Frames are `data: <json>\n\n`; malformed
 * frames are skipped. Resolves when the stream ends; rejects with ApiError on
 * transport failure. Aborting the signal stops silently.
 */
export async function streamAsk(
  question: string,
  history: AskHistoryTurn[],
  onEvent: (event: AskEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const started = Date.now();
  const auth = await authHeaders();
  if (!auth.authorization) {
    log.warn('ask blocked: not signed in');
    throw new ApiError('Sign in to continue.', 'unauthorized', 401);
  }

  log.info('ask stream start', {
    questionLen: question.length,
    historyTurns: history.length,
    apiUrl: API_URL,
  });

  let res: Awaited<ReturnType<typeof streamingFetch>>;
  try {
    res = await streamingFetch(`${API_URL}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ question, history }),
      signal,
    });
  } catch (err) {
    if (signal.aborted) {
      log.info('ask stream aborted by client', { ms: Date.now() - started });
      return;
    }
    if (err instanceof ApiError) throw err;
    log.error('ask network failure', {
      ms: Date.now() - started,
      message: err instanceof Error ? err.message : String(err),
    });
    throw new ApiError("Can't reach your memories right now.", 'network');
  }

  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    let code = 'http_error';
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.message) message = body.error.message;
      if (body.error?.code) code = body.error.code;
    } catch {
      // keep defaults
    }
    log.warn('ask stream http error', {
      status: res.status,
      code,
      message,
      ms: Date.now() - started,
    });
    throw new ApiError(message, code, res.status);
  }

  const body = res.body;
  if (!body) throw new ApiError('The server sent an empty answer.', 'empty_body');

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const drain = () => {
    let idx = buffer.indexOf('\n\n');
    while (idx !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of frame.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;
        try {
          onEvent(JSON.parse(payload) as AskEvent);
        } catch {
          // skip malformed frame
        }
      }
      idx = buffer.indexOf('\n\n');
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      drain();
    }
    buffer += decoder.decode();
    drain();
    log.info('ask stream complete', { ms: Date.now() - started });
  } catch {
    if (!signal.aborted) {
      log.warn('ask stream interrupted', { ms: Date.now() - started });
      throw new ApiError('The connection was interrupted.', 'stream_interrupted');
    }
    log.info('ask stream aborted mid-read', { ms: Date.now() - started });
  }
}
