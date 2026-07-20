/**
 * Shared key-pool helpers for providers configured with a comma-separated list
 * of API keys (e.g. GROQ_API_KEY="key_1,key_2,key_3").
 *
 * Mirrors the LLM key-fallback behaviour in `ai/models.ts`, but the transcription
 * path talks to Groq's REST endpoint directly (the AI SDK's language-model
 * abstraction doesn't cover audio), so the rotation lives here.
 */

/** Split a comma-separated key list into trimmed, non-empty keys. */
export function parseKeys(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

/**
 * True for errors worth retrying on a *different* key: rate limits, exhausted
 * quota, and dead/revoked credentials. A revoked key is permanent for that key
 * but the next one may be fine, so 401/403 rotate too.
 */
export function isKeyExhaustedError(err: unknown): boolean {
  const e = err as { statusCode?: number; status?: number; message?: string };
  const status = e?.statusCode ?? e?.status;
  if (status === 429 || status === 401 || status === 403) return true;

  const msg = String(e?.message ?? err).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("rate-limit") ||
    msg.includes("quota") ||
    msg.includes("resource_exhausted") ||
    msg.includes("too many requests") ||
    msg.includes("invalid api key") ||
    msg.includes("invalid_api_key")
  );
}

export interface KeyPool {
  /** Number of usable keys. 0 means the provider is unconfigured. */
  readonly size: number;
  /**
   * Run `call` against each key in turn, starting from the current cursor.
   * Rotates only on key-exhaustion errors; anything else propagates straight
   * away (a malformed request would fail identically on every key).
   *
   * On success the cursor sticks to the winning key, so a rate-limited key is
   * not retried first on every subsequent request.
   */
  run<T>(call: (apiKey: string, index: number) => Promise<T>): Promise<T>;
}

export class AllKeysExhaustedError extends Error {
  override readonly cause: unknown;
  constructor(attempted: number, cause: unknown) {
    super(
      `All ${attempted} API key(s) are rate-limited or invalid. Last error: ${
        (cause as Error)?.message ?? String(cause)
      }`,
    );
    this.name = "AllKeysExhaustedError";
    this.cause = cause;
  }
}

/**
 * Build a round-robin pool over a comma-separated key list.
 *
 * @param onRotate optional hook for logging when a key is skipped.
 */
export function createKeyPool(
  keys: string[],
  onRotate?: (index: number, err: unknown) => void,
): KeyPool {
  // Cursor persists across calls so we don't re-hit a known-throttled key first.
  let cursor = 0;

  return {
    get size() {
      return keys.length;
    },

    async run<T>(call: (apiKey: string, index: number) => Promise<T>): Promise<T> {
      if (keys.length === 0) {
        throw new Error(
          "No API key configured. Set GROQ_API_KEY (comma-separate for multiple).",
        );
      }

      let lastErr: unknown;
      const start = cursor;

      for (let attempt = 0; attempt < keys.length; attempt++) {
        const index = (start + attempt) % keys.length;
        try {
          const result = await call(keys[index]!, index);
          cursor = index; // stick to the key that worked
          return result;
        } catch (err) {
          if (!isKeyExhaustedError(err)) throw err;
          lastErr = err;
          onRotate?.(index, err);
          // Advance past the bad key so the *next* request skips it entirely.
          cursor = (index + 1) % keys.length;
        }
      }

      throw new AllKeysExhaustedError(keys.length, lastErr);
    },
  };
}
