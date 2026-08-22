/**
 * Cross-process LLM token usage tracker for eval (and optional always-on dev).
 *
 * Why Redis: ingestion LLM calls run in the **worker**, Ask calls run in the
 * **server**, and the harness is a third process. In-memory counters would
 * miss almost everything. Redis is already required for BullMQ.
 *
 * Protocol (eval harness drives this):
 *   1. beginUsageSession({ sessionId, phase })  — clears events for session
 *   2. setUsagePhase(sessionId, "ingest"|"retrieve")
 *   3. Every LLM call (middleware) → recordUsageEvent(...)
 *   4. collectUsageSession(sessionId) → aggregate + full event list
 *
 * Disabled when REDIS_URL is unset or YAADORA_USAGE_TRACK=0.
 */

import { createLogger } from "@repo/logger";

const log = createLogger("ai:usage");

export type UsagePhase = "ingest" | "retrieve" | "other";

export interface UsageEvent {
  ts: string;
  /** provider:modelId as configured in models.ts */
  model: string;
  /** ingestion | reasoning | fast */
  tier: string;
  phase: UsagePhase;
  operation: "generate" | "stream";
  inputTokens: number;
  outputTokens: number;
  /** input + output (provider total when available) */
  totalTokens: number;
  latencyMs: number;
  /** optional freeform label (case id, clientId, …) */
  label?: string;
  sessionId: string;
}

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UsageReport {
  sessionId: string;
  events: UsageEvent[];
  byPhase: Record<UsagePhase, UsageTotals>;
  byTier: Record<string, UsageTotals>;
  byModel: Record<string, UsageTotals>;
  /** per label (e.g. eval case id) when present */
  byLabel: Record<string, UsageTotals>;
  total: UsageTotals;
}

const SESSION_KEY = "yaadora:usage:current_session";
const PHASE_KEY = "yaadora:usage:current_phase";

function eventsKey(sessionId: string): string {
  return `yaadora:usage:${sessionId}:events`;
}

function emptyTotals(): UsageTotals {
  return { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function add(t: UsageTotals, e: Pick<UsageEvent, "inputTokens" | "outputTokens" | "totalTokens">) {
  t.calls += 1;
  t.inputTokens += e.inputTokens;
  t.outputTokens += e.outputTokens;
  t.totalTokens += e.totalTokens;
}

function trackingEnabled(): boolean {
  if (process.env.YAADORA_USAGE_TRACK === "0") return false;
  // Default ON when REDIS_URL exists so eval + worker always share counters.
  return Boolean(process.env.REDIS_URL);
}

type RedisClient = {
  get: (k: string) => Promise<string | null>;
  set: (k: string, v: string) => Promise<unknown>;
  del: (...ks: string[]) => Promise<unknown>;
  rpush: (k: string, v: string) => Promise<unknown>;
  lrange: (k: string, start: number, stop: number) => Promise<string[]>;
  expire: (k: string, sec: number) => Promise<unknown>;
  quit: () => Promise<unknown>;
};

let redisPromise: Promise<RedisClient | null> | null = null;

async function getRedis(): Promise<RedisClient | null> {
  if (!trackingEnabled()) return null;
  if (!redisPromise) {
    redisPromise = (async () => {
      try {
        // ioredis is an optional transitive dep of bullmq. The specifier is
        // typed as a plain string so type-checking does not require the module
        // to be installed; at runtime Bun resolves it when present, and when
        // absent the throw is caught below (tracking stays off).
        const { default: Redis } = (await import("ioredis" as string)) as {
          default: new (
            url: string,
            opts?: Record<string, unknown>,
          ) => { connect: () => Promise<unknown> };
        };
        const url = process.env.REDIS_URL!;
        const client = new Redis(url, {
          maxRetriesPerRequest: 1,
          enableReadyCheck: false,
          enableOfflineQueue: false,
          connectionName: process.env.REDIS_CONNECTION_NAME
            ? `${process.env.REDIS_CONNECTION_NAME}:usage`
            : "yaadora:usage",
          lazyConnect: true,
        });
        await client.connect().catch(() => undefined);
        return client as unknown as RedisClient;
      } catch (err) {
        log.warn("usage tracker: redis unavailable", {
          message: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    })();
  }
  return redisPromise;
}

/** Parse V4 usage object (nested totals) or flat legacy shapes. */
export function parseUsage(raw: unknown): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  if (!raw || typeof raw !== "object") {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
  const u = raw as Record<string, unknown>;

  // V4 nested: { inputTokens: { total }, outputTokens: { total } }
  const inNested = u.inputTokens;
  const outNested = u.outputTokens;
  if (inNested && typeof inNested === "object") {
    const inputTokens = Number((inNested as any).total ?? 0) || 0;
    const outputTokens =
      outNested && typeof outNested === "object"
        ? Number((outNested as any).total ?? 0) || 0
        : 0;
    const totalTokens =
      Number((u as any).totalTokens ?? inputTokens + outputTokens) ||
      inputTokens + outputTokens;
    return { inputTokens, outputTokens, totalTokens };
  }

  // Flat: promptTokens / completionTokens / inputTokens / outputTokens
  const inputTokens =
    Number(u.inputTokens ?? u.promptTokens ?? u.prompt_tokens ?? 0) || 0;
  const outputTokens =
    Number(u.outputTokens ?? u.completionTokens ?? u.completion_tokens ?? 0) ||
    0;
  const totalTokens =
    Number(u.totalTokens ?? u.total_tokens ?? inputTokens + outputTokens) ||
    inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

export async function beginUsageSession(params: {
  sessionId: string;
  phase: UsagePhase;
}): Promise<void> {
  const redis = await getRedis();
  if (!redis) {
    log.warn("beginUsageSession: tracking disabled (no Redis)");
    return;
  }
  const { sessionId, phase } = params;
  await redis.set(SESSION_KEY, sessionId);
  await redis.set(PHASE_KEY, phase);
  await redis.del(eventsKey(sessionId));
  // Keep session metadata for 48h so late events still land.
  await redis.expire(SESSION_KEY, 60 * 60 * 48);
  await redis.expire(PHASE_KEY, 60 * 60 * 48);
  log.info("usage session started", { sessionId, phase });
}

export async function setUsagePhase(
  phase: UsagePhase,
  sessionId?: string,
): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  await redis.set(PHASE_KEY, phase);
  if (sessionId) await redis.set(SESSION_KEY, sessionId);
}

export async function recordUsageEvent(
  partial: Omit<UsageEvent, "ts" | "phase" | "sessionId"> & {
    phase?: UsagePhase;
    sessionId?: string;
  },
): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  try {
    const sessionId =
      partial.sessionId ??
      (await redis.get(SESSION_KEY)) ??
      "default";
    const phase =
      (partial.phase as UsagePhase | undefined) ??
      ((await redis.get(PHASE_KEY)) as UsagePhase | null) ??
      "other";

    const event: UsageEvent = {
      ts: new Date().toISOString(),
      model: partial.model,
      tier: partial.tier,
      phase,
      operation: partial.operation,
      inputTokens: partial.inputTokens,
      outputTokens: partial.outputTokens,
      totalTokens: partial.totalTokens,
      latencyMs: partial.latencyMs,
      label: partial.label,
      sessionId,
    };

    const key = eventsKey(sessionId);
    await redis.rpush(key, JSON.stringify(event));
    await redis.expire(key, 60 * 60 * 48);

    log.debug("usage recorded", {
      sessionId,
      phase,
      tier: event.tier,
      model: event.model,
      input: event.inputTokens,
      output: event.outputTokens,
      total: event.totalTokens,
      ms: event.latencyMs,
    });
  } catch (err) {
    log.warn("usage record failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export function aggregateUsageEvents(events: UsageEvent[]): Omit<
  UsageReport,
  "sessionId" | "events"
> {
  const byPhase: Record<UsagePhase, UsageTotals> = {
    ingest: emptyTotals(),
    retrieve: emptyTotals(),
    other: emptyTotals(),
  };
  const byTier: Record<string, UsageTotals> = {};
  const byModel: Record<string, UsageTotals> = {};
  const byLabel: Record<string, UsageTotals> = {};
  const total = emptyTotals();

  for (const e of events) {
    add(total, e);
    add(byPhase[e.phase] ?? byPhase.other, e);
    byTier[e.tier] ??= emptyTotals();
    add(byTier[e.tier]!, e);
    byModel[e.model] ??= emptyTotals();
    add(byModel[e.model]!, e);
    if (e.label) {
      byLabel[e.label] ??= emptyTotals();
      add(byLabel[e.label]!, e);
    }
  }

  return { byPhase, byTier, byModel, byLabel, total };
}

export async function collectUsageSession(
  sessionId: string,
): Promise<UsageReport> {
  const redis = await getRedis();
  if (!redis) {
    return {
      sessionId,
      events: [],
      ...aggregateUsageEvents([]),
    };
  }

  const raw = await redis.lrange(eventsKey(sessionId), 0, -1);
  const events: UsageEvent[] = [];
  for (const line of raw) {
    try {
      events.push(JSON.parse(line) as UsageEvent);
    } catch {
      /* skip corrupt */
    }
  }
  return { sessionId, events, ...aggregateUsageEvents(events) };
}

export function formatUsageSummary(report: UsageReport): string {
  const lines: string[] = [];
  const t = report.total;
  lines.push(
    `  tokens total     in=${t.inputTokens}  out=${t.outputTokens}  Σ=${t.totalTokens}  calls=${t.calls}`,
  );
  for (const phase of ["ingest", "retrieve", "other"] as UsagePhase[]) {
    const p = report.byPhase[phase];
    if (p.calls === 0) continue;
    lines.push(
      `  tokens ${phase.padEnd(10)} in=${p.inputTokens}  out=${p.outputTokens}  Σ=${p.totalTokens}  calls=${p.calls}`,
    );
  }
  for (const [tier, p] of Object.entries(report.byTier)) {
    lines.push(
      `  tokens tier:${tier.padEnd(10)} in=${p.inputTokens}  out=${p.outputTokens}  Σ=${p.totalTokens}  calls=${p.calls}`,
    );
  }
  return lines.join("\n");
}
