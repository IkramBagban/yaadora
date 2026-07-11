/**
 * `bun run eval` — Yaadora's retrieval + reasoning regression harness.
 *
 * This talks to a RUNNING server over the same HTTP contract the mobile app
 * uses (POST /memories, GET /memories/:id, POST /ask SSE). That is deliberate:
 * we test the real pipeline end-to-end — ingestion, hybrid retrieval, rerank,
 * grounded answer, refusal — not mocks. No mocks means no lies about accuracy.
 *
 * Flow:
 *   1. Seed the golden dataset (dataset.ts) via POST /memories, capturing a
 *      clientId <-> memoryId map. Idempotent: re-runs reuse existing rows.
 *   2. Poll GET /memories/:id until every seed is `processed` (ingestion is
 *      async on BullMQ, so we must wait before asking).
 *   3. Run every eval case (cases.ts) through POST /ask, parse the SSE stream,
 *      and score citations with metrics.ts.
 *   4. Print a per-category report + write JSON to eval/results/, and exit
 *      non-zero if any gate threshold is missed (so CI can block a bad merge —
 *      spec 02 §7: "no retrieval PR merges on vibes").
 *
 * Prereqs: server + worker + Postgres + Redis up, with AUTH_ALLOW_BOOTSTRAP=true
 * and AUTH_BOOTSTRAP_TOKEN matching the server. See eval/README.md.
 *
 * Env:
 *   YAADORA_SERVER_URL   (default http://localhost:3000)
 *   AUTH_BOOTSTRAP_TOKEN (required — bearer for the bootstrap eval user)
 *   EVAL_K               (default 10)   citation depth for recall@k / MRR
 *   EVAL_INGEST_TIMEOUT  (default 120)  seconds to wait for processing
 *   EVAL_MIN_RECALL      (default 0.8)  gate: mean recall@k
 *   EVAL_MIN_MRR         (default 0.7)  gate: mean reciprocal rank
 *   EVAL_MIN_REFUSAL     (default 0.9)  gate: refusal accuracy
 *   EVAL_ONLY            (optional)     comma-separated case ids to run a subset
 */

import { GOLDEN_DATASET, DATASET_SIZE, type SeedMemory } from "./dataset";
import { EVAL_CASES, type EvalCase, type EvalCategory } from "./cases";
import { recallAtK, reciprocalRank, hasForbidden, mean, r3 } from "./metrics";

// ── Config ──────────────────────────────────────────────────────────────────
const SERVER_URL = (process.env.YAADORA_SERVER_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.AUTH_BOOTSTRAP_TOKEN;
const K = Number(process.env.EVAL_K ?? 10);
const INGEST_TIMEOUT_S = Number(process.env.EVAL_INGEST_TIMEOUT ?? 120);
const MIN_RECALL = Number(process.env.EVAL_MIN_RECALL ?? 0.8);
const MIN_MRR = Number(process.env.EVAL_MIN_MRR ?? 0.7);
const MIN_REFUSAL = Number(process.env.EVAL_MIN_REFUSAL ?? 0.9);
const ONLY = (process.env.EVAL_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const AUTH = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

// ── HTTP contract types (only the fields we consume) ─────────────────────────
interface Citation {
  memoryId: string;
  snippet?: string;
}
interface AskDone {
  type: "done";
  citations: Citation[];
  confidence: number;
  mode: string; // AskMode: "recall" | "reason" | "clarify"
  clarifyOptions?: string[];
}

/**
 * The verbatim refusal the agent streams when it has no grounded memory
 * (packages/core/retrieval/answer.ts `REFUSAL_TEXT`). Kept as a local literal so
 * the HTTP runner has no dependency on @repo/core internals. If that constant
 * changes, update this — the type-check won't catch a drifted string.
 */
const REFUSAL_MARKER = "don't have a memory about that";

// ── Seeding ──────────────────────────────────────────────────────────────────
async function seedMemory(m: SeedMemory): Promise<string> {
  const res = await fetch(`${SERVER_URL}/memories`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({
      rawText: m.rawText,
      clientId: m.clientId,
      ...(m.occurredHint ? { occurredHint: m.occurredHint } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`seed ${m.clientId} failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

async function getStatus(memoryId: string): Promise<string> {
  const res = await fetch(`${SERVER_URL}/memories/${memoryId}`, { headers: AUTH });
  if (!res.ok) throw new Error(`status ${memoryId}: ${res.status}`);
  const data = (await res.json()) as { status: string };
  return data.status;
}

async function seedAll(): Promise<Map<string, string>> {
  console.log(`\nSeeding ${DATASET_SIZE} golden memories -> ${SERVER_URL} ...`);
  const clientToId = new Map<string, string>();
  for (const m of GOLDEN_DATASET) {
    const id = await seedMemory(m);
    clientToId.set(m.clientId, id);
  }
  console.log(`  seeded ${clientToId.size} memories.`);
  return clientToId;
}

async function waitForProcessing(ids: string[]): Promise<void> {
  console.log(`Waiting for ingestion (timeout ${INGEST_TIMEOUT_S}s) ...`);
  const deadline = Date.now() + INGEST_TIMEOUT_S * 1000;
  const pending = new Set(ids);
  while (pending.size > 0 && Date.now() < deadline) {
    for (const id of [...pending]) {
      const status = await getStatus(id);
      if (status === "processed") pending.delete(id);
      else if (status === "failed") {
        console.warn(`  WARN memory ${id} ingestion FAILED — retrieval for it will be degraded.`);
        pending.delete(id);
      }
    }
    if (pending.size > 0) {
      process.stdout.write(`  ${ids.length - pending.size}/${ids.length} processed\r`);
      await Bun.sleep(2000);
    }
  }
  if (pending.size > 0) {
    throw new Error(`timed out: ${pending.size} memories still not processed after ${INGEST_TIMEOUT_S}s`);
  }
  console.log(`  all ${ids.length} memories processed.        `);
}

// ── Ask + SSE parsing ────────────────────────────────────────────────────────
interface AskResult {
  answerText: string;
  done: AskDone | null;
  errored: string | null;
}

async function ask(question: string): Promise<AskResult> {
  const res = await fetch(`${SERVER_URL}/ask`, {
    method: "POST",
    headers: { ...AUTH, Accept: "text/event-stream" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok || !res.body) {
    return { answerText: "", done: null, errored: `HTTP ${res.status}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answerText = "";
  let done: AskDone | null = null;
  let errored: string | null = null;

  const handleFrame = (json: string) => {
    let evt: any;
    try {
      evt = JSON.parse(json);
    } catch {
      return;
    }
    if (evt.type === "token") answerText += evt.text ?? "";
    else if (evt.type === "done") done = evt as AskDone;
    else if (evt.type === "error") errored = evt.message ?? "stream error";
  };

  while (true) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? ""; // keep the incomplete tail
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (line) handleFrame(line.slice(5).trim());
    }
  }
  if (buffer.startsWith("data:")) handleFrame(buffer.slice(5).trim());

  return { answerText, done, errored };
}

// ── Scoring ──────────────────────────────────────────────────────────────────
interface CaseResult {
  id: string;
  category: EvalCategory;
  question: string;
  passed: boolean;
  recall: number | null; // null for refusal cases
  rr: number | null;
  forbiddenHit: boolean;
  refusedCorrectly: boolean | null; // null for non-refusal cases
  answerPreview: string;
  citedClientIds: string[];
  reason: string;
}

/** A turn counts as an honest refusal (i.e. it did NOT fabricate) if any of:
 *  - no answer was produced at all,
 *  - it streamed the verbatim refusal text,
 *  - it asked the user back instead of answering (mode === "clarify"),
 *  - it produced no grounding citations / ~zero confidence.
 *  `clarify` counts because asking back is also "did not invent a memory",
 *  which is the property refusal cases actually guard. */
function isRefusal(ask: AskResult): boolean {
  const done = ask.done;
  if (!done) return true;
  if (ask.answerText.toLowerCase().includes(REFUSAL_MARKER)) return true;
  if (done.mode === "clarify") return true;
  if (done.citations.length === 0) return true;
  if (done.confidence <= 0.01) return true;
  return false;
}

function scoreCase(
  c: EvalCase,
  ask: AskResult,
  idToClient: Map<string, string>,
): CaseResult {
  const done = ask.done;
  const citedMemoryIds = done?.citations.map((x) => x.memoryId) ?? [];
  // Restrict to OUR dataset's ids and translate to clientIds, preserving order.
  const citedClientIds = citedMemoryIds
    .map((id) => idToClient.get(id))
    .filter((x): x is string => Boolean(x));

  const preview = ask.answerText.replace(/\s+/g, " ").trim().slice(0, 120);

  if (ask.errored) {
    return {
      id: c.id, category: c.category, question: c.question, passed: false,
      recall: null, rr: null, forbiddenHit: false, refusedCorrectly: null,
      answerPreview: preview, citedClientIds, reason: `stream error: ${ask.errored}`,
    };
  }

  // Refusal cases: the only correct behaviour is declining / not fabricating.
  if (c.expectRefusal) {
    const refused = isRefusal(ask);
    return {
      id: c.id, category: c.category, question: c.question, passed: refused,
      recall: null, rr: null, forbiddenHit: false, refusedCorrectly: refused,
      answerPreview: preview, citedClientIds,
      reason: refused ? "declined as expected" : "FABRICATED an answer to an unanswerable question",
    };
  }

  // Retrieval / reasoning cases.
  const expect = c.expect ?? [];
  const recall = recallAtK(citedClientIds, expect, K);
  const rr = reciprocalRank(citedClientIds, expect, K);
  const forbiddenHit = hasForbidden(citedClientIds, c.forbid ?? []);
  // Pass = recalled everything expected AND didn't cite a stale/decoy.
  const passed = recall >= 1 && !forbiddenHit;
  const reasonParts: string[] = [];
  if (recall < 1) reasonParts.push(`missing ${expect.filter((e) => !citedClientIds.includes(e)).join(",")}`);
  if (forbiddenHit) reasonParts.push(`cited forbidden ${(c.forbid ?? []).filter((f) => citedClientIds.includes(f)).join(",")}`);

  return {
    id: c.id, category: c.category, question: c.question, passed,
    recall, rr, forbiddenHit, refusedCorrectly: null,
    answerPreview: preview, citedClientIds,
    reason: passed ? "ok" : reasonParts.join("; "),
  };
}

// ── Report ───────────────────────────────────────────────────────────────────
function report(results: CaseResult[]) {
  const retrieval = results.filter((r) => r.recall !== null);
  const refusal = results.filter((r) => r.refusedCorrectly !== null);

  const meanRecall = r3(mean(retrieval.map((r) => r.recall!)));
  const meanMRR = r3(mean(retrieval.map((r) => r.rr!)));
  const refusalAcc = refusal.length ? r3(mean(refusal.map((r) => (r.refusedCorrectly ? 1 : 0)))) : 1;
  const forbiddenHits = retrieval.filter((r) => r.forbiddenHit).length;
  const passed = results.filter((r) => r.passed).length;

  console.log("\n" + "=".repeat(72));
  console.log("  YAADORA EVAL REPORT");
  console.log("=".repeat(72));

  // Per-case table
  for (const r of results) {
    const mark = r.passed ? "PASS" : "FAIL";
    const metric =
      r.recall !== null ? `recall=${r3(r.recall)} rr=${r3(r.rr!)}` : `refusal=${r.refusedCorrectly}`;
    console.log(`  [${mark}] ${r.id.padEnd(20)} ${r.category.padEnd(20)} ${metric}`);
    if (!r.passed) console.log(`         ↳ ${r.reason}`);
  }

  // Per-category rollup
  console.log("\n  By category:");
  const cats = [...new Set(results.map((r) => r.category))];
  for (const cat of cats) {
    const rows = results.filter((r) => r.category === cat);
    const p = rows.filter((r) => r.passed).length;
    console.log(`    ${cat.padEnd(22)} ${p}/${rows.length} passed`);
  }

  console.log("\n  Overall:");
  console.log(`    cases            ${passed}/${results.length} passed`);
  console.log(`    mean recall@${K}    ${meanRecall}   (gate ${MIN_RECALL})`);
  console.log(`    mean MRR         ${meanMRR}   (gate ${MIN_MRR})`);
  console.log(`    refusal accuracy ${refusalAcc}   (gate ${MIN_REFUSAL})`);
  console.log(`    forbidden hits   ${forbiddenHits}   (stale/decoy leaked into answers; want 0)`);
  console.log("=".repeat(72));

  const gatesPassed =
    meanRecall >= MIN_RECALL && meanMRR >= MIN_MRR && refusalAcc >= MIN_REFUSAL && forbiddenHits === 0;

  return {
    summary: { meanRecall, meanMRR, refusalAcc, forbiddenHits, passed, total: results.length, k: K, gatesPassed },
    cases: results,
    ranAt: new Date().toISOString(),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!TOKEN) {
    console.error(
      "AUTH_BOOTSTRAP_TOKEN is required (server must have AUTH_ALLOW_BOOTSTRAP=true and the same token). Set it in .env.",
    );
    process.exit(2);
  }

  // Fail fast if the server isn't up.
  try {
    await fetch(`${SERVER_URL}/health`);
  } catch {
    console.error(`Cannot reach server at ${SERVER_URL}. Start apps/server + apps/worker first.`);
    process.exit(2);
  }

  const clientToId = await seedAll();
  const idToClient = new Map([...clientToId].map(([c, id]) => [id, c]));
  await waitForProcessing([...clientToId.values()]);

  const cases = ONLY.length ? EVAL_CASES.filter((c) => ONLY.includes(c.id)) : EVAL_CASES;
  console.log(`\nRunning ${cases.length} eval cases ...`);
  const results: CaseResult[] = [];
  for (const c of cases) {
    const answer = await ask(c.question);
    results.push(scoreCase(c, answer, idToClient));
    process.stdout.write(`  ${results.length}/${cases.length}\r`);
  }

  const out = report(results);

  // Persist JSON for trend tracking.
  const dir = `${import.meta.dir}/results`;
  await Bun.$`mkdir -p ${dir}`.quiet();
  const file = `${dir}/eval-${out.ranAt.replace(/[:.]/g, "-")}.json`;
  await Bun.write(file, JSON.stringify(out, null, 2));
  await Bun.write(`${dir}/latest.json`, JSON.stringify(out, null, 2));
  console.log(`\nResults written to ${file}`);

  process.exit(out.summary.gatesPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("\nEval run crashed:", err);
  process.exit(2);
});
