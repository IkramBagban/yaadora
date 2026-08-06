/**
 * `bun run eval:ingest` — seed golden dataset, wait for worker processing,
 * then assert extraction/derivation quality (facts, entities, open loops,
 * reminders, rules, supersession, entity collision).
 *
 * No Ask. Writes state so `eval:retrieve` can run later without re-seeding.
 */

import { GOLDEN_DATASET } from "./dataset";
import {
  GLOBAL_INGEST_EXPECTATIONS,
  MEMORY_INGEST_EXPECTATIONS,
  type GlobalIngestExpectation,
  type MemoryIngestExpectation,
} from "./ingest-expectations";
import { loadEvalConfig } from "./lib/config";
import {
  getMemoryDetail,
  healthCheck,
  listEntities,
  listReminders,
  listRules,
  seedAll,
  waitForProcessing,
  type MemoryDetail,
} from "./lib/http";
import { printReport, summarizeStage, writeReport } from "./lib/report";
import { saveState } from "./lib/state";
import type { CheckResult, EvalReport } from "./lib/types";
import {
  finishTokenTracking,
  newEvalSessionId,
  startTokenTracking,
} from "./lib/usage";
import { r3 } from "./metrics";

function includesAny(text: string, needles: string[]): boolean {
  const t = text.toLowerCase();
  return needles.some((n) => t.includes(n.toLowerCase()));
}

function factBlob(d: MemoryDetail): string {
  return d.facts.map((f) => f.factText ?? "").join(" \n ").toLowerCase();
}

function entityBlob(d: MemoryDetail): string {
  return d.entities
    .flatMap((e) => [e.canonicalName, ...(e.aliases ?? [])])
    .join(" ")
    .toLowerCase();
}

function scoreMemoryExpectation(
  exp: MemoryIngestExpectation,
  detail: MemoryDetail | null,
  status: "processed" | "failed" | "missing",
): CheckResult {
  const id = `ingest-mem-${exp.clientId}`;
  const base = {
    id,
    stage: "ingest" as const,
    category: exp.category,
    subject: exp.clientId,
  };

  if (status === "missing") {
    return {
      ...base,
      passed: false,
      reason: "memory id missing from seed map",
    };
  }
  if (status === "failed" || !detail) {
    return {
      ...base,
      passed: false,
      reason: "ingestion failed or detail unavailable",
    };
  }
  if (detail.memory.status !== "processed") {
    return {
      ...base,
      passed: false,
      reason: `status=${detail.memory.status}`,
      details: { status: detail.memory.status },
    };
  }

  const fails: string[] = [];
  const nFacts = detail.facts.length;
  if (exp.minFacts != null && nFacts < exp.minFacts) {
    fails.push(`facts ${nFacts} < min ${exp.minFacts}`);
  }
  if (exp.maxFacts != null && nFacts > exp.maxFacts) {
    fails.push(`facts ${nFacts} > max ${exp.maxFacts}`);
  }

  const fb = factBlob(detail);
  if (exp.factTextAnyOf?.length && !includesAny(fb, exp.factTextAnyOf)) {
    fails.push(`no fact matching [${exp.factTextAnyOf.join("|")}]`);
  }
  if (exp.factTextNoneOf?.length && includesAny(fb, exp.factTextNoneOf)) {
    fails.push(`forbidden fact content matched`);
  }

  const eb = entityBlob(detail);
  if (exp.entityNamesAnyOf?.length && !includesAny(eb, exp.entityNamesAnyOf)) {
    fails.push(`no entity matching [${exp.entityNamesAnyOf.join("|")}]`);
  }

  if (exp.minOpenLoops != null && detail.openLoops.length < exp.minOpenLoops) {
    fails.push(
      `openLoops ${detail.openLoops.length} < min ${exp.minOpenLoops}`,
    );
  }
  if (exp.openLoopTitleAnyOf?.length) {
    const titles = detail.openLoops.map((l) => l.title).join(" ").toLowerCase();
    if (!includesAny(titles, exp.openLoopTitleAnyOf)) {
      fails.push(`no openLoop title matching [${exp.openLoopTitleAnyOf.join("|")}]`);
    }
  }

  if (exp.minReminders != null && detail.reminders.length < exp.minReminders) {
    fails.push(
      `reminders ${detail.reminders.length} < min ${exp.minReminders}`,
    );
  }
  if (exp.reminderTextAnyOf?.length) {
    const rt = detail.reminders.map((r) => r.text).join(" ").toLowerCase();
    if (!includesAny(rt, exp.reminderTextAnyOf)) {
      fails.push(`no reminder text matching [${exp.reminderTextAnyOf.join("|")}]`);
    }
  }
  if (exp.reminderStatus && detail.reminders.length > 0) {
    if (!detail.reminders.some((r) => r.status === exp.reminderStatus)) {
      fails.push(`no reminder with status=${exp.reminderStatus}`);
    }
  }

  if (exp.minRules != null && detail.rules.length < exp.minRules) {
    fails.push(`rules ${detail.rules.length} < min ${exp.minRules}`);
  }
  if (exp.ruleTextAnyOf?.length) {
    const rt = detail.rules
      .map((r) => `${r.ruleText} ${r.triggerText}`)
      .join(" ")
      .toLowerCase();
    if (!includesAny(rt, exp.ruleTextAnyOf)) {
      fails.push(`no rule matching [${exp.ruleTextAnyOf.join("|")}]`);
    }
  }

  return {
    ...base,
    passed: fails.length === 0,
    reason: fails.length === 0 ? "ok" : fails.join("; "),
    details: {
      nFacts,
      nEntities: detail.entities.length,
      nOpenLoops: detail.openLoops.length,
      nReminders: detail.reminders.length,
      nRules: detail.rules.length,
      factSample: detail.facts.slice(0, 3).map((f) => f.factText),
    },
  };
}

async function scoreGlobal(
  exp: GlobalIngestExpectation,
  clientToId: Map<string, string>,
  cfg: ReturnType<typeof loadEvalConfig>,
  details: Map<string, MemoryDetail>,
): Promise<CheckResult> {
  const base = {
    id: exp.id,
    stage: "ingest" as const,
    category: exp.category,
    subject: exp.id,
  };

  try {
    if (exp.entityNameRegex || exp.minPersonEntities != null) {
      const people = await listEntities(cfg, "person");
      if (exp.minPersonEntities != null && people.length < exp.minPersonEntities) {
        return {
          ...base,
          passed: false,
          reason: `person entities ${people.length} < ${exp.minPersonEntities}`,
          details: { people: people.map((p) => p.canonicalName) },
        };
      }
      if (exp.entityNameRegex) {
        const re = new RegExp(exp.entityNameRegex, "i");
        const hits = people.filter((p) => re.test(p.canonicalName));
        const n = hits.length;
        if (exp.entityNameCountMin != null && n < exp.entityNameCountMin) {
          return {
            ...base,
            passed: false,
            reason: `entity name /${exp.entityNameRegex}/ count ${n} < ${exp.entityNameCountMin}`,
            details: { hits: hits.map((h) => h.canonicalName) },
          };
        }
        if (exp.entityNameCountMax != null && n > exp.entityNameCountMax) {
          return {
            ...base,
            passed: false,
            reason: `entity name /${exp.entityNameRegex}/ count ${n} > ${exp.entityNameCountMax} (over-merge?)`,
            details: { hits: hits.map((h) => h.canonicalName) },
          };
        }
      }
    }

    if (exp.globalReminderTextAnyOf?.length) {
      const rem = await listReminders(cfg, "all");
      const blob = rem.map((r) => r.text).join(" ").toLowerCase();
      if (!includesAny(blob, exp.globalReminderTextAnyOf)) {
        return {
          ...base,
          passed: false,
          reason: `no global reminder matching [${exp.globalReminderTextAnyOf.join("|")}]`,
          details: { reminders: rem.map((r) => r.text).slice(0, 10) },
        };
      }
    }

    if (exp.globalRuleTextAnyOf?.length) {
      const rules = await listRules(cfg);
      const blob = rules
        .map((r) => `${r.ruleText} ${r.triggerText}`)
        .join(" ")
        .toLowerCase();
      if (!includesAny(blob, exp.globalRuleTextAnyOf)) {
        return {
          ...base,
          passed: false,
          reason: `no global rule matching [${exp.globalRuleTextAnyOf.join("|")}]`,
        };
      }
    }

    if (exp.supersession) {
      const { oldClientId, newClientId, newFactMustContain, oldFactMarker } =
        exp.supersession;
      const newD = details.get(newClientId);
      if (!newD) {
        return {
          ...base,
          passed: false,
          reason: `missing detail for ${newClientId}`,
        };
      }
      const newFacts = newD.facts.filter((f) => !f.validTo);
      const newBlob = newFacts.map((f) => f.factText).join(" ").toLowerCase();
      if (!newBlob.includes(newFactMustContain.toLowerCase())) {
        // Fallback: any fact on new memory (even if validTo set oddly)
        const anyNew = factBlob(newD);
        if (!anyNew.includes(newFactMustContain.toLowerCase())) {
          return {
            ...base,
            passed: false,
            reason: `new memory facts lack "${newFactMustContain}"`,
            details: { facts: newD.facts.map((f) => f.factText) },
          };
        }
      }

      // Soft: if OLD still has only current facts with old marker and NEW lacks
      // new marker we already failed. Presence of new marker is the hard gate.
      void oldClientId;
      void oldFactMarker;
      void clientToId;
    }

    return { ...base, passed: true, reason: "ok" };
  } catch (err) {
    return {
      ...base,
      passed: false,
      reason: `error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function runIngest(opts?: {
  /** Reuse an existing usage session (full eval pipeline). */
  usageSessionId?: string;
  /** When true, do not finalize/print token summary (caller will). */
  deferTokenSummary?: boolean;
}): Promise<EvalReport> {
  const cfg = loadEvalConfig();
  if (!cfg.token) {
    console.error(
      "AUTH_BOOTSTRAP_TOKEN is required (server AUTH_ALLOW_BOOTSTRAP=true).",
    );
    process.exit(2);
  }

  await healthCheck(cfg);

  const usageSessionId = opts?.usageSessionId ?? newEvalSessionId("ingest");
  await startTokenTracking(usageSessionId, "ingest");

  const bootstrapUserEmail =
    process.env.SEED_USER_EMAIL ?? "owner@yaadora.local";
  console.log(
    `\n  Bootstrap user: ${bootstrapUserEmail} (reused if already exists — not a new user per run)`,
  );
  console.log(`  Token session:  ${usageSessionId}`);

  const clientToId = await seedAll(cfg, GOLDEN_DATASET);
  const idToClient = new Map(
    [...clientToId.entries()].map(([c, id]) => [id, c]),
  );
  const ids = [...clientToId.values()];

  const memExps = cfg.only.length
    ? MEMORY_INGEST_EXPECTATIONS.filter(
        (e) =>
          cfg.only.includes(e.clientId) ||
          cfg.only.includes(`ingest-mem-${e.clientId}`),
      )
    : MEMORY_INGEST_EXPECTATIONS;

  // Live scoring state — updated as each memory settles.
  const checksById = new Map<string, CheckResult>();
  const details = new Map<string, MemoryDetail>();
  const settledLog: Array<{
    at: string;
    clientId?: string;
    memoryId: string;
    status: string;
    checkIds: string[];
  }> = [];

  await Bun.$`mkdir -p ${cfg.resultsDir}`.quiet();
  const livePath = `${cfg.resultsDir}/live-ingest.json`;

  async function writeLiveProgress(extra: Record<string, unknown> = {}) {
    const checks = [...checksById.values()];
    const passed = checks.filter((c) => c.passed).length;
    const payload = {
      updatedAt: new Date().toISOString(),
      usageSessionId,
      bootstrapUserEmail,
      ...extra,
      checksSoFar: checks.length,
      checksPassed: passed,
      settled: settledLog,
      checks,
    };
    await Bun.write(livePath, JSON.stringify(payload, null, 2));
  }

  /** Score all expectations that target this clientId (and print a one-liner). */
  async function scoreClientLive(
    clientId: string | undefined,
    memoryId: string,
    status: "processed" | "failed",
  ) {
    if (!clientId) return;
    const related = memExps.filter((e) => e.clientId === clientId);
    if (related.length === 0) {
      // No authored expectation — still note settle in live log.
      settledLog.push({
        at: new Date().toISOString(),
        clientId,
        memoryId,
        status,
        checkIds: [],
      });
      return;
    }

    if (status === "failed") {
      for (const exp of related) {
        const r = scoreMemoryExpectation(exp, null, "failed");
        checksById.set(r.id, r);
        console.log(
          `         ↳ check ${r.id}: FAIL — ${r.reason}`,
        );
      }
      settledLog.push({
        at: new Date().toISOString(),
        clientId,
        memoryId,
        status,
        checkIds: related.map((e) => `ingest-mem-${e.clientId}`),
      });
      await writeLiveProgress({
        last: { clientId, status: "failed" },
      });
      return;
    }

    try {
      const d = await getMemoryDetail(cfg, memoryId);
      details.set(clientId, d);
      const checkIds: string[] = [];
      for (const exp of related) {
        const r = scoreMemoryExpectation(exp, d, "processed");
        checksById.set(r.id, r);
        checkIds.push(r.id);
        const mark = r.passed ? "PASS" : "FAIL";
        console.log(
          `         ↳ check ${r.id}: ${mark}${r.passed ? "" : ` — ${r.reason}`}`,
        );
        if (r.passed && r.details) {
          const nFacts = r.details.nFacts ?? "?";
          const nEnt = r.details.nEntities ?? "?";
          const nLoops = r.details.nOpenLoops ?? "?";
          const nRem = r.details.nReminders ?? "?";
          console.log(
            `            facts=${nFacts} entities=${nEnt} loops=${nLoops} reminders=${nRem}`,
          );
        }
      }
      settledLog.push({
        at: new Date().toISOString(),
        clientId,
        memoryId,
        status,
        checkIds,
      });
    } catch (err) {
      for (const exp of related) {
        const r: CheckResult = {
          id: `ingest-mem-${exp.clientId}`,
          stage: "ingest",
          category: exp.category,
          subject: exp.clientId,
          passed: false,
          reason: `detail fetch failed: ${err instanceof Error ? err.message : err}`,
        };
        checksById.set(r.id, r);
        console.log(`         ↳ check ${r.id}: FAIL — ${r.reason}`);
      }
      settledLog.push({
        at: new Date().toISOString(),
        clientId,
        memoryId,
        status: "processed",
        checkIds: related.map((e) => `ingest-mem-${e.clientId}`),
      });
    }
    await writeLiveProgress({ last: { clientId, status } });
  }

  const { processed, failed, stillPending, timedOut } = await waitForProcessing(
    cfg,
    ids,
    {
      idToClient,
      softTimeout: true,
      onSettle: async (ev) => {
        await scoreClientLive(ev.clientId, ev.memoryId, ev.status);
      },
    },
  );

  // Expectations for clientIds that never settled (timeout)
  for (const mid of stillPending) {
    const cid = idToClient.get(mid);
    if (!cid) continue;
    for (const exp of memExps.filter((e) => e.clientId === cid)) {
      if (checksById.has(`ingest-mem-${exp.clientId}`)) continue;
      checksById.set(`ingest-mem-${exp.clientId}`, {
        id: `ingest-mem-${exp.clientId}`,
        stage: "ingest",
        category: exp.category,
        subject: exp.clientId,
        passed: false,
        reason: "still pending when wait timed out",
      });
    }
  }

  // Expectations whose memories never appeared in settle (shouldn't happen often)
  for (const exp of memExps) {
    const key = `ingest-mem-${exp.clientId}`;
    if (checksById.has(key)) continue;
    const mid = clientToId.get(exp.clientId);
    if (!mid) {
      checksById.set(key, scoreMemoryExpectation(exp, null, "missing"));
    }
  }

  await saveState(cfg, {
    clientToId: Object.fromEntries(clientToId),
    processedIds: processed,
    failedIds: failed,
  });

  console.log("\nScoring global graph expectations ...");
  // Details for supersession globals
  for (const g of GLOBAL_INGEST_EXPECTATIONS) {
    if (!g.supersession) continue;
    for (const cid of [g.supersession.oldClientId, g.supersession.newClientId]) {
      if (details.has(cid)) continue;
      const mid = clientToId.get(cid);
      if (!mid || failed.includes(mid) || stillPending.includes(mid)) continue;
      try {
        details.set(cid, await getMemoryDetail(cfg, mid));
      } catch {
        /* scored as fail below */
      }
    }
  }

  const globalExps = cfg.only.length
    ? GLOBAL_INGEST_EXPECTATIONS.filter((e) => cfg.only.includes(e.id))
    : GLOBAL_INGEST_EXPECTATIONS;

  for (const exp of globalExps) {
    const r = await scoreGlobal(exp, clientToId, cfg, details);
    checksById.set(r.id, r);
    console.log(
      `  global ${r.id}: ${r.passed ? "PASS" : "FAIL"}${r.passed ? "" : ` — ${r.reason}`}`,
    );
  }

  const checks = [...checksById.values()];

  // Process-all gate as a check
  const allProcessed =
    failed.length === 0 && stillPending.length === 0 && processed.length === ids.length;
  checks.push({
    id: "ingest-all-processed",
    stage: "ingest",
    category: "processed",
    subject: "dataset",
    passed: cfg.requireAllProcessed ? allProcessed : true,
    reason: allProcessed
      ? `all ${processed.length} processed`
      : `ok=${processed.length} fail=${failed.length} pending=${stillPending.length}${timedOut ? " (timeout)" : ""}`,
    details: {
      processed: processed.length,
      failed: failed.length,
      pending: stillPending.length,
      timedOut,
    },
  });

  const passRate =
    checks.length === 0 ? 1 : checks.filter((c) => c.passed).length / checks.length;
  const gatesPassed =
    passRate >= cfg.minIngestPassRate &&
    (!cfg.requireAllProcessed || allProcessed);

  const stage = summarizeStage(
    "ingest",
    checks,
    {
      passRate: r3(passRate),
      minPassRate: cfg.minIngestPassRate,
      processed: processed.length,
      failed: failed.length,
      pending: stillPending.length,
      timedOut,
      datasetSize: GOLDEN_DATASET.length,
      expectations: checks.length,
    },
    gatesPassed,
  );

  let tokens: EvalReport["tokens"];
  if (!opts?.deferTokenSummary) {
    // Give the worker a moment to flush last usage events to Redis.
    await Bun.sleep(1500);
    tokens = await finishTokenTracking(usageSessionId);
  }

  const report: EvalReport = {
    ranAt: new Date().toISOString(),
    command: "ingest",
    stages: [stage],
    checks,
    gatesPassed,
    clientToId: Object.fromEntries(clientToId),
    tokens,
    bootstrapUserEmail,
  };

  await Bun.write(
    `${cfg.resultsDir}/usage-session.json`,
    JSON.stringify({ sessionId: usageSessionId, phase: "ingest" }, null, 2),
  );
  // Final snapshot of live file
  await writeLiveProgress({
    finished: true,
    processed: processed.length,
    failed: failed.length,
    pending: stillPending.length,
    timedOut,
    gatesPassed,
  });

  printReport(report);
  await writeReport(cfg, report);
  console.log(`Live progress (updated during run): ${livePath}`);
  return report;
}

if (import.meta.main) {
  runIngest()
    .then((r) => process.exit(r.gatesPassed ? 0 : 1))
    .catch((err) => {
      console.error("\nIngest eval crashed:", err);
      process.exit(2);
    });
}
