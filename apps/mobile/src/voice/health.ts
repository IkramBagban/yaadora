/**
 * Cloud-transcription health, tracked in-process.
 *
 * When the server reports 503 (every Groq key rate-limited, or none configured)
 * there's no point trying again on the next tap — we'd burn a round-trip and a
 * second of the user's time to learn the same thing. Mark it degraded, route
 * straight to on-device recognition, and re-probe after a cooldown.
 */

const COOLDOWN_MS = 5 * 60 * 1000;

let degradedUntil = 0;

/** True when the cloud path is worth attempting. */
export function isCloudHealthy(): boolean {
  return Date.now() >= degradedUntil;
}

/** Called on a 503 — routes subsequent captures on-device for the cooldown. */
export function markCloudDegraded(): void {
  degradedUntil = Date.now() + COOLDOWN_MS;
}

/** Called on a successful transcription — clears any cooldown early. */
export function markCloudHealthy(): void {
  degradedUntil = 0;
}

/** Seconds until the cloud path is retried. 0 when healthy. Exposed for tests. */
export function cooldownRemainingMs(): number {
  return Math.max(0, degradedUntil - Date.now());
}
