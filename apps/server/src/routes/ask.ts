import { z } from "zod";
import { answerQuestion } from "@repo/core";
import { authenticate } from "../auth";
import { badRequest, unauthorized, serverError } from "../http";

/**
 * POST /ask (spec 03 §1.2) — the recall/reason endpoint.
 *
 * Bearer auth, zod-validated body, streams the grounded answer as SSE tokens and
 * ends with a final { citations, confidence, mode } event. Runs spec 02 §3
 * (recall). Low confidence streams the honest refusal, never a fabrication.
 * All retrieval is scoped to the authenticated user_id.
 */

const AskBody = z.object({
  question: z.string().min(1, "question is required"),
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
  const { question } = parsed.data;

  // Understanding + retrieval + rerank happen up-front (may call the LLM and
  // throw). Streaming begins only once we have a grounded plan or a refusal.
  let result;
  try {
    result = await answerQuestion({ userId, question });
  } catch (err) {
    console.error("[server] /ask retrieval failed:", err);
    return serverError("Failed to answer question.");
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(sse(obj)));
      try {
        if (result.grounded) {
          for await (const chunk of result.textStream) {
            if (chunk) send({ type: "token", text: chunk });
          }
        } else {
          // Groundedness guard: stream the honest refusal verbatim.
          send({ type: "token", text: result.text });
        }
        send({
          type: "done",
          citations: result.citations,
          confidence: result.confidence,
          mode: result.mode,
        });
      } catch (err) {
        console.error("[server] /ask streaming failed:", err);
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
