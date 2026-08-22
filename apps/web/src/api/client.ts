import { API_URL } from '../lib/env';

type TokenGetter = () => Promise<string | null | undefined>;

let tokenGetter: TokenGetter = async () => null;

/**
 * Wire the Clerk session token into the (non-React) fetch layer.
 * Called once from AuthBridge, which lives inside <ClerkProvider>.
 */
export function setTokenGetter(getter: TokenGetter): void {
  tokenGetter = getter;
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await tokenGetter();
  return token ? { authorization: `Bearer ${token}` } : {};
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(message: string, code: string, status: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }

  get retryable(): boolean {
    return this.status === null || this.status >= 500;
  }
}

export interface RequestOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
}

async function throwFromResponse(res: Response): Promise<never> {
  let message = `Request failed (${res.status}).`;
  let code = 'http_error';
  try {
    const body = (await res.json()) as ErrorEnvelope;
    if (body.error?.message) message = body.error.message;
    if (body.error?.code) code = body.error.code;
  } catch {
    // non-JSON error body; keep defaults
  }
  throw new ApiError(message, code, res.status);
}

export async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const auth = await authHeaders();

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...auth, ...init.headers },
    });
  } catch {
    throw new ApiError("Can't reach the server right now.", 'network');
  }

  if (!res.ok) return throwFromResponse(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
