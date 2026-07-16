import { getDigest, getDueOpenLoops } from "@repo/db";

/**
 * The context pack (spec 02 §4) — the small, always-present working memory
 * assembled fresh per `/ask` turn, so search becomes the tool for *depth*, not
 * the only door into memory (spec 01 D8).
 *
 * This is the **v1 / P0** pack: profile summary + 7-day digest + near-dated open
 * loops. The two higher-priority slots — matched standing rules (P1) and an
 * approved nudge directive (P2) — are present here only as typed no-op stubs so
 * later phases fill them without changing the assembly/budget contract.
 *
 * Budget: ≤2,000 tokens, HARD-TRUNCATED in the priority order
 *   rules > nudge > dated loops > digest > profile
 * (spec 02 §4). "Priority" means the highest-priority slots are kept first; when
 * the budget runs out the lowest-priority slot is truncated, then dropped, then
 * the next one up, and so on. Rules and nudge, being stubs, cost nothing in P0.
 *
 * Assembly is one SQL round-trip (three cache-like reads). No LLM call — the
 * summaries were precomputed by nightly consolidation (§3.2), which is what keeps
 * the pack cheap and instant.
 */

/** Hard token ceiling for the whole pack (spec 02 §4). */
export const CONTEXT_PACK_TOKEN_BUDGET = 2000;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Near window for dated open loops (spec 02 §4: due ≤7d). */
const DEFAULT_LOOP_HORIZON_DAYS = 7;

/**
 * Cheap, model-agnostic token estimate (~4 chars/token). Deliberately an
 * over-estimate-friendly heuristic: the pack ships as system-prompt text and the
 * budget is a guardrail, not an accounting figure. A precise tokenizer can drop
 * in later without changing the truncation contract.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** A matched standing rule. P1 (rules doorway, spec 02 §5.1) populates this. */
export interface RuleSlot {
  id: string;
  ruleText: string;
}

/**
 * A gate-approved nudge the agent may weave in (spec 02 §5.4). P2 (prospection)
 * populates this; `evidence` are the memory ids shown as receipts.
 */
export interface NudgeDirective {
  text: string;
  evidence: string[];
}

/** A near-dated open loop rendered as one "open thread" line. */
export interface LoopLine {
  id: string;
  kind: string;
  title: string;
  dueAt: Date | null;
}

/** The raw slot inputs, before budgeting/rendering. */
export interface ContextPackSlots {
  profile: string | null;
  weekDigest: string | null;
  loops: LoopLine[];
  /** P1 stub — always empty in P0. */
  rules: RuleSlot[];
  /** P2 stub — always null in P0. */
  nudge: NudgeDirective | null;
}

export interface ContextPack extends ContextPackSlots {
  /** The rendered system-prompt section, guaranteed ≤ budget. */
  text: string;
  estimatedTokens: number;
}

const PACK_HEADER = "## What you currently know (context pack)";

/** Render each populated slot to its labelled block (spec 02 §4 template). */
function renderProfile(profile: string): string {
  return `About the user: ${profile}`;
}
function renderDigest(digest: string): string {
  return `This week: ${digest}`;
}
function renderRules(rules: RuleSlot[]): string {
  const lines = rules.map((r, i) => `  ${i + 1}. ${r.ruleText}`);
  return [
    "Standing rules for THIS task (apply them visibly, they override generic behavior):",
    ...lines,
  ].join("\n");
}
function renderLoops(loops: LoopLine[]): string {
  const lines = loops.map((l) => {
    const due = l.dueAt ? ` (due ${l.dueAt.toISOString().slice(0, 10)})` : "";
    return `- ${l.title}${due}`;
  });
  return ["Open threads:", ...lines].join("\n");
}
function renderNudge(nudge: NudgeDirective): string {
  const refs = nudge.evidence.length ? ` Evidence: ${nudge.evidence.join(", ")}.` : "";
  return [
    `You may bring up ONE thing naturally if a seam appears: ${nudge.text}.${refs}`,
    "Weave it in like a friend would; do not force it; skip it if the moment is wrong.",
  ].join("\n");
}

/** Hard-truncate a block to at most `maxTokens`, keeping whole lines where it can. */
function truncateBlock(block: string, maxTokens: number): string | null {
  if (maxTokens <= 0) return null;
  if (estimateTokens(block) <= maxTokens) return block;
  const maxChars = maxTokens * 4;
  const sliced = block.slice(0, Math.max(0, maxChars - 1)).trimEnd();
  if (!sliced) return null;
  return `${sliced}…`;
}

/**
 * Assemble + budget the pack text from raw slots. Pure and DB-free so the budget
 * invariant is unit-testable without a database. Slots are filled in priority
 * order (rules > nudge > loops > digest > profile); the overflowing slot is
 * hard-truncated and lower-priority slots are dropped. A final clamp guarantees
 * the returned text never exceeds the budget regardless of heuristic drift.
 */
export function buildContextPackText(
  slots: ContextPackSlots,
  budget = CONTEXT_PACK_TOKEN_BUDGET,
): { text: string; estimatedTokens: number } {
  // (key, rendered block) in PRIORITY order (highest first). Empty slots absent.
  const byPriority: Array<{ key: keyof ContextPackSlots; block: string }> = [];
  if (slots.rules.length) byPriority.push({ key: "rules", block: renderRules(slots.rules) });
  if (slots.nudge) byPriority.push({ key: "nudge", block: renderNudge(slots.nudge) });
  if (slots.loops.length) byPriority.push({ key: "loops", block: renderLoops(slots.loops) });
  if (slots.weekDigest) byPriority.push({ key: "weekDigest", block: renderDigest(slots.weekDigest) });
  if (slots.profile) byPriority.push({ key: "profile", block: renderProfile(slots.profile) });

  // Greedily include under budget; truncate the first block that overflows, drop
  // the rest. The header is always counted.
  let remaining = budget - estimateTokens(PACK_HEADER);
  const kept = new Map<keyof ContextPackSlots, string>();
  for (const { key, block } of byPriority) {
    if (remaining <= 0) break;
    const cost = estimateTokens(block) + 1; // +1 token for the joining newline
    if (cost <= remaining) {
      kept.set(key, block);
      remaining -= cost;
    } else {
      const truncated = truncateBlock(block, remaining - 1);
      if (truncated) kept.set(key, truncated);
      remaining = 0;
      break;
    }
  }

  // Render kept blocks in DISPLAY order (spec 02 §4 template), independent of the
  // priority order used for budgeting.
  const displayOrder: Array<keyof ContextPackSlots> = [
    "profile",
    "weekDigest",
    "rules",
    "loops",
    "nudge",
  ];
  const parts = [PACK_HEADER];
  for (const key of displayOrder) {
    const block = kept.get(key);
    if (block) parts.push(block);
  }

  let text = parts.join("\n");
  // Defensive final clamp — the invariant the whole design leans on.
  if (estimateTokens(text) > budget) text = text.slice(0, budget * 4);
  return { text, estimatedTokens: estimateTokens(text) };
}

export interface AssembleContextPackParams {
  userId: string;
  /** "now" for the loop window; injectable for tests. Defaults to current time. */
  now?: Date;
  /** Near-window size for dated loops; defaults to 7 days (spec 02 §4). */
  horizonDays?: number;
}

/**
 * Assemble the P0 context pack for a user: read the two precomputed digests and
 * the near-dated open loops, then budget + render. Rules and nudge stay empty
 * stubs until P1/P2 wire in the matcher and awareness pass.
 */
export async function assembleContextPack(
  params: AssembleContextPackParams,
): Promise<ContextPack> {
  const { userId, now = new Date(), horizonDays = DEFAULT_LOOP_HORIZON_DAYS } = params;
  const within = new Date(now.getTime() + horizonDays * DAY_MS);

  const [profile, weekDigest, dueLoops] = await Promise.all([
    getDigest(userId, "profile"),
    getDigest(userId, "week"),
    getDueOpenLoops(userId, within),
  ]);

  const loops: LoopLine[] = dueLoops.map((l) => ({
    id: l.id,
    kind: l.kind,
    title: l.title,
    dueAt: l.dueAt,
  }));
  const rules: RuleSlot[] = []; // P1 stub
  const nudge: NudgeDirective | null = null; // P2 stub

  const slots: ContextPackSlots = { profile, weekDigest, loops, rules, nudge };
  const { text, estimatedTokens } = buildContextPackText(slots);
  return { ...slots, text, estimatedTokens };
}
