import { streamText, tool, stepCountIs, hasToolCall, type ModelMessage } from "ai";
import { z } from "zod";
import { db, users, eq } from "@repo/db";
import { reasoningModel } from "../ai/models";
import { retrieveMemories } from "./search";
import { REFUSAL_TEXT, type Citation } from "./answer";

/**
 * The conversational Ask agent (spec 02 §3–§4, NEXT_FEATURES §1–2).
 *
 * Instead of one blind retrieval pass, the reasoning model drives a bounded
 * tool-use loop: it rewrites follow-ups into standalone queries using the
 * in-session history, searches its memories from as many angles as a hard
 * question needs, and either answers — grounded ONLY in what it retrieved — or
 * asks the user back when the question is genuinely ambiguous.
 *
 * The server stays stateless: `history` is the ephemeral transcript the client
 * replays each turn. Nothing is persisted here.
 */

export type AskMode = "recall" | "reason" | "clarify";

export interface AskHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/** A single visible step in the agent's trace (emitted live + summarised). */
export interface AskStep {
  kind: "search" | "clarify" | "synthesize";
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

function systemPrompt(now: Date, timezone: string): string {
  return `You are Yaadora, the user's second brain. When a question is actually about something in the user's life — an event, fact, person, preference, or anything they'd expect you to remember — you answer ONLY from their own captured memories, looked up with the search_memories tool. You never use outside knowledge and you never invent a memory.

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

Asking back (rare — prefer to infer):
- First resolve follow-ups from the conversation so far. A plain topic follow-up like "any about travelling?" or "what about work?" right after a broader question is NOT ambiguous — treat it as a fresh search on that topic and answer it. Don't ask the user what they mean.
- Only use the clarify tool when the question genuinely can't be answered without more info — multiple distinct people/things it could refer to, or a missing timeframe you truly can't infer. When you do, offer 2–4 concrete options drawn from the memories you found.
- When in doubt, search and answer rather than clarify.`;
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
  /** fired live for every step (search / clarify / synthesize) as it happens */
  onStep?: (step: AskStep) => void;
}): Promise<AskHandle> {
  const { userId, question, history = [], onStep } = params;
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

  // Shared, mutable state accumulated across tool calls (groundedness lives here).
  const citeMap = new Map<string, Citation>();
  const steps: AskStep[] = [];
  let searchCount = 0;
  let topRelevance = 0;

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
    system: systemPrompt(now, timezone),
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
      resolveResult({
        citations: clarified ? [] : Array.from(citeMap.values()),
        confidence: clarified ? 0 : topRelevance,
        mode,
        steps,
        clarifyOptions,
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
