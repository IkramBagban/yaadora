import { Queue, Worker, type Job } from "bullmq";
import {
  createRedisConnection,
  evaluateAndRecord,
  generatePushCopy,
  loadUserBudgetSettings,
  localDateString,
  localMinutesOfDay,
  retargetSurfacingChannel,
  scanProspectionCandidates,
  sendExpoPush,
  userHadConversationToday,
} from "@repo/core";
import {
  db,
  digests,
  pushTokens,
  users,
  memories,
  eq,
  and,
  inArray,
} from "@repo/db";
import { createLogger } from "@repo/logger";

const log = createLogger("worker:prospection");

/**
 * Daily prospection job (spec 02 §3.3, §6; P2).
 *
 * Per-user around 08:30 LOCAL time (users.timezone). Scans open loops,
 * birthdays, and stale conversation-queued nudges; every candidate goes
 * through the same gates; delivers as conversation-queue / push / chip.
 *
 * Registration is append-only — same pattern as conversation-maintenance.ts.
 */

export const PROSPECTION_QUEUE = "prospection";

/**
 * How often we wake to check "is it ~08:30 local for anyone?".
 * Override with PROSPECTION_CRON.
 */
export const PROSPECTION_CRON =
  process.env.PROSPECTION_CRON ?? "*/15 * * * *";

/** Local-minute window around 08:30 (08:15–08:44 inclusive of 15-min ticks). */
const PROSPECTION_WINDOW_START = 8 * 60 + 15; // 08:15
const PROSPECTION_WINDOW_END = 8 * 60 + 45; // 08:45

const DIGEST_KIND = "prospection_last";

export interface ProspectionJobData {
  /** reserved; null = all users due now */
  userId: string | null;
  /** injectable "now" for tests (ISO string) */
  nowIso?: string;
}

// --- core run -------------------------------------------------------------

/**
 * Whether local wall-clock is inside the morning prospection window.
 */
export function isInProspectionWindow(
  now: Date,
  timezone: string,
): boolean {
  const mins = localMinutesOfDay(now, timezone);
  if (mins === null) return false;
  return mins >= PROSPECTION_WINDOW_START && mins < PROSPECTION_WINDOW_END;
}

async function getLastProspectionDay(
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ content: digests.content })
    .from(digests)
    .where(and(eq(digests.userId, userId), eq(digests.kind, DIGEST_KIND)))
    .limit(1);
  return row?.content ?? null;
}

async function markProspectionDay(
  userId: string,
  localDay: string,
): Promise<void> {
  await db
    .insert(digests)
    .values({
      userId,
      kind: DIGEST_KIND,
      content: localDay,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [digests.userId, digests.kind],
      set: { content: localDay, updatedAt: new Date() },
    });
}

async function deliverPush(params: {
  userId: string;
  body: string;
  surfacingId: string;
}): Promise<boolean> {
  const tokens = await db
    .select({ expoToken: pushTokens.expoToken })
    .from(pushTokens)
    .where(eq(pushTokens.userId, params.userId));

  if (tokens.length === 0) {
    log.info("no push tokens; falling back to chip", {
      userId: params.userId,
    });
    return false;
  }

  const result = await sendExpoPush(
    tokens.map((t) => ({
      to: t.expoToken,
      title: "Yaadora",
      body: params.body,
      sound: "default" as const,
      data: { surfacingId: params.surfacingId },
    })),
  );
  return result.ok;
}

/**
 * Run prospection for a single user (gates + deliver). Exported for tests.
 */
export async function runProspectionForUser(params: {
  userId: string;
  now?: Date;
  /** When true, skip the local-time window + once-per-day marker (tests). */
  force?: boolean;
}): Promise<{
  candidates: number;
  delivered: number;
  suppressed: number;
  skipped: string | null;
}> {
  const now = params.now ?? new Date();
  const settings = await loadUserBudgetSettings(params.userId);
  const localDay = localDateString(now, settings.timezone);

  if (!params.force) {
    if (!isInProspectionWindow(now, settings.timezone)) {
      return {
        candidates: 0,
        delivered: 0,
        suppressed: 0,
        skipped: "outside_window",
      };
    }
    const last = await getLastProspectionDay(params.userId);
    if (last === localDay) {
      return {
        candidates: 0,
        delivered: 0,
        suppressed: 0,
        skipped: "already_ran_today",
      };
    }
  }

  const candidates = await scanProspectionCandidates({
    userId: params.userId,
    now,
    timezone: settings.timezone,
  });

  let delivered = 0;
  let suppressed = 0;

  const hadConvo = await userHadConversationToday(
    params.userId,
    settings.timezone,
    now,
  );

  // Resolve push availability once per user (token presence).
  const tokenRows = await db
    .select({ id: pushTokens.id })
    .from(pushTokens)
    .where(eq(pushTokens.userId, params.userId))
    .limit(1);
  const hasPushToken = tokenRows.length > 0;

  for (const candidate of candidates) {
    // Preferred channel: conversation queue if user already chatted today;
    // else push when a token exists, otherwise chip for app-open.
    let channel: "conversation" | "push" | "chip";
    if (hadConvo) {
      channel = "conversation";
    } else if (hasPushToken) {
      channel = "push";
    } else {
      channel = "chip";
    }

    const gated = await evaluateAndRecord({
      userId: params.userId,
      conversationId: null,
      candidate,
      seam: "open",
      channel,
      now,
      skipSeamGate: true,
    });

    if (!gated.approved || !gated.surfacingId) {
      // quiet_hours on push → re-try as chip so the day isn't a total miss.
      if (
        channel === "push" &&
        gated.outcome.decision === "suppress" &&
        gated.outcome.reason === "quiet_hours"
      ) {
        const chipGated = await evaluateAndRecord({
          userId: params.userId,
          conversationId: null,
          candidate,
          seam: "open",
          channel: "chip",
          now,
          skipSeamGate: true,
        });
        if (chipGated.approved) {
          delivered++;
          continue;
        }
      }
      suppressed++;
      continue;
    }

    if (channel === "push") {
      let evidenceSnippets: string[] = [];
      if (candidate.evidence.length) {
        const mems = await db
          .select({ rawText: memories.rawText })
          .from(memories)
          .where(
            and(
              eq(memories.userId, params.userId),
              inArray(memories.id, candidate.evidence),
            ),
          )
          .limit(3);
        evidenceSnippets = mems.map((m) => m.rawText);
      }
      const body = await generatePushCopy({
        oneLineNudge: candidate.oneLineNudge,
        evidenceSnippets,
      });
      const sent = await deliverPush({
        userId: params.userId,
        body,
        surfacingId: gated.surfacingId,
      });
      if (!sent) {
        // Expo failed or no tokens: retarget ledger row to chip so the user
        // still sees it on app open. Do not leave a "delivered" push ghost.
        const retargeted = await retargetSurfacingChannel({
          surfacingId: gated.surfacingId,
          userId: params.userId,
          channel: "chip",
          now,
        });
        if (retargeted) {
          delivered++;
          continue;
        }
        suppressed++;
        continue;
      }
    }

    delivered++;
  }

  if (!params.force) {
    await markProspectionDay(params.userId, localDay);
  }

  log.info("prospection user done", {
    userId: params.userId,
    candidates: candidates.length,
    delivered,
    suppressed,
    hadConvo,
    localDay,
  });

  return {
    candidates: candidates.length,
    delivered,
    suppressed,
    skipped: null,
  };
}

export async function runProspection(
  data: ProspectionJobData = { userId: null },
): Promise<{ users: number; delivered: number }> {
  const now = data.nowIso ? new Date(data.nowIso) : new Date();
  const started = Date.now();

  const userRows = data.userId
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, data.userId))
    : await db.select({ id: users.id }).from(users);

  let delivered = 0;
  let processed = 0;
  for (const u of userRows) {
    try {
      const report = await runProspectionForUser({
        userId: u.id,
        now,
      });
      if (!report.skipped) processed++;
      delivered += report.delivered;
    } catch (err) {
      log.error("prospection failed for user", {
        userId: u.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info("prospection sweep done", {
    users: processed,
    delivered,
    ms: Date.now() - started,
  });
  return { users: processed, delivered };
}

// --- bullmq registration (append-only from worker index) ------------------

let prospectionQueue: Queue | null = null;

function getQueue(): Queue {
  if (!prospectionQueue) {
    prospectionQueue = new Queue(PROSPECTION_QUEUE, {
      connection: createRedisConnection(),
    });
  }
  return prospectionQueue;
}

/** Idempotent repeatable job registration. */
export async function scheduleProspection(): Promise<void> {
  const data: ProspectionJobData = { userId: null };
  await getQueue().add("sweep", data, {
    repeat: { pattern: PROSPECTION_CRON },
    jobId: "prospection",
    removeOnComplete: true,
    removeOnFail: false,
  });
}

/** Start the worker that processes prospection jobs. */
export function startProspectionWorker(): Worker<ProspectionJobData> {
  const worker = new Worker<ProspectionJobData>(
    PROSPECTION_QUEUE,
    async (job: Job<ProspectionJobData>) => {
      log.info("prospection started", { jobId: job.id });
      await runProspection(job.data);
    },
    { connection: createRedisConnection(), concurrency: 1 },
  );

  worker.on("ready", () => {
    log.info("prospection worker ready", {
      queue: PROSPECTION_QUEUE,
      cron: PROSPECTION_CRON,
    });
  });

  worker.on("failed", (job, err) => {
    log.error("prospection job failed", {
      jobId: job?.id,
      error: err?.message ?? String(err),
    });
  });

  worker.on("error", (err) => {
    log.error("prospection worker error", err);
  });

  return worker;
}
