/**
 * Follow-up threads & absence — GOLDEN conversation evals (spec 04 §3.8).
 *
 * These run the real Ask agent end-to-end against seeded memories/loops and
 * judge the two things that matter: (1) SUPPRESSION — a wrongly-raised follow-up
 * is a BLOCKING failure (spec 03 CI asymmetry), asserted deterministically by
 * checking that NO `followup_nudge`/`absence_nudge` surfacing row was written;
 * (2) PHRASING — printed as transcripts for a human to judge (the "exam opener"
 * and the "chacha seam"), because natural phrasing can't be asserted, only read.
 *
 * Requires DATABASE_URL + embedding + LLM credentials; skips hermetically
 * otherwise (copy root .env → packages/core/.env for a local run, then delete).
 */
import { describe, expect, test } from "bun:test";

const hasDb = Boolean(process.env.DATABASE_URL);
const hasEmbed =
  process.env.EMBEDDING_PROVIDER === "google"
    ? Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY)
    : Boolean(process.env.OPENAI_API_KEY);
const hasLlm = Boolean(
  process.env.GROQ_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
);
const runEval = hasDb && hasEmbed && hasLlm;
const evalTest = runEval ? test : test.skip;

const DAY_MS = 24 * 60 * 60 * 1000;

interface Seeded {
  userId: string;
  conversationId: string;
  cleanup: () => Promise<void>;
}

async function seed(): Promise<Seeded> {
  const { db, users, conversations, eq, memories, memoryEntities, entities, openLoops, surfacings } =
    require("@repo/db");
  const [user] = await db
    .insert(users)
    .values({ email: `fug-${crypto.randomUUID()}@example.test`, timezone: "UTC" })
    .returning({ id: users.id });
  const [convo] = await db
    .insert(conversations)
    .values({
      userId: user.id,
      startedAt: new Date(),
      lastTurnAt: new Date(),
      status: "active",
      turnCount: 0,
    })
    .returning({ id: conversations.id });
  return {
    userId: user.id,
    conversationId: convo.id,
    cleanup: async () => {
      await db.delete(surfacings).where(eq(surfacings.userId, user.id));
      await db.delete(openLoops).where(eq(openLoops.userId, user.id));
      const mems = await db
        .select({ id: memories.id })
        .from(memories)
        .where(eq(memories.userId, user.id));
      for (const m of mems)
        await db.delete(memoryEntities).where(eq(memoryEntities.memoryId, m.id));
      await db.delete(entities).where(eq(entities.userId, user.id));
      await db.delete(memories).where(eq(memories.userId, user.id));
      await db.delete(conversations).where(eq(conversations.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    },
  };
}

async function mem(userId: string, text: string, occurredAt?: Date): Promise<string> {
  const { db, memories, eq } = require("@repo/db");
  const [m] = await db
    .insert(memories)
    .values({ userId, rawText: text, source: "manual" })
    .returning({ id: memories.id });
  if (occurredAt) {
    await db.update(memories).set({ occurredAt }).where(eq(memories.id, m.id));
  }
  return m.id;
}

async function run(params: {
  userId: string;
  conversationId: string;
  question: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<{ answer: string; nudge: unknown; followupRows: number }> {
  const { answerQuestion } = require("../retrieval/agent");
  const { db, surfacings, eq, and, inArray } = require("@repo/db");
  const handle = await answerQuestion({
    userId: params.userId,
    question: params.question,
    history: params.history ?? [],
    conversationId: params.conversationId,
  });
  let answer = "";
  for await (const chunk of handle.textStream) answer += chunk;
  const final = await handle.result;
  // Count follow-up/absence surfacing rows actually written this turn.
  const rows = await db
    .select({ id: surfacings.id })
    .from(surfacings)
    .where(
      and(
        eq(surfacings.userId, params.userId),
        inArray(surfacings.kind, ["followup_nudge", "absence_nudge"]),
      ),
    );
  return { answer, nudge: final.nudge, followupRows: rows.length };
}

// ---------------------------------------------------------------------------
// 2.1 — the exam, after. Dated thread, date passed → natural opener.
// ---------------------------------------------------------------------------

describe("golden 2.1 — exam opener", () => {
  evalTest("first-turn opener asks how the exam went; phrasing is fresh", async () => {
    const s = await seed();
    try {
      const src = await mem(s.userId, "I have my exam on the 17th, pretty nervous about it.");
      const { db, openLoops } = require("@repo/db");
      await db.insert(openLoops).values({
        userId: s.userId,
        kind: "upcoming_event",
        title: "the exam on the 17th",
        dueAt: new Date(Date.now() - 1 * DAY_MS), // passed yesterday
        status: "open",
        sourceMemory: src,
      });

      const { answer } = await run({
        userId: s.userId,
        conversationId: s.conversationId,
        question: "hey",
      });
      console.log("\n[2.1 EXAM OPENER] user: hey\nassistant:", answer, "\n");

      // Phrasing must be fresh — never the stored dossier summary verbatim.
      expect(answer.toLowerCase()).not.toContain("the exam on the 17th");
      // Best-effort: a good opener references the exam and asks about it.
      expect(/exam/i.test(answer)).toBe(true);
    } finally {
      await s.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// 2.2 — the sick relative. Undated thread, mid-conversation seam.
// ---------------------------------------------------------------------------

describe("golden 2.2 — chacha seam", () => {
  evalTest("answers the cooking question and checks in on chacha at a seam", async () => {
    const s = await seed();
    try {
      const src = await mem(
        s.userId,
        "Spent the evening at the hospital — chacha's condition isn't good.",
        new Date(Date.now() - 4 * DAY_MS),
      );
      const { db, openLoops, entities, memoryEntities } = require("@repo/db");
      const [ent] = await db
        .insert(entities)
        .values({ userId: s.userId, type: "person", canonicalName: "chacha" })
        .returning({ id: entities.id });
      await db.insert(memoryEntities).values({ memoryId: src, entityId: ent.id });
      await db.insert(openLoops).values({
        userId: s.userId,
        kind: "thread",
        title: "chacha's condition isn't good",
        dueAt: null,
        status: "open",
        sourceMemory: src,
        createdAt: new Date(Date.now() - 4 * DAY_MS),
      });

      const { answer } = await run({
        userId: s.userId,
        conversationId: s.conversationId,
        question: "what should I cook this weekend?",
      });
      console.log(
        "\n[2.2 CHACHA SEAM] user: what should I cook this weekend?\nassistant:",
        answer,
        "\n",
      );
      // The cooking question must actually be answered (not replaced by the nudge).
      expect(answer.length).toBeGreaterThan(40);
    } finally {
      await s.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Anti-cases — the silences that make it trustworthy. SUPPRESSION = BLOCKING.
// ---------------------------------------------------------------------------

describe("golden anti-cases — nothing wrongly raised (blocking)", () => {
  evalTest("mid-debugging (stack trace) → no follow-up raised", async () => {
    const s = await seed();
    try {
      const src = await mem(s.userId, "chacha's condition isn't good, at the hospital.");
      const { db, openLoops } = require("@repo/db");
      await db.insert(openLoops).values({
        userId: s.userId,
        kind: "thread",
        title: "chacha's condition",
        dueAt: null,
        status: "open",
        sourceMemory: src,
        createdAt: new Date(Date.now() - 4 * DAY_MS),
      });

      const stack =
        "why is this throwing?\n```\nTypeError: Cannot read properties of undefined (reading 'map')\n    at render (/app/x.tsx:12:9)\n```";
      const { answer, followupRows } = await run({
        userId: s.userId,
        conversationId: s.conversationId,
        question: stack,
      });
      console.log("\n[ANTI mid-debug] followupRows:", followupRows, "\n");
      // Blocking: nothing proactive may be raised mid-task.
      expect(followupRows).toBe(0);
      expect(answer.length).toBeGreaterThan(0);
    } finally {
      await s.cleanup();
    }
  });

  evalTest("nothing-fits turn → no follow-up raised", async () => {
    const s = await seed();
    try {
      const src = await mem(s.userId, "chacha's condition isn't good.");
      const { db, openLoops } = require("@repo/db");
      await db.insert(openLoops).values({
        userId: s.userId,
        kind: "thread",
        title: "chacha's condition",
        dueAt: null,
        status: "open",
        sourceMemory: src,
        createdAt: new Date(Date.now() - 4 * DAY_MS),
      });
      const { followupRows } = await run({
        userId: s.userId,
        conversationId: s.conversationId,
        question: "what's a good name for a rate limiter package?",
      });
      console.log("\n[ANTI nothing-fits] followupRows:", followupRows, "\n");
      expect(followupRows).toBe(0);
    } finally {
      await s.cleanup();
    }
  });
});
