import { API_URL } from './config';
import { getAuthToken } from './token';
import { createMobileLogger } from '../lib/log';
import type {
  CreatedMemory,
  MemoryDetail,
  MemoryPage,
  MemorySource,
  Recurrence,
  Reminder,
  ReminderList,
  ReminderScope,
} from './types';

const log = createMobileLogger('api');
const TIMEOUT_MS = 8000;

export interface ApiErrorDetails {
  url: string;
  method: string;
  status: number | null;
  code: string;
  originalError?: string;
  responseBody?: unknown;
  durationMs: number;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly details: ApiErrorDetails | null;

  constructor(message: string, code: string, status: number | null = null, details: ApiErrorDetails | null = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** Network failures and 5xx are worth retrying; 4xx means the request itself is wrong. */
  get retryable(): boolean {
    return this.status === null || this.status >= 500;
  }
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  if (!token) {
    log.debug('authHeaders: no session token');
    return {};
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
  };
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) headers['x-timezone'] = tz;
  } catch {
    // ignore
  }
  log.debug('authHeaders: attached token', {
    token: log.tokenSummary(token),
    timezone: headers['x-timezone'] ?? null,
  });
  return headers;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const started = Date.now();

  const auth = await authHeaders();
  if (!auth.authorization) {
    log.warn('request blocked: not signed in', { method, path, apiUrl: API_URL });
    throw new ApiError('Sign in to continue.', 'unauthorized', 401);
  }

  log.info('request start', { method, path, apiUrl: API_URL });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...auth,
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const ms = Date.now() - started;
    const originalError = err instanceof Error ? err.message : String(err);
    log.error('request network failure', {
      method,
      path,
      apiUrl: API_URL,
      ms,
      message: originalError,
    });
    throw new ApiError("Can't reach your memories right now.", 'network', null, {
      url: `${API_URL}${path}`,
      method,
      status: null,
      code: 'network',
      originalError,
      durationMs: ms,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    let code = 'http_error';
    let responseBody: unknown = null;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      responseBody = body;
      if (body.error?.message) message = body.error.message;
      if (body.error?.code) code = body.error.code;
    } catch {
      // non-JSON error body; keep defaults
    }
    const ms = Date.now() - started;
    log.warn('request failed', {
      method,
      path,
      status: res.status,
      code,
      message,
      ms,
    });
    throw new ApiError(message, code, res.status, {
      url: `${API_URL}${path}`,
      method,
      status: res.status,
      code,
      responseBody,
      durationMs: ms,
    });
  }

  log.info('request ok', {
    method,
    path,
    status: res.status,
    ms: Date.now() - started,
  });

  return (await res.json()) as T;
}

export interface MeProfile {
  id: string;
  email: string;
  timezone: string;
  createdAt: string;
}

export const api = {
  getMe(): Promise<MeProfile> {
    return request<MeProfile>('/me');
  },

  patchMe(input: { timezone: string }): Promise<MeProfile> {
    return request<MeProfile>('/me', {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  createMemory(input: {
    rawText: string;
    clientId?: string;
    source?: MemorySource;
    occurredHint?: string;
  }): Promise<CreatedMemory> {
    return request<CreatedMemory>('/memories', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  listMemories(params: { cursor?: string; limit?: number } = {}): Promise<MemoryPage> {
    const q = new URLSearchParams();
    if (params.cursor) q.set('cursor', params.cursor);
    if (params.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return request<MemoryPage>(`/memories${qs ? `?${qs}` : ''}`);
  },

  getMemory(id: string): Promise<MemoryDetail> {
    return request<MemoryDetail>(`/memories/${encodeURIComponent(id)}`);
  },

  // --- reminders -----------------------------------------------------------

  listReminders(scope: ReminderScope = 'upcoming'): Promise<ReminderList> {
    return request<ReminderList>(`/reminders?scope=${scope}`);
  },

  /** Save a reminder directly (e.g. from the live Ask chip). */
  confirmReminder(input: {
    text: string;
    dueAt: string;
    sourceMemoryId?: string;
    origin?: 'suggested' | 'manual';
    recurrence?: Recurrence;
    weekdays?: number[] | null;
  }): Promise<Reminder> {
    return request<Reminder>('/reminders/confirm', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  /** Create a reminder manually from the UI (origin=manual, immediately pending). */
  createReminder(input: {
    text: string;
    dueAt: string;
    recurrence?: Recurrence;
    weekdays?: number[] | null;
  }): Promise<Reminder> {
    return request<Reminder>('/reminders/confirm', {
      method: 'POST',
      body: JSON.stringify({ ...input, origin: 'manual' }),
    });
  },

  /** Edit an existing reminder (text, time, and/or recurrence). */
  updateReminder(
    id: string,
    patch: {
      text?: string;
      dueAt?: string;
      status?: 'pending' | 'done' | 'dismissed';
      recurrence?: Recurrence;
      weekdays?: number[] | null;
    },
  ): Promise<Reminder> {
    return request<Reminder>(`/reminders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  /** Accept a stored suggestion: promote 'suggested' → 'pending'. */
  acceptSuggestion(id: string): Promise<Reminder> {
    return request<Reminder>(`/reminders/${encodeURIComponent(id)}/confirm`, {
      method: 'POST',
    });
  },

  completeReminder(id: string): Promise<{ id: string; status: string }> {
    return request(`/reminders/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
    });
  },

  /** Cancel / dismiss (also used for undo). */
  cancelReminder(id: string): Promise<{ id: string; status: string }> {
    return request(`/reminders/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};
