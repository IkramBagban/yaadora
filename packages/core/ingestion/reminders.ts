import { db, reminders, eq, and } from "@repo/db";
import { createLogger } from "@repo/logger";
import type { Extraction } from "./extraction";
import { parseDate } from "./temporal";

/**
 * Prospective intent → a SUGGESTED reminder (docs/specs/reminder-feature).
 *
 * The write path (POST /memories) is async, so we can't hand a chip back in the
 * response like /ask does. Instead we persist the reminder as status="suggested"
 * — the client surfaces it as a one-tap chip (GET /reminders?scope=suggested) to
 * confirm (→ pending) or dismiss. Deduped per source memory so ingestion retries
 * never create doubles. Best-effort: a failure here never fails the memory.
 */

const log = createLogger("ingestion:reminders");

function shortTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 100 ? `${oneLine.slice(0, 97)}…` : oneLine;
}

export async function maybeSuggestReminder(params: {
  userId: string;
  memoryId: string;
  intent: Extraction["intent"];
  occurredAt: Date | null;
  memoryText: string;
  now: Date;
}): Promise<void> {
  const { userId, memoryId, intent, occurredAt, memoryText, now } = params;

  // Two triggers, either one is enough:
  //  1. An explicit future ACTION ("call the bank Friday") from intent.
  //  2. A prospective EVENT ("meeting on Sunday", "flight next week") whose
  //     resolved occurredAt is in the future — extraction often fills occurredAt
  //     without setting intent for passive events, so we must catch these too.
  let due: Date | null = null;
  let text: string | null = null;

  if (intent?.hasFutureAction) {
    due = parseDate(intent.dueAt);
    text = (intent.text ?? "").trim() || null;
  }
  if (!due && occurredAt && occurredAt.getTime() > now.getTime()) {
    due = occurredAt;
    text = text ?? shortTitle(memoryText);
  }

  if (!due || due.getTime() <= now.getTime()) return; // nothing future to schedule

  try {
    // One suggestion per source memory (retry-safe).
    const existing = await db
      .select({ id: reminders.id })
      .from(reminders)
      .where(and(eq(reminders.sourceMemory, memoryId), eq(reminders.userId, userId)))
      .limit(1);
    if (existing.length) return;

    await db.insert(reminders).values({
      userId,
      text: text?.trim() || "Follow up",
      dueAt: due,
      origin: "suggested",
      status: "suggested",
      sourceMemory: memoryId,
    });
    log.info("reminder suggested from capture", { userId, memoryId, dueAt: due });
  } catch (err) {
    log.warn("reminder suggestion failed (ignored)", err as Error);
  }
}
