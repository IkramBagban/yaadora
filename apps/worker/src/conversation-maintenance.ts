import { Queue, Worker, type Job } from "bullmq";
import { generateText } from "ai";
import {
  captureFromConversation,
  createRedisConnection,
  ingestionModel,
} from "@repo/core";
import {
  db,
  conversations,
  conversationTurns,
  surfacings,
  users,
  eq,
  and,
  lt,
  isNull,
  sql,
  asc,
} from "@repo/db";
import { createLogger } from "@repo/logger";

const log = createLogger("worker:conversation-maintenance");

/**
 * Conversation maintenance cron (spec 02 §2.1, P0 item 2).
 *
 * 1. Idle sweep — active conversations with no turn for 30+ minutes become
 *    `idle`, get an ingestion-tier summary, then run conversation-capture on
 *    any user turns that were not already captured live.
 * 2. Retention pruning — hard-delete turns older than the user's
 *    `transcript_retention_days` when a summary exists.
 *    - null → keep forever
 *    - 0 → digest immediately (delete all turns once summary exists)
 *    - N → delete turns older than N days
 *    Product default when a user first sets retention is 30 days (PATCH).
 *
 * Queue + worker live in this module so registration is appended to the
 * worker process without rewriting shared producer registration.
 */

export const CONVERSATION_MAINTENANCE_QUEUE = "conversation-maintenance";

/** How often the sweep runs. Override with CONVERSATION_MAINTENANCE_CRON. */
export const CONVERSATION_MAINTENANCE_CRON =
  process.env.CONVERSATION_MAINTENANCE_CRON ?? "*/5 * * * *";

const IDLE_MS = 30 * 60 * 1000;
/** Product default retention when interpreting "default 30" for logging only. */
const DEFAULT_RETENTION_DAYS = 30;

export interface ConversationMaintenanceJobData {
  /** reserved for future per-user targeting; null = all users */
  userId: string | null;
}

// --- idle sweep -----------------------------------------------------------

async function generateConversationSummary(
  turns: { role: string; content: string }[],
): Promise<string | null> {
  if (turns.length === 0) return null;

  const transcript = turns
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
    .join("\n");

  // Cap prompt size for very long chats.
  const clipped =
    transcript.length > 12_000
      ? `${transcript.slice(0, 6_000)}\n…\n${transcript.slice(-6_000)}`
      : transcript;

  try {
    const { text } = await generateText({
      model: ingestionModel,
      system:
        "You summarise personal assistant conversations for long-term memory. Write 2–5 sentences in third person about the user: topics discussed, facts stated, decisions, plans. No bullet lists. Omit chit-chat. If nothing substantive, return a single short sentence.",
      prompt: `Summarise this conversation:\n\n${clipped}`,
    });
    const summary = text.trim();
    return summary.length > 0 ? summary : null;
  } catch (err) {
    log.warn("summary generation failed", err as Error);
    return null;
  }
}

function metaCaptureProcessed(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  return (meta as { captureProcessed?: boolean }).captureProcessed === true;
}

async function processIdleConversation(convo: {
  id: string;
  userId: string;
  summary: string | null;
}): Promise<void> {
  const turns = await db
    .select({
      id: conversationTurns.id,
      role: conversationTurns.role,
      content: conversationTurns.content,
      meta: conversationTurns.meta,
      createdAt: conversationTurns.createdAt,
    })
    .from(conversationTurns)
    .where(eq(conversationTurns.conversationId, convo.id))
    .orderBy(asc(conversationTurns.createdAt));

  const summary =
    convo.summary ??
    (await generateConversationSummary(
      turns.map((t) => ({ role: t.role, content: t.content })),
    ));

  if (!summary) {
    log.warn("conversation summary unavailable; leaving conversation active", {
      conversationId: convo.id,
      userId: convo.userId,
    });
    return;
  }

  // Mark idle + write summary first so retention can act.
  await db
    .update(conversations)
    .set({
      status: "idle",
      summary,
    })
    .where(
      and(eq(conversations.id, convo.id), eq(conversations.status, "active")),
    );

  // Conversation-capture for any user turns not already processed live.
  const history: { role: "user" | "assistant"; content: string }[] = [];
  let captured = 0;
  for (const turn of turns) {
    if (turn.role === "user" && !metaCaptureProcessed(turn.meta)) {
      const result = await captureFromConversation({
        userId: convo.userId,
        userText: turn.content,
        history: [...history],
      });
      await db
        .update(conversationTurns)
        .set({
          meta: {
            ...((turn.meta as object) ?? {}),
            captureProcessed: true,
            ...(result.captured ? { memoryId: result.memoryId } : {}),
          },
        })
        .where(eq(conversationTurns.id, turn.id));
      if (result.captured) captured++;
    }
    if (turn.role === "user" || turn.role === "assistant") {
      history.push({
        role: turn.role as "user" | "assistant",
        content: turn.content,
      });
    }
  }

  // Pending conversation surfacings with no reaction → ignored at idle.
  await db
    .update(surfacings)
    .set({ reaction: "ignored", reactionAt: new Date() })
    .where(
      and(
        eq(surfacings.conversationId, convo.id),
        eq(surfacings.userId, convo.userId),
        isNull(surfacings.reaction),
        isNull(surfacings.suppressedReason),
      ),
    );

  // Retention 0 = digest immediately once a summary exists.
  const [user] = await db
    .select({ retention: users.transcriptRetentionDays })
    .from(users)
    .where(eq(users.id, convo.userId))
    .limit(1);
  if (user?.retention === 0) {
    await db
      .delete(conversationTurns)
      .where(eq(conversationTurns.conversationId, convo.id));
    log.info("immediate digest: turns pruned", {
      conversationId: convo.id,
      userId: convo.userId,
    });
  }

  log.info("conversation marked idle", {
    conversationId: convo.id,
    userId: convo.userId,
    turns: turns.length,
    summaryChars: summary?.length ?? 0,
    newlyCaptured: captured,
  });
}

async function runIdleSweep(): Promise<number> {
  const cutoff = new Date(Date.now() - IDLE_MS);
  const idleCandidates = await db
    .select({
      id: conversations.id,
      userId: conversations.userId,
      summary: conversations.summary,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.status, "active"),
        lt(conversations.lastTurnAt, cutoff),
      ),
    )
    .limit(100);

  let processed = 0;
  for (const convo of idleCandidates) {
    try {
      await processIdleConversation(convo);
      processed++;
    } catch (err) {
      log.error("idle process failed", {
        conversationId: convo.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return processed;
}

// --- retention pruning ----------------------------------------------------

/**
 * Delete turns older than each user's retention window, only when the parent
 * conversation has a summary. null retention = forever (skip). 0 = all turns
 * for summarised conversations. N = older than N days.
 */
async function runRetentionPrune(): Promise<number> {
  // Users with an explicit retention (not null). Default product value is 30
  // when users opt in via settings; null stays forever.
  const rows = await db
    .select({
      userId: users.id,
      retention: users.transcriptRetentionDays,
    })
    .from(users)
    .where(sql`${users.transcriptRetentionDays} IS NOT NULL`);

  let deleted = 0;
  for (const { userId, retention } of rows) {
    if (retention === null) continue;

    try {
      let result: { rowCount?: number } | unknown;
      if (retention === 0) {
        // Digest immediately: wipe all turns for summarised conversations.
        result = await db.execute(sql`
          DELETE FROM conversation_turns ct
          USING conversations c
          WHERE ct.conversation_id = c.id
            AND c.user_id = ${userId}
            AND c.summary IS NOT NULL
        `);
      } else {
        const days = retention > 0 ? retention : DEFAULT_RETENTION_DAYS;
        result = await db.execute(sql`
          DELETE FROM conversation_turns ct
          USING conversations c
          WHERE ct.conversation_id = c.id
            AND c.user_id = ${userId}
            AND c.summary IS NOT NULL
            AND ct.created_at < NOW() - (${days}::int * INTERVAL '1 day')
        `);
      }
      // postgres.js / drizzle rowCount varies; log best-effort.
      const count =
        typeof result === "object" &&
        result !== null &&
        "count" in result &&
        typeof (result as { count: unknown }).count === "number"
          ? (result as { count: number }).count
          : 0;
      deleted += count;
    } catch (err) {
      log.error("retention prune failed for user", {
        userId,
        retention,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return deleted;
}

// --- job entrypoint -------------------------------------------------------

export async function runConversationMaintenance(
  _data: ConversationMaintenanceJobData = { userId: null },
): Promise<{ idleProcessed: number; turnsDeleted: number }> {
  const started = Date.now();
  const idleProcessed = await runIdleSweep();
  const turnsDeleted = await runRetentionPrune();
  log.info("conversation maintenance done", {
    idleProcessed,
    turnsDeleted,
    ms: Date.now() - started,
  });
  return { idleProcessed, turnsDeleted };
}

// --- bullmq registration (append-only from worker index) ------------------

let maintenanceQueue: Queue | null = null;

function getQueue(): Queue {
  if (!maintenanceQueue) {
    maintenanceQueue = new Queue(CONVERSATION_MAINTENANCE_QUEUE, {
      connection: createRedisConnection(),
    });
  }
  return maintenanceQueue;
}

/** Idempotent repeatable job registration. */
export async function scheduleConversationMaintenance(): Promise<void> {
  const data: ConversationMaintenanceJobData = { userId: null };
  await getQueue().add("sweep", data, {
    repeat: { pattern: CONVERSATION_MAINTENANCE_CRON },
    jobId: "conversation-maintenance",
    removeOnComplete: true,
    removeOnFail: false,
  });
}

/** Start the worker that processes maintenance jobs. */
export function startConversationMaintenanceWorker(): Worker<ConversationMaintenanceJobData> {
  const worker = new Worker<ConversationMaintenanceJobData>(
    CONVERSATION_MAINTENANCE_QUEUE,
    async (job: Job<ConversationMaintenanceJobData>) => {
      log.info("conversation maintenance started", { jobId: job.id });
      await runConversationMaintenance(job.data);
    },
    { connection: createRedisConnection(), concurrency: 1 },
  );

  worker.on("ready", () => {
    log.info("conversation maintenance worker ready", {
      queue: CONVERSATION_MAINTENANCE_QUEUE,
      cron: CONVERSATION_MAINTENANCE_CRON,
    });
  });

  worker.on("failed", (job, err) => {
    log.error("conversation maintenance job failed", {
      jobId: job?.id,
      error: err?.message ?? String(err),
    });
  });

  worker.on("error", (err) => {
    log.error("conversation maintenance worker error", err);
  });

  return worker;
}
