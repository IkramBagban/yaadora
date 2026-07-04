import { generateObject } from "ai";
import { z } from "zod";
import { db, memories } from "@repo/db";
import { createLogger } from "@repo/logger";
import { fastModel } from "../ai/models";
import { enqueueIngestion } from "../queues";

const log = createLogger("ingestion:capture");

/**
 * Conversational capture (docs/architecture/02) — turn things the user says in
 * /ask into memories, WITHOUT saving everything. A brain doesn't consolidate
 * every passing thought; only the salient, durable, novel bits survive. So this
 * runs a cheap "salience gate" over each USER turn and only the keepers proceed
 * to the normal ingestion pipeline (source="conversation").
 *
 * Two hard rules that keep it safe:
 *  - Only the user's own turn is ever considered. The assistant's replies and
 *    any facts it just recalled are never captured — that would be a feedback
 *    loop that re-saves memory back into itself.
 *  - Capture is best-effort and fully decoupled from the answer: it runs AFTER
 *    the response has streamed, and any failure is swallowed (never breaks /ask).
 */

const GATE_CATEGORIES = [
  "fact", // a durable fact about the user or their world
  "preference", // a like/dislike/habit
  "event_past", // something that happened (episodic, past)
  "event_future", // a plan / commitment (episodic, prospective)
  "relationship", // a person and their relation to the user
  "decision", // a choice the user made
  "none", // nothing worth remembering
] as const;

export const CaptureGateSchema = z.object({
  // The core judgement: is there anything here worth remembering long-term?
  worthRemembering: z.boolean(),
  category: z.enum(GATE_CATEGORIES),
  // One short reason (for logs / debugging the gate's behaviour).
  reason: z.string(),
  // A self-contained, context-resolved restatement to store as the memory.
  // Conversation turns are fragments ("yeah, and I moved there in May") — this
  // resolves pronouns/ellipsis against the recent turns so the memory stands on
  // its own later. null when worthRemembering is false.
  statement: z.string().nullable(),
  // If the turn implies a concrete, time-bound future action ("call the bank
  // Friday", "flight to Tokyo next week"), propose a reminder the user can save
  // in one tap. text = short imperative; dueAt = absolute ISO 8601 resolved
  // against the current datetime. null when there's no actionable time.
  suggestedReminder: z
    .object({ text: z.string(), dueAt: z.string() })
    .nullable(),
});

export type CaptureGate = z.infer<typeof CaptureGateSchema>;

const SYSTEM_PROMPT = `You are the memory-capture gate of a personal "second brain". You read the user's LATEST message in a chat and decide whether it contains anything worth remembering about them long-term. Think like human memory: almost everything said is transient and should NOT be stored — only the durable, personal, and novel is worth keeping.

DO capture (worthRemembering = true) when the user states, in passing or directly:
- a durable fact about themselves or their world (job, location, what they're building, health, family)
- a preference, habit, like/dislike ("I hate early meetings")
- a relationship ("my manager is Priya now")
- a decision they made
- something that HAPPENED to them (a past event / experience)
- a PLAN or commitment ("I'm flying to Tokyo next week", "I'll ship the beta Friday")

DO NOT capture (worthRemembering = false, category "none") when the message is:
- a question to you, or a request to recall ("what do you know about me?", "any about travelling?")
- small talk, greetings, thanks, acknowledgements ("cool", "ok thanks")
- a fleeting/transient state with no lasting value ("I'm a bit bored right now")
- a hypothetical, or a command/instruction to you
- ONLY repeating something you already told them (they're not adding new information)

When worthRemembering is true, write "statement": a single, self-contained sentence in the third person about the user that captures the durable info, with pronouns and context resolved using the recent turns (e.g. "The user is flying to Tokyo the week of ..."). Keep it faithful — never invent details. When false, set statement to null.

REMINDER: separately, if the message implies a concrete future action or commitment WITH a time you can pin down ("call the bank Friday", "flight to Tokyo next Tuesday", "ship the beta at 5pm"), set "suggestedReminder" to { text: a short imperative like "Call the bank", dueAt: the absolute ISO 8601 instant resolved from the current datetime given below }. Only when there is a genuine, time-bound action — NOT for vague someday wishes or past events. Otherwise set suggestedReminder to null. (suggestedReminder and worthRemembering are independent — a future plan is usually both.)

Prefer NOT to capture when unsure — a missed capture is cheaper than noise.`;

/** Trim recent turns into a compact context block for pronoun/ellipsis resolution. */
function formatContext(
  history: { role: "user" | "assistant"; content: string }[],
): string {
  if (!history.length) return "(no earlier turns)";
  return history
    .slice(-6)
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
    .join("\n");
}

/** Validate a proposed reminder: real, parseable time that isn't already stale.
 * Returns a normalised {text,dueAt} or undefined (drop the suggestion). */
function validateReminder(
  s: CaptureGate["suggestedReminder"],
  now: Date,
): { text: string; dueAt: string } | undefined {
  if (!s?.text?.trim() || !s.dueAt) return undefined;
  const d = new Date(s.dueAt);
  if (Number.isNaN(d.getTime())) return undefined;
  // Drop clearly-stale times (>1h in the past) — usually a mis-resolution.
  if (d.getTime() < now.getTime() - 3_600_000) return undefined;
  return { text: s.text.trim(), dueAt: d.toISOString() };
}

export interface CaptureResult {
  captured: boolean;
  memoryId?: string;
  statement?: string;
  category?: (typeof GATE_CATEGORIES)[number];
  reason?: string;
  /** A proposed reminder the client shows as a one-tap chip. Transient until the
   * user confirms it (POST /reminders/confirm); dismissing costs nothing. */
  suggestedReminder?: { text: string; dueAt: string; sourceMemoryId?: string };
}

/**
 * Run the salience gate over the user's latest turn and, if it's a keeper,
 * insert a memory (source="conversation") + enqueue the normal ingestion job.
 * Never throws — returns { captured:false } on any problem.
 */
export async function captureFromConversation(params: {
  userId: string;
  userText: string;
  history?: { role: "user" | "assistant"; content: string }[];
  now?: Date;
}): Promise<CaptureResult> {
  const { userId, userText, history = [] } = params;
  const now = params.now ?? new Date();

  const text = userText.trim();
  // A one-word turn almost never carries a durable fact; skip the LLM entirely.
  if (text.length < 8) return { captured: false };

  try {
    const { object: gate } = await generateObject({
      model: fastModel,
      schema: CaptureGateSchema,
      system: SYSTEM_PROMPT,
      prompt: `Current datetime (resolve any relative times against this): ${now.toISOString()} (UTC)

Recent turns (context only — do NOT capture from these):
${formatContext(history)}

User's LATEST message (decide about THIS):
"""
${text}
"""`,
    });

    // A reminder can be proposed independently of whether we store a memory.
    const reminder = validateReminder(gate.suggestedReminder, now);

    if (!gate.worthRemembering || !gate.statement?.trim()) {
      log.debug("capture gate: skip", {
        userId,
        category: gate.category,
        reason: gate.reason,
        reminder: Boolean(reminder),
      });
      return {
        captured: false,
        category: gate.category,
        reason: gate.reason,
        ...(reminder ? { suggestedReminder: reminder } : {}),
      };
    }

    // Keeper → store the standalone statement as the episodic memory and let the
    // existing pipeline (extract → link → facts → supersession) take over.
    const [created] = await db
      .insert(memories)
      .values({
        userId,
        rawText: gate.statement.trim(),
        source: "conversation",
        status: "pending",
      })
      .returning({ id: memories.id });

    if (!created) {
      log.error("capture insert returned no row", { userId });
      return { captured: false };
    }

    try {
      await enqueueIngestion(created.id);
    } catch (err) {
      // Row is durably stored (status 'pending') and can be re-enqueued later —
      // don't fail the capture.
      log.warn("capture enqueue failed (row persisted)", err as Error);
    }

    log.info("captured from conversation", {
      userId,
      memoryId: created.id,
      category: gate.category,
    });
    return {
      captured: true,
      memoryId: created.id,
      statement: gate.statement.trim(),
      category: gate.category,
      reason: gate.reason,
      ...(reminder
        ? { suggestedReminder: { ...reminder, sourceMemoryId: created.id } }
        : {}),
    };
  } catch (err) {
    // Capture must NEVER break the ask flow.
    log.warn("conversation capture failed (ignored)", err as Error);
    return { captured: false };
  }
}
