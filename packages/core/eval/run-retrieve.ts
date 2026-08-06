/**
 * `bun run eval:retrieve` — Ask-path quality over the golden life history.
 *
 * Requires a prior `eval:ingest` (or `eval:all`) so `results/eval-state.json`
 * maps clientId → memoryId. Optionally re-seeds if state is missing and
 * EVAL_RETRIEVE_RESEED=1.
 *
 * Scores: citation recall/MRR/forbid, refusal honesty, answer-text patterns.
 */

import { GOLDEN_DATASET } from "./dataset";
import { RETRIEVE_CASES, type RetrieveCase } from "./retrieve-cases";
import { loadEvalConfig } from "./lib/config";
import {
  ask,
  healthCheck,
  seedAll,
  waitForProcessing,
  type AskResult,
} from "./lib/http";
import { printReport, summarizeStage, writeReport } from "./lib/report";
import {
  clientToIdMap,
  idToClientMap,
  loadState,
  saveState,
} from "./lib/state";
import type { CheckResult, EvalReport } from "./lib/types";
import {
  hasForbidden,
  mean,
  r3,
  recallAtK,
  reciprocalRank,
} from "./metrics";

/** Verbatim refusal marker from answer.ts (keep in sync). */
const REFUSAL_MARKER = "don't have a memory about that";

function isRefusal(askRes: AskResult): boolean {
  const done = askRes.done;
  if (!done) return true;
  if (askRes.answerText.toLowerCase().includes(REFUSAL_MARKER)) return true;
  if (done.mode === "clarify") return true;
  if (done.citations.length === 0) return true;
  if (done.confidence <= 0.01) return true;
  return false;
}

function matchAnyRegex(text: string, patterns: string[]): boolean {
  const t = text;
  return patterns.some((p) => {
    try {
      return new RegExp(p, "i").test(t);
    } catch {
      return t.toLowerCase().includes(p.toLowerCase());
    }
  });
}

function matchAllGroups(text: string, patterns: string[]): boolean {
  // Each pattern is OR-internal (a|b); all patterns must hit.
  return patterns.every((p) => matchAnyRegex(text, [p]));
}

function scoreRetrieveCase(
  c: RetrieveCase,
  askRes: AskResult,
  idToClient: Map<string, string>,
  k: number,
): CheckResult {
  const base = {
    id: c.id,
    stage: "retrieve" as const,
    category: c.category,
    subject: c.question,
  };

  const preview = askRes.answerText.replace(/\s+/g, " ").trim().slice(0, 160);
  const citedMemoryIds = askRes.done?.citations.map((x) => x.memoryId) ?? [];
  const citedClientIds = citedMemoryIds
    .map((id) => idToClient.get(id))
    .filter((x): x is string => Boolean(x));

  if (askRes.errored) {
    return {
      ...base,
      passed: false,
      reason: `stream error: ${askRes.errored}`,
      details: { preview },
    };
  }

  if (c.expectRefusal) {
    const refused = isRefusal(askRes);
    return {
      ...base,
      passed: refused,
      reason: refused
        ? "declined as expected"
        : "FABRICATED an answer to an unanswerable question",
      details: {
        preview,
        mode: askRes.done?.mode,
        confidence: askRes.done?.confidence,
        citedClientIds,
      },
    };
  }

  const expect = c.expect ?? [];
  const recall = recallAtK(citedClientIds, expect, k);
  const rr = reciprocalRank(citedClientIds, expect, k);
  const forbiddenHit = hasForbidden(citedClientIds, c.forbid ?? []);

  const fails: string[] = [];
  // Soft citation: require recall === 1 when expect is non-empty
  if (expect.length > 0 && recall < 1) {
    fails.push(
      `missing citations ${expect.filter((e) => !citedClientIds.includes(e)).join(",")}`,
    );
  }
  if (forbiddenHit) {
    fails.push(
      `cited forbidden ${(c.forbid ?? []).filter((f) => citedClientIds.includes(f)).join(",")}`,
    );
  }

  const answer = askRes.answerText;
  if (c.answerMustMatch?.length && !matchAllGroups(answer, c.answerMustMatch)) {
    fails.push(
      `answer missing required content [${c.answerMustMatch.join(" & ")}]`,
    );
  }
  if (c.answerMustNotMatch?.length) {
    for (const p of c.answerMustNotMatch) {
      if (matchAnyRegex(answer, [p])) {
        fails.push(`answer hit forbidden pattern /${p}/`);
      }
    }
  }
  if (c.expectMode && askRes.done?.mode && askRes.done.mode !== c.expectMode) {
    // Soft: don't fail hard on mode mismatch, note only if other fails empty
    // (mode can vary by model). Skip hard fail.
  }

  // Answer quality score component for metrics: 1 if answer patterns ok else 0
  const answerOk =
    (!c.answerMustMatch?.length || matchAllGroups(answer, c.answerMustMatch)) &&
    !(c.answerMustNotMatch ?? []).some((p) => matchAnyRegex(answer, [p]));

  return {
    ...base,
    passed: fails.length === 0,
    reason: fails.length === 0 ? "ok" : fails.join("; "),
    details: {
      preview,
      recall: r3(recall),
      rr: r3(rr),
      forbiddenHit,
      answerOk,
      citedClientIds,
      mode: askRes.done?.mode,
      confidence: askRes.done?.confidence,
    },
  };
}

export async function runRetrieve(opts?: {
  /** When true (default if no state), seed+process before asking. */
  allowReseed?: boolean;
}): Promise<EvalReport> {
  const cfg = loadEvalConfig();
  if (!cfg.token) {
    console.error(
      "AUTH_BOOTSTRAP_TOKEN is required (server AUTH_ALLOW_BOOTSTRAP=true).",
    );
    process.exit(2);
  }

  await healthCheck(cfg);

  let state = await loadState(cfg);
  const forceReseed = process.env.EVAL_RETRIEVE_RESEED === "1";
  const allowReseed = opts?.allowReseed ?? forceReseed;

  if (!state || forceReseed) {
    if (!allowReseed && !forceReseed) {
      console.error(
        `No eval state at ${cfg.statePath}.\n` +
          `Run \`bun run eval:ingest\` first, or set EVAL_RETRIEVE_RESEED=1 to seed here.`,
      );
      process.exit(2);
    }
    console.log("No state (or EVAL_RETRIEVE_RESEED=1) — seeding before retrieve ...");
    const clientToId = await seedAll(cfg, GOLDEN_DATASET);
    const { processed, failed } = await waitForProcessing(cfg, [
      ...clientToId.values(),
    ]);
    await saveState(cfg, {
      clientToId: Object.fromEntries(clientToId),
      processedIds: processed,
      failedIds: failed,
    });
    state = (await loadState(cfg))!;
  } else {
    console.log(
      `Loaded eval state from ${cfg.statePath} (${Object.keys(state.clientToId).length} memories, seeded ${state.savedAt})`,
    );
  }

  const idToClient = idToClientMap(state);
  const clientToId = clientToIdMap(state);

  const cases = cfg.only.length
    ? RETRIEVE_CASES.filter((c) => cfg.only.includes(c.id))
    : RETRIEVE_CASES;

  console.log(`\nRunning ${cases.length} retrieve cases ...`);
  const checks: CheckResult[] = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!;
    const answer = await ask(cfg, c.question);
    checks.push(scoreRetrieveCase(c, answer, idToClient, cfg.k));
    process.stdout.write(`  ${i + 1}/${cases.length}\r`);
  }
  console.log(`  ${cases.length}/${cases.length} done.        `);

  // Metrics
  const retrievalChecks = checks.filter((c) => c.category !== "refusal");
  const refusalChecks = checks.filter((c) => c.category === "refusal");

  const recalls = retrievalChecks
    .map((c) => c.details?.recall)
    .filter((x): x is number => typeof x === "number");
  const rrs = retrievalChecks
    .map((c) => c.details?.rr)
    .filter((x): x is number => typeof x === "number");
  const answerQual = retrievalChecks
    .map((c) => (c.details?.answerOk ? 1 : 0));
  const forbiddenHits = retrievalChecks.filter(
    (c) => c.details?.forbiddenHit === true,
  ).length;

  const meanRecall = r3(mean(recalls));
  const meanMRR = r3(mean(rrs));
  const refusalAcc =
    refusalChecks.length === 0
      ? 1
      : r3(
          mean(refusalChecks.map((c) => (c.passed ? 1 : 0))),
        );
  const answerQuality = r3(mean(answerQual.length ? answerQual : [1]));
  const passRate =
    checks.length === 0 ? 1 : checks.filter((c) => c.passed).length / checks.length;

  const gatesPassed =
    meanRecall >= cfg.minRecall &&
    meanMRR >= cfg.minMrr &&
    refusalAcc >= cfg.minRefusal &&
    answerQuality >= cfg.minAnswerQuality &&
    forbiddenHits === 0 &&
    passRate >= cfg.minRetrievePassRate;

  const stage = summarizeStage(
    "retrieve",
    checks,
    {
      meanRecall,
      meanMRR,
      refusalAcc,
      answerQuality,
      forbiddenHits,
      passRate: r3(passRate),
      cases: checks.length,
      minRecall: cfg.minRecall,
      minMRR: cfg.minMrr,
      minRefusal: cfg.minRefusal,
      minAnswerQuality: cfg.minAnswerQuality,
    },
    gatesPassed,
  );

  const report: EvalReport = {
    ranAt: new Date().toISOString(),
    command: "retrieve",
    stages: [stage],
    checks,
    gatesPassed,
    clientToId: Object.fromEntries(clientToId),
  };

  printReport(report);
  await writeReport(cfg, report);
  return report;
}

if (import.meta.main) {
  runRetrieve()
    .then((r) => process.exit(r.gatesPassed ? 0 : 1))
    .catch((err) => {
      console.error("\nRetrieve eval crashed:", err);
      process.exit(2);
    });
}
