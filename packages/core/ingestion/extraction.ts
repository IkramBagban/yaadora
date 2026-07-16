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
export const ExtractionSchema = z.object({
  // ISO 8601; resolved against the memory's createdAt + user timezone. null if
  // the memory carries no discernible event time (spec 02 §2.1).
  occurredAt: z.string().nullable(),
  types: z
    .array(
      z.enum(["episodic", "semantic", "preference", "intent", "reflection"]),
    )
    .min(1),
  entities: z.array(
    z.object({
      surface: z.string(), // as written ("Urhan")
      type: z.enum(["person", "place", "org", "topic", "project"]),
      canonicalGuess: z.string(), // normalized ("Urhan")
    }),
  ),
  facts: z.array(
    z.object({
      subject: z.string(), // entity surface or "user"
      predicate: z.string(),
      object: z.string(),
      factText: z.string(), // natural-language atomic statement
      validFrom: z.string().nullable(),
      factType: z.enum(["semantic", "preference", "intent", "episodic"]),
      confidence: z.number().min(0).max(1),
    }),
  ),
  intent: z
    .object({
      hasFutureAction: z.boolean(),
      dueAt: z.string().nullable(),
      text: z.string().nullable(),
    })
    .nullable(),
  // Procedural memory is deliberately separate from a preference: it must tell
  // the system how to behave when a concrete situation occurs.
  standingRule: z
    .object({
      ruleText: z.string().min(1),
      triggerText: z.string().min(1),
    })
    .nullable(),
  openLoops: z.array(
    z.object({
      kind: z.enum([
        "commitment",
        "unresolved_conflict",
        "upcoming_event",
        "goal",
      ]),
      title: z.string().min(1),
      // An entity is optional in storage; preserve that distinction rather than
      // inventing a link when the memory does not name one.
      entityRef: z.string().nullable(),
      dueAt: z.string().nullable(),
    }),
  ),
  resolvesLoop: z.string().min(1).nullable(),
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
- ENTITIES: extract every distinct person / place / org / topic / project mentioned.
  surface = as written; canonicalGuess = a normalized canonical name.
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
- RESOLVES LOOP: set resolvesLoop only when this memory clearly says an existing
  unfinished matter was completed, settled, cancelled, or otherwise closed. It is
  a short faithful description of the closed matter, not an inference. Otherwise
  return null.
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
  });
  return object;
}
