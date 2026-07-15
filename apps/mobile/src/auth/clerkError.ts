/**
 * Pull the most human-readable message out of a Clerk error, falling back to a
 * caller-supplied default. Clerk throws objects shaped like
 * `{ errors: [{ longMessage, message, code }] }`.
 */
export function clerkErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const e = err as {
      errors?: { longMessage?: string; message?: string; code?: string }[];
      message?: string;
    };
    const first = e.errors?.[0];
    if (first?.longMessage) return first.longMessage;
    if (first?.message) return first.message;
    if (e.message) return e.message;
  }
  return fallback;
}
