import { z } from "zod";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { badRequest, unauthorized, serverError } from "../http";
import {
  createConversationForUser,
  streamConversationTurn,
} from "./conversations";

const log = createLogger("server:ask");

/**
 * POST /ask — thin shim (spec 02 §8).
 *
 * Creates a conversation implicitly, seeds optional client-replayed history as
 * turns, then streams via the durable turn pipeline. Mobile has migrated to
 * conversationId; this remains until older clients are gone.
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

export async function ask(req: Request): Promise<Response> {
  const userId = await authenticate(req);
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

  try {
    const conversationId = await createConversationForUser(userId, history);
    log.info("ask shim: created conversation", {
      userId,
      conversationId,
      historyTurns: history?.length ?? 0,
    });
    return await streamConversationTurn({
      userId,
      conversationId,
      question,
    });
  } catch (err) {
    log.error("ask shim failed", err as Error);
    return serverError();
  }
}
