import { z } from "zod";
import { db, reminders, eq, and, gte, desc, asc } from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { json, badRequest, notFound, unauthorized, serverError } from "../http";

const log = createLogger("server:reminders");

/**
 * Reminder routes (spec: docs/specs/reminder-feature.md).
 *
 * The conversational loop is deliberately smooth: /ask streams a
 * `reminder_suggestion` frame (a transient chip). Nothing is stored until the
 * user taps it → POST /reminders/confirm (one call, one row). Dismissing the
 * chip costs nothing (it was never persisted). Undoing a just-saved reminder is
 * a single DELETE /reminders/:id.
 *
 * Firing/delivery (BullMQ delayed job + push) is the next wave; these endpoints
 * own creation, listing, and cancellation.
 */

const reminderCols = {
  id: reminders.id,
  text: reminders.text,
  dueAt: reminders.dueAt,
  status: reminders.status,
  origin: reminders.origin,
  sourceMemory: reminders.sourceMemory,
  createdAt: reminders.createdAt,
};

const ConfirmBody = z.object({
  text: z.string().min(1, "text is required").max(500),
  dueAt: z.string().datetime({ message: "dueAt must be an ISO 8601 datetime" }),
  // Provenance: the memory the suggestion came from (set on AI-suggested chips).
  sourceMemoryId: z.string().uuid().optional(),
  // "suggested" for a chip the app proposed; "manual" for an explicit ask.
  origin: z.enum(["suggested", "manual"]).default("suggested"),
});

/** POST /reminders/confirm — turn a suggestion (or explicit ask) into a reminder. */
export async function confirmReminder(req: Request): Promise<Response> {
  const userId = authenticate(req);
  if (!userId) return unauthorized();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest("Body must be valid JSON.");
  }
  const parsed = ConfirmBody.safeParse(raw);
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const { text, dueAt, sourceMemoryId, origin } = parsed.data;

  const [created] = await db
    .insert(reminders)
    .values({
      userId,
      text,
      dueAt: new Date(dueAt),
      origin,
      sourceMemory: sourceMemoryId ?? null,
      status: "pending",
    })
    .returning(reminderCols);

  if (!created) {
    log.error("reminder insert returned no row", { userId });
    return serverError("Failed to save reminder.");
  }

  // TODO(firing wave): schedule a BullMQ delayed job at dueAt (idempotent) so
  // the reminder actually notifies. Creation is complete and durable regardless.
  log.info("reminder confirmed", {
    userId,
    reminderId: created.id,
    origin,
    dueAt: created.dueAt,
  });
  return json(created, 201);
}

const ListQuery = z.object({
  // "upcoming" (default) = pending & not past; "all" = every non-dismissed.
  scope: z.enum(["upcoming", "all"]).default("upcoming"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** GET /reminders?scope=&limit= — the user's reminders, soonest first. */
export async function listReminders(req: Request): Promise<Response> {
  const userId = authenticate(req);
  if (!userId) return unauthorized();

  const url = new URL(req.url);
  const parsed = ListQuery.safeParse({
    scope: url.searchParams.get("scope") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const { scope, limit } = parsed.data;

  const where =
    scope === "upcoming"
      ? and(
          eq(reminders.userId, userId),
          eq(reminders.status, "pending"),
          gte(reminders.dueAt, new Date()),
        )
      : and(eq(reminders.userId, userId), eq(reminders.status, "pending"));

  const items = await db
    .select(reminderCols)
    .from(reminders)
    .where(where)
    .orderBy(scope === "upcoming" ? asc(reminders.dueAt) : desc(reminders.createdAt))
    .limit(limit);

  log.debug("reminders listed", { userId, scope, count: items.length });
  return json({ items });
}

/** DELETE /reminders/:id — cancel / undo. Soft (status='dismissed'), scoped to owner. */
export async function cancelReminder(req: Request, id: string): Promise<Response> {
  const userId = authenticate(req);
  if (!userId) return unauthorized();

  const [updated] = await db
    .update(reminders)
    .set({ status: "dismissed" })
    .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
    .returning({ id: reminders.id, status: reminders.status });

  if (!updated) {
    log.debug("reminder cancel: not found", { userId, reminderId: id });
    return notFound("Reminder not found.");
  }
  // TODO(firing wave): also remove the scheduled BullMQ job for this reminder.
  log.info("reminder cancelled", { userId, reminderId: id });
  return json(updated);
}
