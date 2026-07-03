import { z } from "zod";
import { answerQuestion } from "@repo/core";
import { authenticate } from "../auth";
import { badRequest, unauthorized } from "../http";

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
 *   { type: "error", message }
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
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const { question, history } = parsed.data;

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
      } catch (err) {
        console.error("[server] /ask failed:", err);
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
