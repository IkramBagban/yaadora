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
  recurrence: reminders.recurrence,
  weekdays: reminders.weekdays,
  status: reminders.status,
  origin: reminders.origin,
  sourceMemory: reminders.sourceMemory,
  createdAt: reminders.createdAt,
};

const ConfirmBody = z
  .object({
    text: z.string().min(1, "text is required").max(500),
    dueAt: z.string().datetime({ message: "dueAt must be an ISO 8601 datetime" }),
    // Provenance: the memory the suggestion came from (set on AI-suggested chips).
    sourceMemoryId: z.string().uuid().optional(),
    // "suggested" for a chip the app proposed; "manual" for an explicit ask.
    origin: z.enum(["suggested", "manual"]).default("suggested"),
    // once: dueAt is the exact fire time. daily/weekly: dueAt's clock time is
    // the recurring time-of-day (spec: 2026-07-15-reminder-recurrence-design.md).
    recurrence: z.enum(["once", "daily", "weekly"]).default("once"),
    // 0(Sun)..6(Sat), JS Date.getDay() convention. Required (non-empty) for
    // 'weekly'; must be absent/empty otherwise.
    weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.recurrence === "weekly") {
      if (!d.weekdays || d.weekdays.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "weekdays is required (non-empty) when recurrence is 'weekly'.",
          path: ["weekdays"],
        });
      }
    } else if (d.weekdays !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "weekdays may only be set when recurrence is 'weekly'.",
        path: ["weekdays"],
      });
    }
  });

/** POST /reminders/confirm — turn a suggestion (or explicit ask) into a reminder. */
export async function confirmReminder(req: Request): Promise<Response> {
  const userId = await authenticate(req);
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
  const { text, dueAt, sourceMemoryId, origin, recurrence, weekdays } = parsed.data;

  const [created] = await db
    .insert(reminders)
    .values({
      userId,
      text,
      dueAt: new Date(dueAt),
      origin,
      sourceMemory: sourceMemoryId ?? null,
      status: "pending",
      recurrence,
      weekdays: recurrence === "weekly" ? weekdays : null,
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
  // "upcoming" = pending & not past; "all" = every pending; "suggested" =
  // unconfirmed chips the capture pipeline proposed, awaiting a tap.
  scope: z.enum(["upcoming", "all", "suggested"]).default("upcoming"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** GET /reminders?scope=&limit= — the user's reminders, soonest first. */
export async function listReminders(req: Request): Promise<Response> {
  const userId = await authenticate(req);
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

  let where;
  if (scope === "suggested") {
    where = and(eq(reminders.userId, userId), eq(reminders.status, "suggested"));
  } else if (scope === "upcoming") {
    where = and(
      eq(reminders.userId, userId),
      eq(reminders.status, "pending"),
      gte(reminders.dueAt, new Date()),
    );
  } else {
    where = and(eq(reminders.userId, userId), eq(reminders.status, "pending"));
  }

  const items = await db
    .select(reminderCols)
    .from(reminders)
    .where(where)
    .orderBy(scope === "all" ? desc(reminders.createdAt) : asc(reminders.dueAt))
    .limit(limit);

  log.debug("reminders listed", { userId, scope, count: items.length });
  return json({ items });
}

/** POST /reminders/:id/confirm — accept a SUGGESTED chip (from the capture
 * pipeline): promote status 'suggested' → 'pending'. Idempotent-ish, owner-scoped. */
export async function confirmSuggestedReminder(
  req: Request,
  id: string,
): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  const [updated] = await db
    .update(reminders)
    .set({ status: "pending" })
    .where(
      and(
        eq(reminders.id, id),
        eq(reminders.userId, userId),
        eq(reminders.status, "suggested"),
      ),
    )
    .returning(reminderCols);

  if (!updated) {
    // Either it doesn't exist, isn't the user's, or was already confirmed/dismissed.
    log.debug("reminder confirm: no suggested row", { userId, reminderId: id });
    return notFound("No pending suggestion with that id.");
  }
  // TODO(firing wave): schedule the BullMQ delayed job now that it's committed.
  log.info("suggested reminder confirmed", { userId, reminderId: id });
  return json(updated);
}

const UpdateBody = z
  .object({
    text: z.string().min(1).max(500).optional(),
    dueAt: z.string().datetime().optional(),
    status: z.enum(["pending", "done", "dismissed"]).optional(),
    recurrence: z.enum(["once", "daily", "weekly"]).optional(),
    // 0(Sun)..6(Sat), JS Date.getDay() convention. Only meaningful when the
    // (resulting) recurrence is 'weekly'.
    weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  })
  .refine(
    (d) =>
      d.text !== undefined ||
      d.dueAt !== undefined ||
      d.status !== undefined ||
      d.recurrence !== undefined ||
      d.weekdays !== undefined,
    { message: "Provide at least one of text, dueAt, status, recurrence, weekdays." },
  )
  .refine((d) => d.recurrence !== "weekly" || (d.weekdays && d.weekdays.length > 0), {
    message: "weekdays is required (non-empty) when recurrence is 'weekly'.",
    path: ["weekdays"],
  });

/** PATCH /reminders/:id — edit an existing reminder (text / time / status). */
export async function updateReminder(req: Request, id: string): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest("Body must be valid JSON.");
  }
  const parsed = UpdateBody.safeParse(raw);
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const set: Partial<{
    text: string;
    dueAt: Date;
    status: string;
    recurrence: string;
    weekdays: number[] | null;
  }> = {};
  if (parsed.data.text !== undefined) set.text = parsed.data.text;
  if (parsed.data.dueAt !== undefined) set.dueAt = new Date(parsed.data.dueAt);
  if (parsed.data.status !== undefined) set.status = parsed.data.status;
  if (parsed.data.recurrence !== undefined) {
    set.recurrence = parsed.data.recurrence;
    if (parsed.data.recurrence !== "weekly") {
      // Non-weekly recurrence never carries weekdays.
      set.weekdays = null;
    } else if (parsed.data.weekdays !== undefined) {
      set.weekdays = parsed.data.weekdays;
    }
  } else if (parsed.data.weekdays !== undefined) {
    set.weekdays = parsed.data.weekdays;
  }

  const [updated] = await db
    .update(reminders)
    .set(set)
    .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
    .returning(reminderCols);

  if (!updated) {
    log.debug("reminder update: not found", { userId, reminderId: id });
    return notFound("Reminder not found.");
  }
  log.info("reminder updated", { userId, reminderId: id });
  return json(updated);
}

/** POST /reminders/:id/complete — mark a reminder done. Owner-scoped. */
export async function completeReminder(req: Request, id: string): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  const [updated] = await db
    .update(reminders)
    .set({ status: "done" })
    .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
    .returning({ id: reminders.id, status: reminders.status });

  if (!updated) {
    log.debug("reminder complete: not found", { userId, reminderId: id });
    return notFound("Reminder not found.");
  }
  log.info("reminder completed", { userId, reminderId: id });
  return json(updated);
}

/** DELETE /reminders/:id — cancel / undo. Soft (status='dismissed'), scoped to owner. */
export async function cancelReminder(req: Request, id: string): Promise<Response> {
  const userId = await authenticate(req);
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
