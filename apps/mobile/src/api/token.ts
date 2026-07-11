/**
 * Token getter registry — bridges Clerk's React `getToken` into non-React
 * modules (API client, SSE, outbox flush).
 */

type TokenGetter = () => Promise<string | null>;

let getter: TokenGetter | null = null;

export function setAuthTokenGetter(fn: TokenGetter | null): void {
  getter = fn;
}

export async function getAuthToken(): Promise<string | null> {
  if (!getter) return null;
  try {
    return await getter();
  } catch {
    return null;
  }
}
