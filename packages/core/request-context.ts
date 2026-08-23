import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request/per-job user attribution context (issue #30).
 *
 * A single `AsyncLocalStorage` carries `{ userId, phase }` from the point a
 * request or queue job enters the system down to every LLM call it triggers —
 * across awaits, stream callbacks, and module boundaries. The prod usage
 * rollup (`ai/telemetry.ts` → `recordProdUsage`) reads it to attribute tokens
 * to users; the eval Redis tracker is untouched and keeps working alongside.
 *
 * Writers:
 *   - apps/server wraps every routed handler in `runInRequestContext` and
 *     `auth.ts` calls `bindRequestUser` once authentication resolves.
 *   - apps/worker paths call `runWithUsageContext` per job / per user
 *     (ingestion pipeline, consolidation, conversation maintenance).
 *
 * The store object is deliberately mutable: `bindRequestUser` and
 * `enterUsagePhase` refine it mid-flight and the change is visible to all code
 * inside the same async context (standard ALS semantics).
 */

/** Coarse pipeline phase recorded on every ai_usage_daily row. */
export type UsagePhase = "ingest" | "retrieve" | "transcribe" | "other";

export interface UsageContextStore {
  /** Local users.id of the authenticated user, when known. */
  userId?: string;
  /** Pipeline phase for AI usage attribution; defaults to "other". */
  phase?: UsagePhase;
}

const storage = new AsyncLocalStorage<UsageContextStore>();

/** Run `fn` inside an empty context. Server request wrapper entrypoint. */
export function runInRequestContext<T>(fn: () => T): T {
  return storage.run({}, fn);
}

/**
 * Run `fn` with a user (and optional phase) bound — the worker-side entrypoint
 * for queue jobs that already know which user they act for.
 */
export function runWithUsageContext<T>(
  ctx: UsageContextStore,
  fn: () => T,
): T {
  return storage.run({ userId: ctx.userId, phase: ctx.phase }, fn);
}

/** User-only convenience wrapper over `runWithUsageContext`. */
export function runWithUser<T>(
  userId: string | null | undefined,
  fn: () => T,
): T {
  return runWithUsageContext({ userId: userId ?? undefined }, fn);
}

/** Bind the authenticated user on the CURRENT context (no-op outside one). */
export function bindRequestUser(userId: string | null | undefined): void {
  const store = storage.getStore();
  if (store && userId) store.userId = userId;
}

/** Refine the current context's phase (no-op when there is no context). */
export function enterUsagePhase(phase: UsagePhase): void {
  const store = storage.getStore();
  if (store) store.phase = phase;
}

/** Current attributed user id, or null when unauthenticated / no context. */
export function getRequestUserId(): string | null {
  return storage.getStore()?.userId ?? null;
}

/** Current attribution phase; defaults to "other". */
export function getUsagePhase(): UsagePhase {
  return storage.getStore()?.phase ?? "other";
}
