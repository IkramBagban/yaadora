import { getDigest, getDueOpenLoops } from "@repo/db";

/**
 * The context pack (spec 02 §4) — the small, always-present working memory
 * assembled fresh per `/ask` turn, so search becomes the tool for *depth*, not
 * the only door into memory (spec 01 D8).
 *
 * Pack slots: profile summary + 7-day digest + near-dated open loops + matched
 * standing rules (P1, filled by the rule matcher) + nudge directive (P2,
 * awareness pass + gates) + entity context (P3, graph doorway pre-fetch).
 *
 * Budget: ≤2,000 tokens, HARD-TRUNCATED in the priority order
 *   rules > nudge > dated loops > entity context > onYourMind > digest > profile
 * (spec 02 §4, extended in P3 — entity context sits after dated loops; P5/spec
 * 04 add the `onYourMind` section just below it, the first slot dropped under
 * pressure).
 * "Priority" means the highest-priority slots are kept first; when
 * the budget runs out the lowest-priority slot is truncated, then dropped, then
 * the next one up, and so on.
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
  /**
   * Content kind (spec 02 §5.4). Drives kind-specific weaving guidance — most
   * importantly `intention_nudge`, whose directive MUST force a question, never
   * a judgment (spec 03 P4: "framing is the feature").
   */
  kind?: string;
}

/** A near-dated open loop rendered as one "open thread" line. */
export interface LoopLine {
  id: string;
  kind: string;
  title: string;
  dueAt: Date | null;
}

/**
 * A pattern observation selected by P5's `selectObservation` (spec 03 P5). This
 * is the RAW pattern shape; it feeds into the generalized `onYourMind` section
 * (spec 04 §3.4) as one dossier kind, unchanged. `receipts` are the memory ids
 * shown as sources.
 */
export interface ObservationSlot {
  id: string;
  text: string;
  receipts: string[];
}

/**
 * One "on your mind" dossier (spec 04 §3.4) — a thing from the user's life the
 * agent MAY touch on, or not. Generalizes P5's pattern observation into a single
 * section carrying up to 3 dossiers of ANY kind: mined `pattern` insights (P5's
 * selection feeds in unchanged), follow-up `followup` threads/loops, and
 * `absence` candidates. Never a directive — it rides in as low-priority context
 * and the agent decides, from the guidance in `renderOnYourMind` and the full
 * raising history, whether to raise AT MOST ONE. Suppression stays code+state:
 * dismissed / budget-blocked / toggle-excluded subjects are filtered out before
 * they ever reach this slot (spec 01 D5). If the agent raises one it MUST call
 * `note_surfaced(id)` so the ledger records it — the only reliable signal a
 * naturally-woven follow-up was shown.
 */
export interface OnYourMindDossier {
  /** pattern_fact | open_loop | entity — drives note_surfaced's ledger row. */
  kind: "pattern" | "followup" | "absence";
  /** subjectId: pattern_fact id | open_loop id | entity id. */
  id: string;
  summary: string;
  receipts: string[];
  /** Dated threads: when it was due (whether it has passed). */
  dueAt?: Date | null;
  /** "What's happened since" — later memories touching the same entity/topic. */
  sinceThen?: Array<{ id: string; snippet: string }>;
  /** Every prior non-suppressed raise of this subject, with the user's reaction. */
  raisingHistory?: Array<{ shownAt: Date; channel: string; reaction: string | null }>;
}

/**
 * Pre-fetched entity context for entities confidently linked this turn (spec 02
 * §5.2, P3 graph doorway). `text` is the already-rendered, delimited block
 * (`renderEntityContext`); `entityIds` / `receipts` ride along for the trace and
 * grounding.
 */
export interface EntityContextSlot {
  text: string;
  entityIds: string[];
  receipts: string[];
}

/** The raw slot inputs, before budgeting/rendering. */
export interface ContextPackSlots {
  profile: string | null;
  weekDigest: string | null;
  loops: LoopLine[];
  /** Matched standing rules (0–3). Filled by the rule matcher (spec 02 §5.1). */
  rules: RuleSlot[];
  /** Gate-approved nudge directive (0–1). Filled by awareness + gates (P2). */
  nudge: NudgeDirective | null;
  /**
   * Pre-fetched entity context for entities linked this turn (spec 02 §5.2, P3).
   * Sits below loops in display order and after them in budget priority.
   */
  entityContext?: EntityContextSlot | null;
  /**
   * Up to 3 "on your mind" dossiers the agent MAY touch on — mined patterns,
   * follow-up threads, absence candidates (spec 04 §3.4). Lowest proactive
   * priority: the first slot dropped under budget pressure, because a
   * might-mention is never worth crowding out a rule, a due loop, or entity
   * context. Empty/absent when nothing qualifies (the common case). A turn never
   * carries both a gated nudge and this section — an approved nudge drops it at
   * pack assembly (the single-proactive-moment invariant, spec 04 §3.4).
   */
  onYourMind?: OnYourMindDossier[];
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

  // Held intentions (spec 03 P4) — framing IS the feature. This nudge holds a
  // PAST commitment up beside what the user is doing now, and it must land as an
  // open question, never a verdict.
  if (nudge.kind === "intention_nudge") {
    return [
      `You may gently raise ONE thing IF a natural seam appears, and ONLY as an open question: ${nudge.text}.${refs}`,
      "This concerns a commitment the user made earlier that their current message may be in tension with. Frame it as a genuine question that names the earlier commitment and asks whether it has changed. It may well be a deliberate, sensible update — treat it that way. Do NOT scold, do NOT assume they've drifted or failed, do NOT lecture. Cite the receipt so they can tap the original. If the moment isn't right, skip it entirely.",
    ].join("\n");
  }

  return [
    `You may bring up ONE thing naturally if a seam appears: ${nudge.text}.${refs}`,
    "Weave it in like a friend would; do not force it; skip it if the moment is wrong.",
  ].join("\n");
}
function renderEntityContextSlot(slot: EntityContextSlot): string {
  return [
    "About people/projects in this turn (their profile, open threads, current facts and connections — memory ids in [brackets] are receipts):",
    slot.text,
  ].join("\n");
}
/**
 * Render the `onYourMind` section (spec 04 §3.4). Framing IS the guardrail
 * (spec 01 anti-scenarios): each dossier is a thing a friend MIGHT re-notice, so
 * the guidance is history-first, silence-by-default, and at most one. The
 * phrasing must be the agent's own, generated fresh — never a stored template.
 */
function renderOnYourMind(dossiers: OnYourMindDossier[]): string {
  const lines = dossiers.map((d) => {
    const parts: string[] = [d.summary];
    if (d.dueAt) {
      parts.push(`was due ${d.dueAt.toISOString().slice(0, 10)}`);
    }
    if (d.sinceThen && d.sinceThen.length) {
      parts.push(
        `what's happened since: ${d.sinceThen.map((s) => s.snippet).join(" | ")}`,
      );
    }
    if (d.raisingHistory && d.raisingHistory.length) {
      const hist = d.raisingHistory
        .map(
          (h) =>
            `${h.shownAt.toISOString().slice(0, 10)} (${h.channel}, ${h.reaction ?? "no response yet"})`,
        )
        .join("; ");
      parts.push(`you've raised this before — ${hist}`);
    } else {
      parts.push("never raised before");
    }
    if (d.receipts.length) parts.push(`receipts: ${d.receipts.join(", ")}`);
    return `  - ${parts.join(" · ")} (id: ${d.id})`;
  });
  return [
    "Things from their life that might be worth touching on — or not:",
    ...lines,
    "At most ONE of these, and only where it genuinely fits this conversation — as a friend would: in your own words, brief, with warmth, never as a notification. Check the history FIRST: if you raised it before and they didn't engage, it almost always stays unraised. If they already told you the outcome (see what's happened since), don't ask — acknowledge it instead. On most turns the right choice is to raise NOTHING. If you do raise one, you MUST call note_surfaced with its id so it is recorded and not repeated.",
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
  if (slots.entityContext?.text)
    byPriority.push({
      key: "entityContext",
      block: renderEntityContextSlot(slots.entityContext),
    });
  if (slots.onYourMind && slots.onYourMind.length)
    byPriority.push({ key: "onYourMind", block: renderOnYourMind(slots.onYourMind) });
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
    "entityContext",
    "onYourMind",
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
  /**
   * Pre-matched standing rules from the rules doorway (spec 02 §5.1). When the
   * agent runs matcher + pack SQL via Promise.all, it passes results here or
   * re-budgets with `buildContextPackText` after both settle.
   */
  rules?: RuleSlot[];
}

/**
 * Assemble the context pack for a user: read the two precomputed digests and
 * the near-dated open loops, then budget + render. Pass `rules` when the matcher
 * has already run (or re-budget in the agent after concurrent match).
 */
export async function assembleContextPack(
  params: AssembleContextPackParams,
): Promise<ContextPack> {
  const {
    userId,
    now = new Date(),
    horizonDays = DEFAULT_LOOP_HORIZON_DAYS,
    rules: matchedRules = [],
  } = params;
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
  const rules: RuleSlot[] = matchedRules;
  // Nudge is filled by the agent after the awareness pass + gates (spec 02 §5.4).
  const nudge: NudgeDirective | null = null;

  const slots: ContextPackSlots = { profile, weekDigest, loops, rules, nudge };
  const { text, estimatedTokens } = buildContextPackText(slots);
  return { ...slots, text, estimatedTokens };
}
