import { z } from "zod";
import { answerQuestion, captureFromConversation } from "@repo/core";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { badRequest, unauthorized } from "../http";

const log = createLogger("server:ask");

/**
 * POST /ask (spec 03 §1.2, NEXT_FEATURES §1–2) — the conversational recall/reason
 * endpoint.
 *
 * Bearer auth, zod-validated body. The SSE response opens immediately and the
 * agent's trace streams LIVE as it works — `step` frames as it searches, then
 * `token` frames as it writes — killing the dead pre-answer gap. Ends with a
 * `done` frame carrying citations, confidence, mode and the step trace.
 *
 * The server stays STATELESS: `history` is the ephemeral in-session transcript
 * the client replays each turn. Nothing is persisted. All retrieval is scoped to
 * the authenticated user_id; low confidence streams the honest refusal.
 *
 * SSE frames (`data: <json>\n\n`):
 *   { type: "step", kind, label, query?, count? }
 *   { type: "token", text }
 *   { type: "done", citations, confidence, mode, steps, clarifyOptions? }
 *   { type: "captured", memoryId, statement }   // when the turn was worth remembering
 *   { type: "reminder_suggestion", text, dueAt, sourceMemoryId? }  // one-tap chip
 *   { type: "error", message }
 *
 * Conversational capture (docs/architecture/02) runs AFTER the answer has fully
 * streamed, so recall latency is untouched. It's best-effort: a salience gate
 * decides whether the user's turn is worth remembering, and only keepers are
 * persisted + surfaced via a `captured` frame (with one-tap undo on the client).
 */

const MAX_HISTORY = 12;
const MAX_TURN_CHARS = 4000;

const AskBody = z.object({
  question: z.string().min(1, "question is required").max(MAX_TURN_CHARS),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(MAX_TURN_CHARS),
      }),
    )
    .max(MAX_HISTORY)
    .optional(),
});

/** Serialize an SSE `data:` frame. */
function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export async function ask(req: Request): Promise<Response> {
  const userId = authenticate(req);
  if (!userId) return unauthorized();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest("Body must be valid JSON.");
  }
  const parsed = AskBody.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("; ");
    log.debug("ask rejected: invalid body", { message });
    return badRequest(message);
  }
  const { question, history } = parsed.data;

  log.info("ask received", {
    userId,
    questionChars: question.length,
    historyTurns: history?.length ?? 0,
  });
  const startedAt = Date.now();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(sse(obj)));
        } catch {
          // controller already closed (client disconnected) — ignore.
        }
      };

      try {
        // Steps stream live via onStep, as the agent searches (before tokens).
        const handle = await answerQuestion({
          userId,
          question,
          history,
          onStep: (step) => send({ type: "step", ...step }),
        });

        for await (const chunk of handle.textStream) {
          if (chunk) send({ type: "token", text: chunk });
        }

        const final = await handle.result;
        send({
          type: "done",
          citations: final.citations,
          confidence: final.confidence,
          mode: final.mode,
          steps: final.steps,
          ...(final.clarifyOptions ? { clarifyOptions: final.clarifyOptions } : {}),
        });
        log.info("ask completed", {
          userId,
          mode: final.mode,
          confidence: final.confidence,
          citations: final.citations.length,
          steps: final.steps.length,
          ms: Date.now() - startedAt,
        });

        // Conversational capture — only the user's own turn, only after the
        // answer is delivered. Best-effort: never throws (see core impl).
        const capture = await captureFromConversation({
          userId,
          userText: question,
          history,
        });
        if (capture.captured) {
          send({
            type: "captured",
            memoryId: capture.memoryId,
            statement: capture.statement,
          });
        }
        // A time-bound future action → a one-tap reminder chip. Transient until
        // the user confirms it (POST /reminders/confirm); dismissing is free.
        if (capture.suggestedReminder) {
          send({ type: "reminder_suggestion", ...capture.suggestedReminder });
        }
      } catch (err) {
        log.error("ask failed", err as Error);
        send({ type: "error", message: "Answer generation failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
