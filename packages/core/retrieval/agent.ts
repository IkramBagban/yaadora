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
  return `You are Yaadora, the user's second brain. You answer ONLY from the user's own captured memories, which you look up with the search_memories tool. You never use outside knowledge and you never invent a memory.

Current date/time: ${formatNow(now, timezone)}

How to work:
- ALWAYS search before answering. Never answer from assumption.
- Use the conversation so far to resolve follow-ups. Rewrite context-dependent questions ("what about last month?", "who else was there?") into a STANDALONE search query before calling the tool.
- For a hard question, search more than once: check one angle, and if you still lack a piece, search another angle, THEN answer. Don't stop at the first shallow match.
- Pass a natural-language timeframe (e.g. "last month", "in March 2026") when the question is time-bound.

Answering:
- Ground every statement in what search_memories actually returned. If the results don't support an answer, say exactly: "${REFUSAL_TEXT}"
- Write in natural prose in the second person. Do NOT add citation tags or "(memory ...)" — sources are shown to the user separately.
- Be warm, concise and direct.

Asking back (important):
- If the question is genuinely ambiguous — multiple people/things it could mean, or a missing timeframe you can't infer — do NOT guess. Call the clarify tool with a short question, and when your searches surfaced concrete candidates (e.g. two different people it could be), include 2–4 of them as options drawn from the memories you found.
- Only clarify when it truly matters; if you can reasonably answer, just answer.`;
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
          .describe("a standalone search query (resolve follow-ups first)"),
        timeframe: z
          .string()
          .nullish()
          .describe('optional natural-language timeframe, e.g. "last month"'),
      }),
      execute: async ({ query, timeframe }) => {
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
