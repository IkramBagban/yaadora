import { API_URL, AUTH_TOKEN } from './config';
import type {
  CreatedMemory,
  MemoryDetail,
  MemoryPage,
  MemorySource,
  Reminder,
  ReminderList,
  ReminderScope,
} from './types';

const TIMEOUT_MS = 8000;

export class ApiError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(message: string, code: string, status: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }

  /** Network failures and 5xx are worth retrying; 4xx means the request itself is wrong. */
  get retryable(): boolean {
    return this.status === null || this.status >= 500;
  }
}

export function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${AUTH_TOKEN}` };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...authHeaders(),
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: controller.signal,
    });
  } catch {
    throw new ApiError("Can't reach your memories right now.", 'network');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    let code = 'http_error';
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.message) message = body.error.message;
      if (body.error?.code) code = body.error.code;
    } catch {
      // non-JSON error body; keep defaults
    }
    throw new ApiError(message, code, res.status);
  }

  return (await res.json()) as T;
}

export const api = {
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
  }): Promise<Reminder> {
    return request<Reminder>('/reminders/confirm', {
      method: 'POST',
      body: JSON.stringify(input),
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
