/**
 * Golden seed dataset — the authored baseline for Yaadora's retrieval eval.
 *
 * This is a small, coherent, FICTIONAL life-history written in the app's own
 * voice (first person, the way a user deposits memories). It is deliberately
 * engineered to exercise every known failure mode in the ingestion + retrieval
 * pipeline, so the eval cases in `cases.ts` have unambiguous right answers.
 *
 * Design rules for this file:
 *   1. Every entry has a STABLE `clientId`. Eval cases reference these ids, and
 *      the runner maps clientId -> server-generated memoryId after seeding. The
 *      raw memory UUIDs are non-deterministic, so clientIds are our anchor.
 *   2. Traps are intentional and labelled in `trap`:
 *        - collision      : two different entities that share a name (the two
 *                            "Urhan"s) — tests entity linking against over-merge.
 *        - supersession    : a fact that later changes (Mumbai -> Pune, job,
 *                            sleep time) — tests valid_to / current-truth.
 *        - reflection      : pure reflection that should yield NO fact, only an
 *                            embedding — tests that we don't hallucinate facts.
 *        - intent          : a future action — feeds the reminder engine.
 *        - decoy           : plausible-but-wrong neighbour that a naive vector
 *                            search would wrongly surface.
 *   3. `occurredHint` carries a relative/absolute time phrase for temporal
 *      cases. The worker resolves the authoritative occurredAt; the hint biases
 *      it. Seed-at-once means "yesterday" resolves to seed day — see the runner
 *      notes on backdating before trusting temporal recall numbers.
 *
 * Keep this dataset small and hand-verifiable. Grow it by harvesting real
 * retrieval failures into eval_cases (spec 01 §3.7), not by bulk-generating.
 */

export type Trap =
  | "collision"
  | "supersession"
  | "reflection"
  | "intent"
  | "decoy"
  | null;

export interface SeedMemory {
  /** stable anchor; the runner maps this -> the server memory id */
  clientId: string;
  /** verbatim first-person entry, exactly as a user would deposit it */
  rawText: string;
  /** optional time phrase to bias temporal resolution in the worker */
  occurredHint?: string;
  /** freeform tags for slicing the report (person, place, job, pet, ...) */
  tags: string[];
  /** which engineered failure mode, if any, this entry participates in */
  trap?: Trap;
  /** human note explaining the intent of this row */
  note?: string;
}

/**
 * The persona: a single user's memory log. Names and details are internally
 * consistent so questions have exactly one correct answer.
 */
export const GOLDEN_DATASET: SeedMemory[] = [
  // ── Identity ────────────────────────────────────────────────────────────
  { clientId: "g-id-name", rawText: "My name is Kabir Rao.", tags: ["identity", "self"] },
  { clientId: "g-id-wife", rawText: "My wife's name is Sarah.", tags: ["identity", "person", "sarah"] },
  { clientId: "g-id-dog", rawText: "I have a dog named Max.", tags: ["pet", "max"] },
  { clientId: "g-id-dog-breed", rawText: "Max is a golden retriever, almost three years old now.", tags: ["pet", "max"] },

  // ── Job (supersession: Northwind -> Acme) ─────────────────────────────────
  {
    clientId: "g-job-old",
    rawText: "I work as a backend engineer at Northwind Systems.",
    occurredHint: "two years ago",
    tags: ["job", "northwind"],
    trap: "supersession",
    note: "Stale job. Must NOT be returned as the answer to 'where do I work now'.",
  },
  {
    clientId: "g-job-new",
    rawText: "Today was my first day at Acme Robotics as a senior engineer. Left Northwind for it.",
    occurredHint: "last month",
    tags: ["job", "acme", "northwind"],
    trap: "supersession",
    note: "Current job. This is the correct answer for 'where do I work'.",
  },

  // ── Location (supersession: Mumbai -> Pune) ───────────────────────────────
  {
    clientId: "g-loc-old",
    rawText: "I live in Mumbai, in a flat near the coast.",
    occurredHint: "three years ago",
    tags: ["location", "mumbai"],
    trap: "supersession",
    note: "Stale location. Superseded by the move to Pune.",
  },
  {
    clientId: "g-loc-new",
    rawText: "We finally moved to Pune this weekend. New apartment, new city.",
    occurredHint: "last year",
    tags: ["location", "pune"],
    trap: "supersession",
    note: "Current location. Correct answer for 'where do I live'.",
  },

  // ── The two Urhans (collision — hardest linking trap) ─────────────────────
  {
    clientId: "g-urhan-friend-1",
    rawText: "Went hiking with my friend Urhan up in Lonavala. We've been friends since college.",
    tags: ["person", "urhan", "urhan-friend"],
    trap: "collision",
    note: "Urhan #1 = childhood friend. Different person from the colleague below.",
  },
  {
    clientId: "g-urhan-friend-2",
    rawText: "Urhan (my college friend) got engaged. So happy for him.",
    tags: ["person", "urhan", "urhan-friend"],
    trap: "collision",
    note: "Same friend Urhan. Should link to g-urhan-friend-1, not the colleague.",
  },
  {
    clientId: "g-urhan-colleague-1",
    rawText: "Urhan from the platform team pushed back on the deadline in standup today.",
    tags: ["person", "urhan", "urhan-colleague", "work"],
    trap: "collision",
    note: "Urhan #2 = work colleague. MUST stay a separate entity from the friend.",
  },
  {
    clientId: "g-urhan-colleague-2",
    rawText: "My colleague Urhan reviewed my PR and found a nasty race condition. Good catch.",
    tags: ["person", "urhan", "urhan-colleague", "work"],
    trap: "collision",
    note: "Same colleague Urhan. Should link to g-urhan-colleague-1.",
  },

  // ── Preferences / stable facts ────────────────────────────────────────────
  { clientId: "g-pref-coffee", rawText: "I much prefer coffee over tea in the morning. Tea just doesn't wake me up.", tags: ["preference", "coffee"] },
  { clientId: "g-pref-color", rawText: "My favorite color is blue.", tags: ["preference"] },
  { clientId: "g-fact-allergy", rawText: "I'm allergic to peanuts — it's serious, I carry an EpiPen.", tags: ["health", "allergy"] },
  { clientId: "g-pref-food-sarah", rawText: "Sarah loves Italian food, especially a good carbonara.", tags: ["person", "sarah", "food"] },

  // ── Sleep (supersession + soft contradiction) ─────────────────────────────
  {
    clientId: "g-sleep-old",
    rawText: "I've been trying to sleep by 11pm on weeknights.",
    occurredHint: "six months ago",
    tags: ["habit", "sleep"],
    trap: "supersession",
    note: "Old intent. Superseded by the honest admission below.",
  },
  {
    clientId: "g-sleep-new",
    rawText: "Who am I kidding, I sleep well past midnight most nights these days.",
    occurredHint: "last week",
    tags: ["habit", "sleep"],
    trap: "supersession",
    note: "Current reality of sleep habit.",
  },

  // ── Episodic events (project decisions, meetings) ─────────────────────────
  {
    clientId: "g-proj-react",
    rawText: "Had a long meeting with the design team and decided we'll use React for the new project's frontend.",
    occurredHint: "last Tuesday",
    tags: ["work", "project", "decision", "react"],
    note: "Distinctive episodic decision — clean recall target.",
  },
  {
    clientId: "g-proj-postgres",
    rawText: "Settled the database debate: Postgres with pgvector for the new project. No more arguing about it.",
    occurredHint: "last Wednesday",
    tags: ["work", "project", "decision", "postgres"],
  },
  {
    clientId: "g-proj-vue-decoy",
    rawText: "A recruiter pitched me a role at a startup that uses Vue and Angular. Not interested.",
    tags: ["work", "vue", "angular"],
    trap: "decoy",
    note: "Decoy for the React question — mentions frontend frameworks but is NOT the decision.",
  },

  // ── Intents / reminders (prospective memory) ──────────────────────────────
  {
    clientId: "g-intent-passport",
    rawText: "I need to renew my passport soon — it expires in a couple of months.",
    tags: ["intent", "admin", "passport"],
    trap: "intent",
    note: "Implicit future action -> reminder suggestion candidate.",
  },
  {
    clientId: "g-intent-bank",
    rawText: "Remind me to call the bank on Friday about the mortgage rate.",
    occurredHint: "this Friday",
    tags: ["intent", "reminder", "bank"],
    trap: "intent",
    note: "Explicit 'remind me' — should become a reminder with a Friday dueAt.",
  },
  {
    clientId: "g-intent-groceries",
    rawText: "Need to buy groceries this weekend — we're out of everything.",
    occurredHint: "this weekend",
    tags: ["intent", "chores"],
    trap: "intent",
  },

  // ── Trips / temporal ──────────────────────────────────────────────────────
  {
    clientId: "g-trip-japan",
    rawText: "Booked it — we're flying to Japan next month for two weeks. Tokyo then Kyoto.",
    occurredHint: "next month",
    tags: ["travel", "japan", "future"],
    note: "Future-tense episode. Prospective, with a future occurredAt.",
  },
  {
    clientId: "g-trip-goa",
    rawText: "Spent last New Year's in Goa with Sarah. The beach shacks were perfect.",
    occurredHint: "last New Year",
    tags: ["travel", "goa", "sarah", "past"],
  },

  // ── Reflections (no-fact — must not fabricate structure) ──────────────────
  {
    clientId: "g-reflect-1",
    rawText: "Some days the weight of everything just sits on my chest and I can't name why.",
    tags: ["reflection", "mood"],
    trap: "reflection",
    note: "Pure reflection. Should embed + type, but yield zero atomic facts.",
  },
  {
    clientId: "g-reflect-2",
    rawText: "Grateful today. Nothing special happened, and that was the whole point.",
    tags: ["reflection", "mood"],
    trap: "reflection",
  },

  // ── Health / misc for richer graph ────────────────────────────────────────
  { clientId: "g-hobby-run", rawText: "Started running again — did 5k this morning without stopping.", occurredHint: "this morning", tags: ["health", "running"] },
  { clientId: "g-goal-rust", rawText: "My goal this year is to get properly good at Rust.", tags: ["goal", "rust", "learning"] },
  { clientId: "g-media-show", rawText: "Finally finished Breaking Bad. Best show I've watched in years.", tags: ["media", "tv"] },
  { clientId: "g-person-mentor", rawText: "Grabbed coffee with my old mentor Priya. She always reframes my problems in a way I can't.", tags: ["person", "priya", "mentor"] },
];

/** Total count, handy for the runner's progress output. */
export const DATASET_SIZE = GOLDEN_DATASET.length;

/** Fast lookup by clientId. */
export const BY_CLIENT_ID: Record<string, SeedMemory> = Object.fromEntries(
  GOLDEN_DATASET.map((m) => [m.clientId, m]),
);
