/**
 * Eval cases — the authored regression set for Yaadora retrieval + reasoning.
 *
 * Each case is a probe of the ONE core principle (CONTEXT.md): never invent a
 * memory, always ground in retrieved sources, prefer current truth over stale.
 *
 * A case references EXPECTED memories by `clientId` (from dataset.ts). The runner
 * resolves clientId -> the server-generated memoryId, runs the question through
 * the real `/ask` pipeline, and scores the returned citations against these
 * expectations.
 *
 * Case shapes:
 *   - RETRIEVAL case  : `expect` lists clientIds that MUST appear in citations.
 *                       Optionally `forbid` lists clientIds that must NOT be the
 *                       cited answer (the stale/decoy trap).
 *   - REFUSAL case    : `expectRefusal: true` — the app must honestly decline
 *                       ("I don't have a memory about that"), never fabricate.
 *
 * `category` slices the report so you can see, e.g., that supersession is at 90%
 * while entity-collision is at 60% and needs work.
 */

export type EvalCategory =
  | "recall" // distinctive episodic lookup
  | "entity-completeness" // "everything about X"
  | "entity-collision" // two entities share a name
  | "supersession" // current truth, not the stale fact
  | "factual" // atomic fact lookup
  | "preference" // stated preference
  | "refusal" // no memory exists -> must decline
  | "temporal" // time-scoped ("last Tuesday")
  | "reasoning" // decision mode over own history
  | "reminder"; // prospective / intent surfacing

export interface EvalCase {
  id: string;
  question: string;
  category: EvalCategory;
  /** clientIds that MUST be present among the answer's citations (recall). */
  expect?: string[];
  /**
   * clientIds that must NOT be the basis of the answer. Used for supersession
   * (stale fact) and decoys. A hit here is a correctness failure even if recall
   * looks fine.
   */
  forbid?: string[];
  /** true => the ONLY correct behaviour is an honest refusal. */
  expectRefusal?: boolean;
  /** why this case exists / what it guards against. */
  note: string;
}

export const EVAL_CASES: EvalCase[] = [
  // ── Recall (distinctive episodic) ─────────────────────────────────────────
  {
    id: "c-react-decision",
    question: "What did I decide to use for the new project's frontend?",
    category: "recall",
    expect: ["g-proj-react"],
    forbid: ["g-proj-vue-decoy"],
    note: "React decision must win over the Vue/Angular recruiter decoy.",
  },
  {
    id: "c-db-decision",
    question: "Which database did we settle on for the new project?",
    category: "recall",
    expect: ["g-proj-postgres"],
    note: "Postgres+pgvector decision.",
  },
  {
    id: "c-goa-trip",
    question: "Where did I spend last New Year's?",
    category: "recall",
    expect: ["g-trip-goa"],
    note: "Distinctive past episode.",
  },

  // ── Entity completeness ───────────────────────────────────────────────────
  {
    id: "c-max-all",
    question: "Tell me everything I know about my dog Max.",
    category: "entity-completeness",
    expect: ["g-id-dog", "g-id-dog-breed"],
    note: "Graph channel must gather both Max facts, not just one.",
  },

  // ── Entity collision (the two Urhans) ─────────────────────────────────────
  {
    id: "c-urhan-colleague",
    question: "What did my colleague Urhan do at work recently?",
    category: "entity-collision",
    expect: ["g-urhan-colleague-1", "g-urhan-colleague-2"],
    forbid: ["g-urhan-friend-1", "g-urhan-friend-2"],
    note: "Must return the WORK Urhan only; the friend Urhan is a wrong-person trap.",
  },
  {
    id: "c-urhan-friend",
    question: "What's going on with my friend Urhan from college?",
    category: "entity-collision",
    expect: ["g-urhan-friend-1", "g-urhan-friend-2"],
    forbid: ["g-urhan-colleague-1", "g-urhan-colleague-2"],
    note: "Mirror case — the friend Urhan only.",
  },

  // ── Supersession (current truth, not stale) ───────────────────────────────
  {
    id: "c-where-live",
    question: "Where do I live now?",
    category: "supersession",
    expect: ["g-loc-new"],
    forbid: ["g-loc-old"],
    note: "Pune (current) must win; Mumbai is superseded.",
  },
  {
    id: "c-where-work",
    question: "Where do I work?",
    category: "supersession",
    expect: ["g-job-new"],
    forbid: ["g-job-old"],
    note: "Acme (current) must win; Northwind is superseded.",
  },
  {
    id: "c-sleep",
    question: "What time do I actually go to sleep these days?",
    category: "supersession",
    expect: ["g-sleep-new"],
    forbid: ["g-sleep-old"],
    note: "Current sleep reality, not the old 11pm intention.",
  },

  // ── Factual ───────────────────────────────────────────────────────────────
  {
    id: "c-allergy",
    question: "Am I allergic to anything?",
    category: "factual",
    expect: ["g-fact-allergy"],
    note: "Safety-relevant fact — recall must be reliable.",
  },
  {
    id: "c-sarah-food",
    question: "What kind of food does Sarah like?",
    category: "factual",
    expect: ["g-pref-food-sarah"],
    note: "Fact attached to a linked entity (Sarah).",
  },

  // ── Preference ────────────────────────────────────────────────────────────
  {
    id: "c-coffee-tea",
    question: "Do I prefer coffee or tea in the morning?",
    category: "preference",
    expect: ["g-pref-coffee"],
    note: "Stated preference.",
  },

  // ── Refusal (no such memory — the anti-hallucination guard) ───────────────
  {
    id: "c-sister",
    question: "What is my sister's name?",
    category: "refusal",
    expectRefusal: true,
    note: "No sibling ever mentioned. Must decline, never invent a name.",
  },
  {
    id: "c-car",
    question: "What car do I drive?",
    category: "refusal",
    expectRefusal: true,
    note: "No vehicle in the log. Must decline.",
  },
  {
    id: "c-salary",
    question: "How much money do I have in my savings account?",
    category: "refusal",
    expectRefusal: true,
    note: "Never recorded. Must decline rather than guess from the bank/mortgage memory.",
  },

  // ── Temporal (needs backdated seed to be fully trustworthy) ───────────────
  {
    id: "c-last-tuesday",
    question: "What did I decide in my meeting last Tuesday?",
    category: "temporal",
    expect: ["g-proj-react"],
    note: "Time-scoped recall. See runner notes: backdate occurredAt for a true test.",
  },

  // ── Reasoning / decision mode ─────────────────────────────────────────────
  {
    id: "c-decision-job",
    question:
      "I'm thinking about whether leaving Northwind for Acme was the right call. What does my own history suggest?",
    category: "reasoning",
    expect: ["g-job-new", "g-job-old"],
    note: "Decision mode must ground in the user's OWN job memories, not give generic career advice.",
  },

  // ── Reminder / prospective memory ─────────────────────────────────────────
  {
    id: "c-renew",
    question: "Is there anything I've been meaning to renew?",
    category: "reminder",
    expect: ["g-intent-passport"],
    note: "Surfaces an implicit future action from the intent memory.",
  },
];

export const CASE_COUNT = EVAL_CASES.length;
