/**
 * Retrieval / Ask eval cases.
 *
 * Scored against POST /ask SSE: citations (recall/MRR/forbid), refusal, and
 * lightweight answer-quality patterns (answerMustMatch / answerMustNotMatch).
 * These are deterministic — no LLM-as-judge required for the v2 harness.
 */

export type RetrieveCategory =
  | "recall"
  | "entity-completeness"
  | "entity-collision"
  | "supersession"
  | "factual"
  | "preference"
  | "refusal"
  | "temporal"
  | "reasoning"
  | "reminder"
  | "open-loop"
  | "answer-quality"
  | "multi-hop";

export interface RetrieveCase {
  id: string;
  question: string;
  category: RetrieveCategory;
  note: string;
  /** clientIds that MUST appear among citations. */
  expect?: string[];
  /** clientIds that must NOT appear among citations. */
  forbid?: string[];
  /** true => only correct behaviour is honest refusal / no fabrication. */
  expectRefusal?: boolean;
  /**
   * Answer text must match at least one regex per group (OR within group).
   * Each string is a case-insensitive RegExp source.
   */
  answerMustMatch?: string[];
  /** Answer must not match any of these (case-insensitive). */
  answerMustNotMatch?: string[];
  /** Optional expected Ask mode. */
  expectMode?: "recall" | "reason" | "clarify";
}

export const RETRIEVE_CASES: RetrieveCase[] = [
  // ── Recall ────────────────────────────────────────────────────────────────
  {
    id: "c-react-decision",
    question: "What did I decide to use for the new project's frontend?",
    category: "recall",
    expect: ["g-proj-react"],
    forbid: ["g-proj-vue-decoy"],
    answerMustMatch: ["react"],
    answerMustNotMatch: ["vue", "angular"],
    note: "React decision must win over Vue/Angular decoy; answer names React.",
  },
  {
    id: "c-db-decision",
    question: "Which database did we settle on for the new project?",
    category: "recall",
    expect: ["g-proj-postgres"],
    // One OR-group: any of these names is enough (model may say only "Postgres").
    answerMustMatch: ["postgres|postgresql|pgvector"],
    note: "Postgres+pgvector decision.",
  },
  {
    id: "c-goa-trip",
    question: "Where did I spend last New Year's?",
    category: "recall",
    expect: ["g-trip-goa"],
    answerMustMatch: ["goa"],
    note: "Distinctive past episode.",
  },
  {
    id: "c-japan-trip",
    question: "What trip am I planning next?",
    category: "recall",
    expect: ["g-trip-japan"],
    answerMustMatch: ["japan|tokyo|kyoto"],
    note: "Future Japan trip surfaces.",
  },
  {
    id: "c-mentor",
    question: "Who is my mentor that I get coffee with?",
    category: "recall",
    expect: ["g-person-mentor"],
    answerMustMatch: ["priya"],
    note: "Priya mentor recall.",
  },

  // ── Entity completeness ───────────────────────────────────────────────────
  {
    id: "c-max-all",
    question: "Tell me everything I know about my dog Max.",
    category: "entity-completeness",
    expect: ["g-id-dog", "g-id-dog-breed"],
    answerMustMatch: ["max", "golden|retriever"],
    note: "Graph channel gathers Max facts.",
  },
  {
    id: "c-sarah-all",
    question: "What do you know about Sarah?",
    category: "entity-completeness",
    expect: ["g-id-wife"],
    answerMustMatch: ["sarah", "wife|italian|carbonara"],
    note: "Sarah is wife; food preference may also surface.",
  },

  // ── Entity collision ──────────────────────────────────────────────────────
  {
    id: "c-urhan-colleague",
    question: "What did my colleague Urhan do at work recently?",
    category: "entity-collision",
    expect: ["g-urhan-colleague-1", "g-urhan-colleague-2"],
    forbid: ["g-urhan-friend-1", "g-urhan-friend-2"],
    answerMustMatch: ["urhan", "pr|race|deadline|platform|standup|review"],
    answerMustNotMatch: ["engaged", "hiking", "lonavala", "college"],
    note: "Work Urhan only.",
  },
  {
    id: "c-urhan-friend",
    question: "What's going on with my friend Urhan from college?",
    category: "entity-collision",
    expect: ["g-urhan-friend-1", "g-urhan-friend-2"],
    forbid: ["g-urhan-colleague-1", "g-urhan-colleague-2"],
    answerMustMatch: ["urhan", "engaged|hiking|college|lonavala|friend"],
    answerMustNotMatch: ["race condition", "standup", "platform team"],
    note: "Friend Urhan only.",
  },

  // ── Supersession ──────────────────────────────────────────────────────────
  {
    id: "c-where-live",
    question: "Where do I live now?",
    category: "supersession",
    expect: ["g-loc-new"],
    forbid: ["g-loc-old"],
    answerMustMatch: ["pune"],
    answerMustNotMatch: ["live in mumbai", "lives in mumbai"],
    note: "Pune current; Mumbai superseded.",
  },
  {
    id: "c-where-used-to-live",
    question: "Where did I used to live before I moved?",
    category: "supersession",
    expect: ["g-loc-old"],
    answerMustMatch: ["mumbai"],
    note: "Historical question may cite old location.",
  },
  {
    id: "c-where-work",
    question: "Where do I work?",
    category: "supersession",
    expect: ["g-job-new"],
    forbid: ["g-job-old"],
    answerMustMatch: ["acme"],
    answerMustNotMatch: ["work at northwind", "works at northwind"],
    note: "Acme current; Northwind stale.",
  },
  {
    id: "c-sleep",
    question: "What time do I actually go to sleep these days?",
    category: "supersession",
    expect: ["g-sleep-new"],
    forbid: ["g-sleep-old"],
    answerMustMatch: ["midnight|past midnight|late"],
    note: "Current sleep reality.",
  },

  // ── Factual / preference ──────────────────────────────────────────────────
  {
    id: "c-allergy",
    question: "Am I allergic to anything?",
    category: "factual",
    expect: ["g-fact-allergy"],
    answerMustMatch: ["peanut"],
    note: "Safety-relevant fact.",
  },
  {
    id: "c-allergy-paraphrase",
    question: "Any food allergies I should never forget?",
    category: "factual",
    expect: ["g-fact-allergy"],
    answerMustMatch: ["peanut"],
    note: "Paraphrase of allergy question.",
  },
  {
    id: "c-sarah-food",
    question: "What kind of food does Sarah like?",
    category: "factual",
    expect: ["g-pref-food-sarah"],
    answerMustMatch: ["italian|carbonara"],
    note: "Fact on linked entity Sarah.",
  },
  {
    id: "c-coffee-tea",
    question: "Do I prefer coffee or tea in the morning?",
    category: "preference",
    expect: ["g-pref-coffee"],
    answerMustMatch: ["coffee"],
    note: "Stated preference.",
  },
  {
    id: "c-favorite-color",
    question: "What's my favorite color?",
    category: "preference",
    expect: ["g-pref-color"],
    answerMustMatch: ["blue"],
    note: "Simple preference.",
  },
  {
    id: "c-rust-goal",
    question: "What am I trying to get good at this year?",
    category: "factual",
    expect: ["g-goal-rust"],
    answerMustMatch: ["rust"],
    note: "Learning goal.",
  },

  // ── Refusal ───────────────────────────────────────────────────────────────
  {
    id: "c-sister",
    question: "What is my sister's name?",
    category: "refusal",
    expectRefusal: true,
    note: "No sibling — must not invent.",
  },
  {
    id: "c-car",
    question: "What car do I drive?",
    category: "refusal",
    expectRefusal: true,
    note: "No vehicle — must decline.",
  },
  {
    id: "c-salary",
    question: "How much money do I have in my savings account?",
    category: "refusal",
    expectRefusal: true,
    note: "Never recorded — do not guess from mortgage mention.",
  },
  {
    id: "c-kids",
    question: "What are my kids' names?",
    category: "refusal",
    expectRefusal: true,
    note: "No children in log.",
  },

  // ── Temporal (best-effort without backdated seed) ─────────────────────────
  {
    id: "c-last-tuesday",
    question: "What did I decide in my meeting last Tuesday?",
    category: "temporal",
    expect: ["g-proj-react"],
    answerMustMatch: ["react"],
    note: "Time-scoped; fully trustworthy only with backdated occurredAt.",
  },

  // ── Reasoning ─────────────────────────────────────────────────────────────
  {
    id: "c-decision-job",
    question:
      "I'm thinking about whether leaving Northwind for Acme was the right call. What does my own history suggest?",
    category: "reasoning",
    expect: ["g-job-new", "g-job-old"],
    answerMustMatch: ["acme|northwind"],
    answerMustNotMatch: [
      "as an ai",
      "i don't have personal",
      "generally speaking you should",
    ],
    note: "Decision mode grounds in OWN job memories.",
  },
  {
    id: "c-decision-running",
    question: "Should I keep running? What does my recent history say?",
    category: "reasoning",
    expect: ["g-hobby-run"],
    answerMustMatch: ["run|5k|running"],
    note: "Grounded in hobby memory, not generic fitness advice alone.",
  },

  // ── Reminder / prospective ────────────────────────────────────────────────
  {
    id: "c-renew",
    question: "Is there anything I've been meaning to renew?",
    category: "reminder",
    expect: ["g-intent-passport"],
    answerMustMatch: ["passport"],
    note: "Surfaces passport renew intent.",
  },
  {
    id: "c-bank-remind",
    question: "What did I want to call the bank about?",
    category: "reminder",
    expect: ["g-intent-bank"],
    answerMustMatch: ["bank|mortgage|rate"],
    note: "Explicit remind-me bank memory.",
  },

  // ── Open loops ────────────────────────────────────────────────────────────
  {
    id: "c-equity-loop",
    question: "Is there anything unfinished with Rahul?",
    category: "open-loop",
    // After resolution memory, answer may say settled; still should cite equity memories.
    expect: ["g-loop-equity", "g-loop-equity-done"],
    answerMustMatch: ["equity|rahul|split|60"],
    note: "Open-loop story about Rahul equity — includes resolution.",
  },

  // ── Multi-hop ─────────────────────────────────────────────────────────────
  {
    id: "c-multihop-sarah-pune",
    question: "What food does my wife like, and where do we live now?",
    category: "multi-hop",
    expect: ["g-pref-food-sarah", "g-loc-new"],
    answerMustMatch: ["italian|carbonara", "pune"],
    note: "Two facts in one answer: Sarah food + current city.",
  },
  {
    id: "c-multihop-max-breed",
    question: "What's my dog's name and breed?",
    category: "multi-hop",
    expect: ["g-id-dog", "g-id-dog-breed"],
    answerMustMatch: ["max", "golden|retriever"],
    note: "Name + breed multi-hop.",
  },

  // ── Answer quality / grounding voice ──────────────────────────────────────
  {
    id: "c-name-self",
    question: "What's my name?",
    category: "answer-quality",
    expect: ["g-id-name"],
    answerMustMatch: ["kabir"],
    note: "Basic identity.",
  },
  {
    id: "c-breaking-bad",
    question: "What show did I finally finish?",
    category: "answer-quality",
    expect: ["g-media-show"],
    answerMustMatch: ["breaking bad"],
    note: "Media memory.",
  },
];

export const RETRIEVE_CASE_COUNT = RETRIEVE_CASES.length;

/** @deprecated alias for older imports */
export type EvalCategory = RetrieveCategory;
export type EvalCase = RetrieveCase;
export const EVAL_CASES = RETRIEVE_CASES;
export const CASE_COUNT = RETRIEVE_CASE_COUNT;
