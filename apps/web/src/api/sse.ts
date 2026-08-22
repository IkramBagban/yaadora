import { API_URL } from '../lib/env';
import { ApiError, authHeaders } from './client';

/**
 * POST a JSON body to `path` and consume the SSE stream it responds with.
 * Ported from apps/mobile/src/api/sse.ts. Frames are `data: <json>\n\n`;
 * malformed frames are skipped. Resolves when the stream ends; rejects with
 * ApiError on transport failure. Aborting the signal stops silently.
 */
export async function streamRequest<TEvent>(
  path: string,
  body: unknown,
  onEvent: (event: TEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const auth = await authHeaders();
  if (!auth.authorization) {
    throw new ApiError('Sign in to continue.', 'unauthorized', 401);
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...auth },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    if (signal.aborted) return;
    throw new ApiError("Can't reach the server right now.", 'network');
  }

  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    let code = 'http_error';
    try {
      const errorBody = (await res.json()) as { error?: { code?: string; message?: string } };
      if (errorBody.error?.message) message = errorBody.error.message;
      if (errorBody.error?.code) code = errorBody.error.code;
    } catch {
      // keep defaults
    }
    throw new ApiError(message, code, res.status);
  }

  if (!res.body) throw new ApiError('The server sent an empty response.', 'empty_body');

  const reader = res.body.getReader();
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
          onEvent(JSON.parse(payload) as TEvent);
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
  } catch {
    if (!signal.aborted) {
      throw new ApiError('The connection was interrupted.', 'stream_interrupted');
    }
  }
}
