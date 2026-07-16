import { z } from "zod";
import { answerQuestion, captureFromConversation } from "@repo/core";
import {
  db,
  conversations,
  conversationTurns,
  eq,
  and,
  desc,
  gte,
  sql,
} from "@repo/db";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { badRequest, json, notFound, unauthorized, serverError } from "../http";

const log = createLogger("server:conversations");

/**
 * Durable conversations (spec 02 §2.1, §8; P0 item 2).
 *
 * The server stays RAM-stateless: the client sends `conversationId` and we load
 * turns from Postgres. Capture still runs per turn (live reminder chips); the
 * idle cron generates the conversation summary.
 */

const MAX_HISTORY = 12;
const MAX_TURN_CHARS = 4000;

const TurnBody = z.object({
  question: z.string().min(1, "question is required").max(MAX_TURN_CHARS),
});

/** Serialize an SSE `data:` frame. */
function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function serializeConversation(row: {
  id: string;
  userId: string;
  startedAt: Date;
  lastTurnAt: Date;
  status: string;
  summary: string | null;
  turnCount: number;
}) {
  return {
    id: row.id,
    startedAt: row.startedAt.toISOString(),
    lastTurnAt: row.lastTurnAt.toISOString(),
    status: row.status,
    summary: row.summary,
    turnCount: row.turnCount,
  };
}

/** Create a new active conversation for the authenticated user. */
export async function createConversation(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  // Drain optional body (clients may POST `{}`); no fields required.
  if (req.headers.get("content-type")?.includes("application/json")) {
    try {
      await req.json();
    } catch {
      // empty body is fine
    }
  }

  try {
    const now = new Date();
    const [row] = await db
      .insert(conversations)
      .values({
        userId,
        startedAt: now,
        lastTurnAt: now,
        status: "active",
        turnCount: 0,
      })
      .returning();

    if (!row) return serverError("Could not create conversation.");
    log.info("conversation created", { userId, conversationId: row.id });
    return json(serializeConversation(row), 201);
  } catch (err) {
    log.error("createConversation failed", err as Error);
    return serverError();
  }
}

/**
 * GET /conversations?since= — list the user's conversations for app resume.
 * `since` is an optional ISO timestamp; when set, only conversations with
 * last_turn_at >= since are returned.
 */
export async function listConversations(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  const url = new URL(req.url);
  const sinceRaw = url.searchParams.get("since");
  let since: Date | null = null;
  if (sinceRaw) {
    since = new Date(sinceRaw);
    if (Number.isNaN(since.getTime())) {
      return badRequest("since must be a valid ISO timestamp.");
    }
  }

  try {
    const conditions = [eq(conversations.userId, userId)];
    if (since) conditions.push(gte(conversations.lastTurnAt, since));

    const rows = await db
      .select({
        id: conversations.id,
        userId: conversations.userId,
        startedAt: conversations.startedAt,
        lastTurnAt: conversations.lastTurnAt,
        status: conversations.status,
        summary: conversations.summary,
        turnCount: conversations.turnCount,
      })
      .from(conversations)
      .where(and(...conditions))
      .orderBy(desc(conversations.lastTurnAt))
      .limit(100);

    return json({ conversations: rows.map(serializeConversation) });
  } catch (err) {
    log.error("listConversations failed", err as Error);
    return serverError();
  }
}

/**
 * Load prior turns for the agent (role/content only), newest-last, capped.
 * Excludes a just-inserted turn id when provided.
 */
async function loadHistory(
  conversationId: string,
  excludeTurnId?: string,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const rows = await db
    .select({
      id: conversationTurns.id,
      role: conversationTurns.role,
      content: conversationTurns.content,
    })
    .from(conversationTurns)
    .where(eq(conversationTurns.conversationId, conversationId))
    .orderBy(desc(conversationTurns.createdAt))
    .limit(MAX_HISTORY + 4);

  const filtered = excludeTurnId
    ? rows.filter((r) => r.id !== excludeTurnId)
    : rows;

  // We fetched newest-first; reverse for chronological history and cap.
  return filtered
    .reverse()
    .slice(-MAX_HISTORY)
    .filter((r) => r.role === "user" || r.role === "assistant")
    .map((r) => ({
      role: r.role as "user" | "assistant",
      content: r.content,
    }));
}

/**
 * Core turn pipeline: persist user turn → stream answer → persist assistant turn
 * → conversational capture. Shared by POST /conversations/:id/turns and the
 * thin /ask shim.
 */
export async function streamConversationTurn(params: {
  userId: string;
  conversationId: string;
  question: string;
  /** Optional pre-seeded history already in DB (ask shim). */
  historyAlreadyLoaded?: { role: "user" | "assistant"; content: string }[];
}): Promise<Response> {
  const { userId, conversationId, question } = params;
  const startedAt = Date.now();

  // Ownership + existence check.
  const [convo] = await db
    .select({
      id: conversations.id,
      userId: conversations.userId,
      status: conversations.status,
      turnCount: conversations.turnCount,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!convo || convo.userId !== userId) {
    return notFound("Conversation not found.");
  }

  const now = new Date();

  // Persist the user turn first so history is complete if the client disconnects.
  const [userTurn] = await db
    .insert(conversationTurns)
    .values({
      conversationId,
      userId,
      role: "user",
      content: question,
      createdAt: now,
      meta: { captureProcessed: false },
    })
    .returning({ id: conversationTurns.id });

  if (!userTurn) return serverError("Could not store turn.");

  await db
    .update(conversations)
    .set({
      lastTurnAt: now,
      status: "active",
      turnCount: sql`${conversations.turnCount} + 1`,
    })
    .where(eq(conversations.id, conversationId));

  const history =
    params.historyAlreadyLoaded ??
    (await loadHistory(conversationId, userTurn.id));

  log.info("conversation turn received", {
    userId,
    conversationId,
    questionChars: question.length,
    historyTurns: history.length,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(sse(obj)));
        } catch {
          // client disconnected
        }
      };

      try {
        const handle = await answerQuestion({
          userId,
          question,
          history,
          conversationId,
          userTurnId: userTurn.id,
          onStep: (step) => send({ type: "step", ...step }),
        });

        let fullText = "";
        for await (const chunk of handle.textStream) {
          if (chunk) {
            fullText += chunk;
            send({ type: "token", text: chunk });
          }
        }

        const final = await handle.result;
        send({
          type: "done",
          citations: final.citations,
          confidence: final.confidence,
          mode: final.mode,
          steps: final.steps,
          ...(final.clarifyOptions ? { clarifyOptions: final.clarifyOptions } : {}),
          // Receipt affordance when a proactive nudge was woven (P2).
          ...(final.nudge
            ? {
                surfacingId: final.nudge.surfacingId,
                evidence: final.nudge.evidence,
              }
            : {}),
        });

        const assistantContent = fullText.trim() || "(no response)";
        const meta = {
          searches: final.steps
            .filter((s) => s.kind === "search")
            .map((s) => s.query)
            .filter(Boolean),
          citations: final.citations.map((c) => c.memoryId),
          ruleIdsApplied: final.ruleIdsApplied ?? [],
          surfacingIds: final.surfacingIds ?? [],
        };

        await db.insert(conversationTurns).values({
          conversationId,
          userId,
          role: "assistant",
          content: assistantContent,
          createdAt: new Date(),
          meta,
        });

        await db
          .update(conversations)
          .set({
            lastTurnAt: new Date(),
            turnCount: sql`${conversations.turnCount} + 1`,
          })
          .where(eq(conversations.id, conversationId));

        log.info("conversation turn completed", {
          userId,
          conversationId,
          mode: final.mode,
          confidence: final.confidence,
          citations: final.citations.length,
          steps: final.steps.length,
          ms: Date.now() - startedAt,
        });

        // Live capture for reminder chips / captured frames. Marks the user
        // turn so the idle sweep does not double-capture.
        const capture = await captureFromConversation({
          userId,
          userText: question,
          history,
        });
        await db
          .update(conversationTurns)
          .set({
            meta: {
              captureProcessed: true,
              ...(capture.captured
                ? { memoryId: capture.memoryId }
                : {}),
            },
          })
          .where(eq(conversationTurns.id, userTurn.id));

        if (capture.captured) {
          send({
            type: "captured",
            memoryId: capture.memoryId,
            statement: capture.statement,
          });
        }
        if (capture.suggestedReminder) {
          send({ type: "reminder_suggestion", ...capture.suggestedReminder });
        }
      } catch (err) {
        log.error("conversation turn failed", err as Error);
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

/** POST /conversations/:id/turns — stream an answer; history loaded server-side. */
export async function postConversationTurn(
  req: Request,
  conversationId: string,
): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  if (!conversationId || !z.string().uuid().safeParse(conversationId).success) {
    return badRequest("conversation id must be a uuid.");
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest("Body must be valid JSON.");
  }
  const parsed = TurnBody.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("; ");
    return badRequest(message);
  }

  try {
    return await streamConversationTurn({
      userId,
      conversationId,
      question: parsed.data.question,
    });
  } catch (err) {
    log.error("postConversationTurn failed", err as Error);
    return serverError();
  }
}

/**
 * Create a conversation and optionally seed prior turns (for the /ask shim).
 * Returns the new conversation id.
 */
export async function createConversationForUser(
  userId: string,
  seedHistory?: { role: "user" | "assistant"; content: string }[],
): Promise<string> {
  const now = new Date();
  const [row] = await db
    .insert(conversations)
    .values({
      userId,
      startedAt: now,
      lastTurnAt: now,
      status: "active",
      turnCount: 0,
    })
    .returning({ id: conversations.id });

  if (!row) throw new Error("Could not create conversation.");

  if (seedHistory?.length) {
    const turns = seedHistory.slice(-MAX_HISTORY);
    let t = 0;
    for (const h of turns) {
      await db.insert(conversationTurns).values({
        conversationId: row.id,
        userId,
        role: h.role,
        content: h.content,
        // Slightly stagger so order is stable.
        createdAt: new Date(now.getTime() + t++),
      });
    }
    await db
      .update(conversations)
      .set({ turnCount: turns.length, lastTurnAt: new Date() })
      .where(eq(conversations.id, row.id));
  }

  return row.id;
}

/** Used by tests / ask shim — load chronological history for a conversation. */
export async function loadConversationHistory(
  conversationId: string,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  return loadHistory(conversationId);
}
