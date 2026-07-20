import { generateObject } from "ai";
import { z } from "zod";
import { ingestionModel } from "../ai/models";

/**
 * The single structured-extraction schema (spec 02 §2).
 *
 * The ENTIRE extraction — temporal resolution + classification + entities +
 * facts + intent — is ONE `generateObject` call against the cheap ingestion
 * model. Never parse free-form text. This keeps cost per memory near-zero
 * (spec 02 §9, cost discipline).
 */
// Enums use .catch(...) so slightly-off values from proxy models (esp. Gemini
// via CLIProxy, which sometimes ignores strict json_schema) still parse into
// a valid Extraction instead of failing the whole memory.
const MEMORY_TYPES = [
  "episodic",
  "semantic",
  "preference",
  "intent",
  "reflection",
] as const;
const ENTITY_TYPES = [
  "person",
  "place",
  "org",
  "topic",
  "project",
  "event",
] as const;
const FACT_TYPES = ["semantic", "preference", "intent", "episodic"] as const;
const LOOP_KINDS = [
  "commitment",
  "unresolved_conflict",
  "upcoming_event",
  "goal",
  "thread",
] as const;

export const ExtractionSchema = z.object({
  // ISO 8601; resolved against the memory's createdAt + user timezone. null if
  // the memory carries no discernible event time (spec 02 §2.1).
  occurredAt: z.string().nullable().catch(null),
  types: z
    .array(z.enum(MEMORY_TYPES).catch("episodic"))
    .min(1)
    .catch(["episodic"]),
  entities: z
    .array(
      z.object({
        surface: z.string(), // as written ("Urhan")
        type: z.enum(ENTITY_TYPES).catch("topic"),
        canonicalGuess: z.string(), // normalized ("Urhan")
      }),
    )
    .catch([]),
  facts: z
    .array(
      z.object({
        subject: z.string(), // entity surface or "user"
        predicate: z.string(),
        object: z.string(),
        factText: z.string(), // natural-language atomic statement
        validFrom: z.string().nullable().catch(null),
        factType: z.enum(FACT_TYPES).catch("episodic"),
        confidence: z.number().min(0).max(1).catch(0.7),
      }),
    )
    .catch([]),
  intent: z
    .object({
      hasFutureAction: z.boolean().catch(false),
      dueAt: z.string().nullable().catch(null),
      text: z.string().nullable().catch(null),
    })
    .nullable()
    .catch(null),
  // Procedural memory is deliberately separate from a preference: it must tell
  // the system how to behave when a concrete situation occurs.
  standingRule: z
    .object({
      ruleText: z.string().min(1),
      triggerText: z.string().min(1),
    })
    .nullable()
    .catch(null),
  openLoops: z
    .array(
      z.object({
        kind: z.enum(LOOP_KINDS).catch("thread"),
        title: z.string().min(1),
        // An entity is optional in storage; preserve that distinction rather than
        // inventing a link when the memory does not name one.
        entityRef: z.string().nullable().catch(null),
        dueAt: z.string().nullable().catch(null),
      }),
    )
    .catch([]),
  resolvesLoop: z.string().min(1).nullable().catch(null),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

const SYSTEM_PROMPT = `You are the extraction stage of a personal memory system.
Given ONE raw memory the user deposited, produce a single structured extraction.

Rules:
- TEMPORAL: Resolve every relative time expression ("today", "last Tuesday", "yesterday")
  into an absolute ISO 8601 timestamp using the provided current date and timezone.
  occurredAt = when the event happened (may differ from when it was written). If the
  memory has no discernible event time, set occurredAt to null.
- CLASSIFY: types[] describes what kind of memory this is (at least one).
- ENTITIES: extract every distinct person / place / org / topic / project / event mentioned.
  surface = as written; canonicalGuess = a normalized canonical name.
  An EVENT is a bounded happening the user lives through or plans — a trip, a
  meeting, an appointment, a milestone, a hard conversation ("the Tokyo trip",
  "Yusuf's discharge", "the investor pitch"). Prefer "event" over "topic" when
  the thing has a time or an occurrence; use "topic" for concepts, subjects, and
  ideas with no occurrence.
- FACTS: decompose into the SMALLEST independently-true atomic statements. Each fact
  has subject (an entity surface, or "user" for the author), predicate, object, and a
  natural-language factText. A pure reflection may yield ZERO facts — that is fine.
  Set validFrom to the ISO time the fact became true, or null.
- INTENT: if the memory implies a future action ("call the bank Friday"), fill intent
  with a resolved absolute dueAt; otherwise set intent to null.
- STANDING RULE: set standingRule ONLY for an explicit conditional instruction about
  future behavior: "when I X, do/check Y". ruleText is the instruction faithfully
  stated; triggerText describes the situation in which it applies (not keywords).
  A taste, preference, aspiration, or one-off request is NOT a standing rule. If
  uncertain, return null.
- OPEN LOOPS: extract only explicitly unfinished commitments, unresolved conflicts,
  clearly dated upcoming events, or stated goals. Do not turn ordinary plans,
  preferences, or speculative possibilities into loops. entityRef is the named
  entity surface when one is explicit, otherwise null. Resolve dueAt to ISO 8601
  when it is explicit; otherwise null. Return [] when uncertain.
  Additionally, mark as a loop (kind "thread") any significant moment a good
  friend who heard this would want to know the outcome of or check in about
  later — something with emotional weight, stakes, or an outcome the user will
  live through (health situations, big attempts, hard conversations, meaningful
  firsts). Set dueAt only when a time is explicit or clearly implied. Ordinary
  logistics, routine activities, and trivia are NOT threads. When uncertain, do
  not mark one — a missed thread is cheaper than a nagging question. Do NOT
  enumerate categories or match keywords; judge it as a person would.
- RESOLVES LOOP: set resolvesLoop when this memory clearly says an existing
  unfinished matter was completed, settled, cancelled, or otherwise closed. This
  ALSO covers a prior COMMITMENT or intention the user is now deliberately
  changing, updating, reversing, or no longer holding ("actually I've decided to
  take the consulting work after all", "I changed my mind about going full-time
  on product", "that was a deliberate call"): a deliberate change closes the old
  commitment. It is a short faithful description of the closed/changed matter,
  not an inference. Do NOT set it for ordinary progress or for merely mentioning
  the topic again. Otherwise return null.
Never invent details not present in the memory.`;

export interface ExtractionContext {
  rawText: string;
  /** memory.createdAt — the "now" against which relative times resolve */
  createdAt: Date;
  /** IANA timezone from the user row (spec 02 §2.1) */
  timezone: string;
}

/** Format the write-time instant in the user's tz for the prompt. */
function formatNow(createdAt: Date, timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      dateStyle: "full",
      timeStyle: "long",
    });
    return `${fmt.format(createdAt)} (ISO: ${createdAt.toISOString()}, timezone: ${timezone})`;
  } catch {
    // Invalid tz string — fall back to UTC ISO so extraction still runs.
    return `${createdAt.toISOString()} (timezone: UTC)`;
  }
}

/**
 * Stage 2.1–2.4: the single structured-extraction call (spec 02 §2).
 * Pure-ish: takes a memory's text + context, returns the parsed Extraction.
 */
/** Strip markdown fences / extract first JSON object — proxy models often wrap. */
function stripJsonFences(text: string): string {
  let t = text.trim();
  const fenced = t.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  if (fenced?.[1]) t = fenced[1].trim();
  // If still not pure JSON, take outermost object
  if (!t.startsWith("{")) {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) t = t.slice(start, end + 1);
  }
  return t.trim();
}

export async function extract(ctx: ExtractionContext): Promise<Extraction> {
  const { object } = await generateObject({
    model: ingestionModel,
    schema: ExtractionSchema,
    system: SYSTEM_PROMPT,
    prompt: `Current date/time (write time): ${formatNow(ctx.createdAt, ctx.timezone)}

Raw memory:
"""
${ctx.rawText}
"""`,
    // CLIProxy + some Gemini models return ```json ... ``` or slightly invalid
    // JSON even when json_schema is requested. Repair before schema validation.
    experimental_repairText: async ({ text }) => stripJsonFences(text),
  });
  return object;
}
