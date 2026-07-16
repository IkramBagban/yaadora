import { streamText, tool, stepCountIs, hasToolCall, type ModelMessage } from "ai";
import { z } from "zod";
import {
  db,
  users,
  reminders,
  rules,
  surfacings,
  eq,
  sql,
} from "@repo/db";
import { createLogger } from "@repo/logger";
import { reasoningModel } from "../ai/models";
import { retrieveMemories } from "./search";
import { REFUSAL_TEXT, type Citation } from "./answer";
import {
  assembleContextPack,
  buildContextPackText,
  type NudgeDirective,
  type RuleSlot,
} from "./context-pack";
import {
  matchStandingRules,
  shortRuleName,
  type MatchedRule,
} from "./rule-matcher";
import {
  evaluateAndRecord,
  loadAwarenessCandidates,
  loadPriorSurfacingIds,
  markSurfacingEngaged,
  runAwarenessPass,
} from "../proactive";

const log = createLogger("retrieval:agent");

/**
 * The conversational Ask agent (spec 02 §3–§4, NEXT_FEATURES §1–2).
 *
 * Instead of one blind retrieval pass, the reasoning model drives a bounded
 * tool-use loop: it rewrites follow-ups into standalone queries using the
 * in-session history, searches its memories from as many angles as a hard
 * question needs, and either answers — grounded ONLY in what it retrieved — or
 * asks the user back when the question is genuinely ambiguous.
 *
 * The server stays RAM-stateless: history is loaded from durable turns (or the
 * client-replayed transcript for the /ask shim). Nothing is held in process RAM.
 */

export type AskMode = "recall" | "reason" | "clarify";

export interface AskHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/** A single visible step in the agent's trace (emitted live + summarised). */
export interface AskStep {
  kind: "search" | "clarify" | "synthesize" | "reminder" | "rule";
  label: string;
  query?: string;
  count?: number;
}

export interface AskResult {
  citations: Citation[];
  confidence: number;
  mode: AskMode;
  steps: AskStep[];
  /** disambiguation candidates when mode === "clarify" (2–4 short strings) */
  clarifyOptions?: string[];
  /** standing rules applied this turn (meta.ruleIdsApplied) */
  ruleIdsApplied: string[];
  /**
   * Ledger rows for this turn: rule_applied + any woven nudge (meta.surfacingIds).
   * Spec 02 §2.1 / §5.4.
   */
  surfacingIds: string[];
  /**
   * When a proactive nudge was woven into the reply: the ledger id + evidence
   * memory ids for the mobile receipt affordance (SSE `done` payload).
   */
  nudge?: { surfacingId: string; evidence: string[] } | null;
}

export interface AskHandle {
  /** the answer / clarifying question / refusal, streamed token by token */
  textStream: AsyncIterable<string>;
  /** resolves once the stream completes, with the final grounded metadata */
  result: Promise<AskResult>;
}

/** Max agent steps (searches + the final answer) before we force a stop. */
const MAX_STEPS = 6;

function formatNow(now: Date, timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      dateStyle: "full",
      timeStyle: "short",
    });
    return `${fmt.format(now)} (timezone: ${timezone})`;
  } catch {
    return `${now.toISOString()} (timezone: UTC)`;
  }
}

function systemPrompt(now: Date, timezone: string, contextPackText = ""): string {
  const prompt = `You are Yaadora, the user's second brain. When a question is actually about something in the user's life — an event, fact, person, preference, or anything they'd expect you to remember — you answer ONLY from their own captured memories, looked up with the search_memories tool. You never use outside knowledge and you never invent a memory.

Current date/time: ${formatNow(now, timezone)}

Deciding whether to search (important — most turns don't need it):
- Call search_memories ONLY when answering requires recalling something specific from the user's past that you don't already have from this conversation.
- Do NOT search for greetings, small talk, thanks, or questions about YOU the assistant / what you can do ("hi", "how are you", "what can you help with") — just reply directly, briefly and naturally.
- DO search whenever the user asks about their own life, profile, or history — including broad ones like "what do you know about me?", "tell me about myself", "what are my projects?", "what do I care about?". These are exactly the questions your memory exists to answer, so look before you answer. NEVER state that you have no memories, or that nothing is saved yet, unless you have actually run search_memories on this turn and it came back empty. Don't assume the store is empty — check.
- Do NOT search when the user is only asking you to explain or clarify something YOU just said ("what hobby?", "what do you mean?", "which one?"). That's about your own previous message, not their memories — answer it from the conversation itself. If your earlier wording was generic and pointed at nothing specific, say so plainly rather than searching to try to back it up.
- Don't search again for something the earlier turns already resolved — reuse what you already retrieved this conversation.
- Use the conversation so far to resolve follow-ups. Rewrite context-dependent questions ("what about last month?", "who else was there?") into a STANDALONE search query before calling the tool.
- For a hard question, search more than once if one angle isn't enough: check one angle, and if you still lack a piece, search another, THEN answer. Don't loop past what the question actually needs.
- Pass a natural-language timeframe (e.g. "last month", "in March 2026") when the question is time-bound.
- CRITICAL: When calling search_memories, only output the arguments object: {"query": "..."}. Do NOT wrap it in a function name block or output any extra keys like "name" or "arguments". Just output the raw arguments.

Not implying knowledge you don't have (important):
- When you reply WITHOUT searching, keep it genuinely generic. Do NOT phrase suggestions as if you know specifics about this user — no "that hobby you've been putting off", "the book you've been meaning to read", "that project you keep mentioning". You haven't looked anything up, so don't imply you have.
- Suggest things in the open instead: "you could pick up a hobby you've been curious about", "maybe start a book you've been eyeing". If you want to reference something specific from their life, search for it first — otherwise keep it general so a follow-up like "what hobby?" never catches you in a claim you can't support.

Answering — talk like a friend who remembers, not a database:
- Surface the memory, hide the plumbing. State what you know directly. Do NOT narrate the retrieval or tack on meta-closers like "that's what I have on file", "the information I have on you", or "that's the gist of the memories I've found." Just tell them the thing.
- Default to warm, conversational prose in the second person. Do NOT format recall like a resume: avoid bulleted lists and **bold field labels** ("Name:", "Location:", "Profession:") unless the user explicitly asks for a list or a structured overview. Weave the facts into sentences the way a person recalling them would.
- Match the user's energy and length. A short question gets a short answer; a greeting gets a warm one-liner with no lookup.
- Ground every claim about the user's life in what search_memories actually returned. Only reference the memory layer in the NEGATIVE case: when you searched and found nothing, say so plainly and vary the wording naturally — "nothing about that saved yet", "I don't have anything on that", "you haven't told me about that." Never invent or guess a memory to fill a gap.
- For pure conversational turns (no search performed), just respond naturally — the groundedness rule only applies to memory-derived claims, not to a greeting or to explaining your own earlier wording.
- Do NOT add citation tags or "(memory ...)" — sources are shown to the user separately.

Standing rules (context pack):
- Standing rules listed in the context pack override generic behavior for the matched task and must be applied VISIBLY — the rule shapes the answer itself, it is not just mentioned.
- If a rule lists explicit check questions or criteria, address EACH one by name in the answer (as short headed sections or a clear checklist) so the user can see every criterion applied. Do not substitute a generic writing review that only vaguely nods at the rule.

Setting reminders:
- You have a set_reminder tool. Use it ONLY when the user explicitly asks to be reminded or to set/schedule a reminder ("remind me to …", "set a reminder for …"). Resolve the time to an absolute moment from the current date/time above, call set_reminder(text, dueAt), then confirm in one short line (e.g. "Done — I'll remind you Sunday at 3 PM."). If they ask for a reminder but give no usable time, ask for the time instead of guessing.
- Do NOT call set_reminder for things the user only mentions in passing ("I have a meeting Sunday") — those are handled separately as a suggestion. Only act when they actually ask you to set one.

Asking back (rare — prefer to infer):
- First resolve follow-ups from the conversation so far. A plain topic follow-up like "any about travelling?" or "what about work?" right after a broader question is NOT ambiguous — treat it as a fresh search on that topic and answer it. Don't ask the user what they mean.
- Only use the clarify tool when the question genuinely can't be answered without more info — multiple distinct people/things it could refer to, or a missing timeframe you truly can't infer. When you do, offer 2–4 concrete options drawn from the memories you found.
- When in doubt, search and answer rather than clarify.`;
  return contextPackText
    ? `${prompt}\n--- BEGIN CONTEXT PACK ---\n${contextPackText}\n--- END CONTEXT PACK ---`
    : prompt;
}

/**
 * Record rule applications: bump apply_count/last_applied_at and write
 * `rule_applied` ledger rows (exempt from nudge budgets — spec 02 §2.4).
 */
async function recordRuleApplications(params: {
  userId: string;
  conversationId?: string | null;
  matched: MatchedRule[];
  now: Date;
}): Promise<{ ruleIdsApplied: string[]; surfacingIds: string[] }> {
  const { userId, conversationId, matched, now } = params;
  const ruleIdsApplied: string[] = [];
  const surfacingIds: string[] = [];

  for (const rule of matched) {
    try {
      await db
        .update(rules)
        .set({
          lastAppliedAt: now,
          applyCount: sql`${rules.applyCount} + 1`,
        })
        .where(eq(rules.id, rule.id));

      const [row] = await db
        .insert(surfacings)
        .values({
          userId,
          kind: "rule_applied",
          subjectType: "rule",
          subjectId: rule.id,
          channel: "conversation",
          conversationId: conversationId ?? null,
          evidence: [rule.sourceMemory],
        })
        .returning({ id: surfacings.id });

      ruleIdsApplied.push(rule.id);
      if (row) surfacingIds.push(row.id);
    } catch (err) {
      log.warn("failed to record rule application", {
        ruleId: rule.id,
        err: err as Error,
      });
    }
  }

  return { ruleIdsApplied, surfacingIds };
}

/**
 * Answer a question conversationally (spec 02 §3–4). Returns a handle whose
 * `textStream` yields the answer / clarifying question / refusal, while `onStep`
 * fires live as the agent searches — so the server can stream the trace during
 * retrieval and kill the dead pre-answer gap. `result` settles at the end with
 * grounded citations, confidence, mode and the step trace.
 */
export async function answerQuestion(params: {
  userId: string;
  question: string;
  history?: AskHistoryTurn[];
  now?: Date;
  timezone?: string;
  /** durable conversation id for rule_applied ledger rows */
  conversationId?: string | null;
  /** fired live for every step (search / clarify / synthesize / rule) as it happens */
  onStep?: (step: AskStep) => void;
}): Promise<AskHandle> {
  const { userId, question, history = [], onStep, conversationId } = params;
  const now = params.now ?? new Date();

  let timezone = params.timezone;
  if (!timezone) {
    const [user] = await db
      .select({ timezone: users.timezone })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    timezone = user?.timezone ?? "UTC";
  }

  const previousUserTurn =
    [...history].reverse().find((h) => h.role === "user")?.content ?? null;

  // Pack SQL + rule matcher + awareness pass run concurrently so matching /
  // proactivity add no serial latency (spec 02 §5.1, §5.4). Failures are
  // non-fatal for the Ask turn.
  let matchedRules: MatchedRule[] = [];
  let contextPackText = "";
  /** Gate-approved nudge woven this turn (receipt affordance). */
  let wovenNudge: { surfacingId: string; evidence: string[] } | null = null;
  /** Nudge ledger id (merged into AskResult.surfacingIds with rules). */
  let nudgeSurfacingId: string | null = null;

  try {
    const recentTurns = history.slice(-6).map((h) => ({
      role: h.role,
      content: h.content,
    }));

    const [matched, pack, awarenessBundle] = await Promise.all([
      matchStandingRules({
        userId,
        userTurn: question,
        previousUserTurn,
      }),
      assembleContextPack({ userId, now }).catch((err) => {
        log.warn("context pack assembly failed; continuing without it", err as Error);
        return null;
      }),
      // Awareness: load candidates + prior ids, then one fast-tier call ≤800ms.
      (async () => {
        try {
          const [candidates, priorSurfacingIds] = await Promise.all([
            loadAwarenessCandidates({ userId, now }),
            loadPriorSurfacingIds({ userId, conversationId }),
          ]);
          const awareness = await runAwarenessPass({
            userTurn: question,
            recentTurns,
            candidates,
            priorSurfacingIds,
          });
          return { awareness, candidates };
        } catch (err) {
          log.warn("awareness setup failed; continuing without nudge", err as Error);
          return null;
        }
      })(),
    ]);
    matchedRules = matched;

    // Reaction capture for last turn's nudge (best-effort).
    if (awarenessBundle?.awareness.engagedWithPrior) {
      void markSurfacingEngaged(awarenessBundle.awareness.engagedWithPrior).catch(
        (err) => log.warn("failed to mark surfacing engaged", err as Error),
      );
    }

    // Candidate → gates → approved: pending ledger row + pack directive.
    let nudgeDirective: NudgeDirective | null = null;
    const aw = awarenessBundle?.awareness;
    if (aw?.candidate && !aw.timedOut) {
      try {
        const gated = await evaluateAndRecord({
          userId,
          conversationId,
          candidate: aw.candidate,
          seam: aw.seam,
          channel: "conversation",
          now,
        });
        if (gated.approved && gated.surfacingId) {
          nudgeDirective = {
            text: aw.candidate.oneLineNudge,
            evidence: aw.candidate.evidence,
          };
          wovenNudge = {
            surfacingId: gated.surfacingId,
            evidence: aw.candidate.evidence,
          };
          nudgeSurfacingId = gated.surfacingId;
        }
      } catch (err) {
        log.warn("nudge gate/record failed; continuing without nudge", err as Error);
      }
    }

    const ruleSlots: RuleSlot[] = matchedRules.map((r) => ({
      id: r.id,
      ruleText: r.ruleText,
    }));

    if (pack) {
      // Re-budget with matched rules + optional nudge (renderNudge already
      // present; budget contract unchanged — rules > nudge > loops… — §4).
      const { text } = buildContextPackText({
        profile: pack.profile,
        weekDigest: pack.weekDigest,
        loops: pack.loops,
        rules: ruleSlots,
        nudge: nudgeDirective,
      });
      contextPackText = text;
    } else if (matchedRules.length || nudgeDirective) {
      const { text } = buildContextPackText({
        profile: null,
        weekDigest: null,
        loops: [],
        rules: ruleSlots,
        nudge: nudgeDirective,
      });
      contextPackText = text;
    }
    // Extra force when rules matched: criteria must structure the answer.
    if (matchedRules.length && contextPackText) {
      contextPackText +=
        "\n\nApply the standing rule(s) above as the backbone of your reply. " +
        "If a rule names check questions or criteria, answer them one by one " +
        "(use the rule's own wording as short headings) before any other advice.";
    }
  } catch (err) {
    log.warn("pack/matcher/awareness setup failed; continuing without pack", err as Error);
  }

  // Shared, mutable state accumulated across tool calls (groundedness lives here).
  const citeMap = new Map<string, Citation>();
  const steps: AskStep[] = [];
  let searchCount = 0;
  let topRelevance = 0;

  // Emit rule steps before the main agent so the live trace shows them.
  for (const rule of matchedRules) {
    const step: AskStep = {
      kind: "rule",
      label: `Applying your rule: ${shortRuleName(rule)}`,
    };
    steps.push(step);
    onStep?.(step);
  }

  // Ledger + apply counters (exempt from nudge budgets).
  const applied =
    matchedRules.length > 0
      ? await recordRuleApplications({
          userId,
          conversationId,
          matched: matchedRules,
          now,
        })
      : { ruleIdsApplied: [] as string[], surfacingIds: [] as string[] };

  const tools = {
    search_memories: tool({
      description:
        "Search the user's own memories. Returns the most relevant memories/facts with dates. Call it once per angle; rewrite follow-ups into standalone queries first.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("a standalone search query (resolve follow-ups first)")
          .optional(),
        timeframe: z
          .string()
          .nullish()
          .describe('optional natural-language timeframe, e.g. "last month"'),
        name: z.string().optional(),
        arguments: z
          .object({
            query: z.string().optional(),
            timeframe: z.string().nullish(),
          })
          .optional(),
      }),
      execute: async (args) => {
        const query = (args.arguments?.query ?? args.query ?? "").trim();
        const timeframe = args.arguments?.timeframe ?? args.timeframe;

        if (!query) {
          return { found: 0, results: [], note: "No query provided." };
        }

        searchCount += 1;
        // Live: "searching …" appears the instant the tool starts.
        onStep?.({ kind: "search", label: query, query });

        const outcome = await retrieveMemories({
          userId,
          query,
          timeframe: timeframe ?? null,
          now,
          timezone: timezone as string,
        });

        for (const c of outcome.citations) {
          if (!citeMap.has(c.memoryId)) citeMap.set(c.memoryId, c);
        }
        topRelevance = Math.max(topRelevance, outcome.topRelevance);

        // Live update + record the completed step (now with a count).
        const step: AskStep = {
          kind: "search",
          label: query,
          query,
          count: outcome.hits.length,
        };
        steps.push(step);
        onStep?.(step);

        if (!outcome.hits.length) {
          return { found: 0, results: [], note: "No memories matched." };
        }
        return {
          found: outcome.hits.length,
          results: outcome.hits.map((h) => ({
            memoryId: h.memoryId,
            occurredAt: h.occurredAt,
            text: h.snippet,
          })),
        };
      },
    }),
    set_reminder: tool({
      description:
        'Create a reminder when the user EXPLICITLY asks to be reminded or to set/schedule one (e.g. "remind me to call mom tomorrow at 6pm", "set a reminder for the dentist Monday 9am"). Resolve the time to an absolute ISO 8601 instant using the current date/time in the system prompt. Do NOT use this for things the user merely mentions in passing — only when they actually ask you to set a reminder.',
      inputSchema: z.object({
        text: z.string().describe('short imperative, e.g. "Call mom"'),
        dueAt: z
          .string()
          .describe("absolute ISO 8601 datetime for when to remind"),
      }),
      execute: async ({ text, dueAt }) => {
        const due = new Date(dueAt);
        if (Number.isNaN(due.getTime())) {
          return { ok: false, error: "Could not resolve a valid time." };
        }
        const [created] = await db
          .insert(reminders)
          .values({
            userId,
            text: text.trim(),
            dueAt: due,
            origin: "manual",
            status: "pending",
          })
          .returning({ id: reminders.id, dueAt: reminders.dueAt });

        const step: AskStep = {
          kind: "reminder",
          label: `Reminder set: ${text.trim()}`,
        };
        steps.push(step);
        onStep?.(step);

        // Return ONLY JSON-serializable primitives: a Date here breaks the tool
        // result's ModelMessage schema and fails the next agent step.
        return created
          ? { ok: true, reminderId: created.id, dueAt: due.toISOString() }
          : { ok: false, error: "Failed to save the reminder." };
      },
    }),
    clarify: tool({
      description:
        "Ask the user ONE short clarifying question instead of answering, when the question is genuinely ambiguous. Include concrete options drawn from memories you found when there are distinct candidates.",
      inputSchema: z.object({
        question: z.string().describe("the short clarifying question to ask"),
        options: z
          .array(z.string())
          .min(2)
          .max(4)
          .nullish()
          .describe("2–4 concrete disambiguation candidates from memory"),
      }),
      // No execute: a terminal client tool. `hasToolCall('clarify')` stops the loop.
    }),
  };

  const messages: ModelMessage[] = [
    ...history.map((h) => ({ role: h.role, content: h.content }) as ModelMessage),
    { role: "user", content: question },
  ];

  const stream = streamText({
    model: reasoningModel,
    system: systemPrompt(now, timezone, contextPackText),
    messages,
    tools,
    stopWhen: [stepCountIs(MAX_STEPS), hasToolCall("clarify")],
  });

  let resolveResult!: (r: AskResult) => void;
  const result = new Promise<AskResult>((res) => {
    resolveResult = res;
  });

  async function* gen(): AsyncGenerator<string> {
    let mode: AskMode = "recall";
    let clarifyOptions: string[] | undefined;
    let synthesized = false;
    let clarified = false;
    let produced = false;

    const finalize = () => {
      if (!clarified) mode = searchCount > 1 ? "reason" : "recall";
      const surfacingIds = [
        ...applied.surfacingIds,
        ...(nudgeSurfacingId ? [nudgeSurfacingId] : []),
      ];
      resolveResult({
        citations: clarified ? [] : Array.from(citeMap.values()),
        confidence: clarified ? 0 : topRelevance,
        mode,
        steps,
        clarifyOptions,
        ruleIdsApplied: applied.ruleIdsApplied,
        surfacingIds,
        nudge: wovenNudge,
      });
    };

    try {
      for await (const part of stream.fullStream) {
        if (part.type === "text-delta") {
          if (!synthesized) {
            synthesized = true;
            const s: AskStep = { kind: "synthesize", label: "Writing the answer" };
            steps.push(s);
            onStep?.(s);
          }
          if (part.text) {
            produced = true;
            yield part.text;
          }
        } else if (part.type === "tool-call" && part.toolName === "clarify") {
          clarified = true;
          mode = "clarify";
          const input = part.input as {
            question: string;
            options?: string[] | null;
          };
          clarifyOptions = input.options ?? undefined;
          const s: AskStep = { kind: "clarify", label: "Asking to clarify" };
          steps.push(s);
          onStep?.(s);
          if (input.question) {
            produced = true;
            yield input.question;
          }
        } else if (part.type === "error") {
          throw (part as { error?: unknown }).error ?? new Error("stream error");
        }
      }

      // Groundedness fallback: the model emitted nothing usable → refuse honestly.
      if (!produced) yield REFUSAL_TEXT;
      finalize();
    } catch (err) {
      // Resolve (never reject) so an ignored `result` can't become an unhandled
      // rejection; then surface the error to the textStream consumer.
      finalize();
      throw err;
    }
  }

  return { textStream: gen(), result };
}
