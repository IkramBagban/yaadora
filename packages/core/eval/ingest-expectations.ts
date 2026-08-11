/**
 * Ingestion expectations — what the worker must produce for each golden memory
 * (and global graph-level checks after the full seed).
 *
 * These are judged against GET /memories/:id (facts, entities, openLoops,
 * reminders, rules) plus list endpoints. No Ask involved.
 */

export type IngestCategory =
  | "processed"
  | "facts"
  | "entities"
  | "reflection"
  | "open-loop"
  | "reminder"
  | "rule"
  | "supersession"
  | "entity-collision"
  | "graph";

/** Per-memory checks after that memory is processed. */
export interface MemoryIngestExpectation {
  clientId: string;
  category: IngestCategory;
  note: string;
  /** Memory must end status=processed (default true). */
  mustProcess?: boolean;
  /** Min / max number of derived facts from this source memory. */
  minFacts?: number;
  maxFacts?: number;
  /** At least one factText (case-insensitive) must match each pattern. */
  factTextAnyOf?: string[];
  /** No factText may match these (case-insensitive substring). */
  factTextNoneOf?: string[];
  /** Linked entity canonicalName or alias must match (case-insensitive). */
  entityNamesAnyOf?: string[];
  /** Min open loops sourced from this memory. */
  minOpenLoops?: number;
  /** Open loop title must match (substring, case-insensitive). */
  openLoopTitleAnyOf?: string[];
  /** Min reminders sourced from this memory. */
  minReminders?: number;
  /** Reminder text must match substring. */
  reminderTextAnyOf?: string[];
  /** Reminder status expected (e.g. suggested). */
  reminderStatus?: string;
  /** Min standing rules sourced from this memory. */
  minRules?: number;
  /** Rule text substring. */
  ruleTextAnyOf?: string[];
}

/**
 * Global checks after the full dataset is ingested (cross-memory graph).
 */
export interface GlobalIngestExpectation {
  id: string;
  category: IngestCategory;
  note: string;
  /** Among person entities, names matching this regex should have this count. */
  entityNameRegex?: string;
  entityNameCountMin?: number;
  entityNameCountMax?: number;
  /** Across all listed people entities, require at least N distinct. */
  minPersonEntities?: number;
  /** At least one reminder in the user list matching text. */
  globalReminderTextAnyOf?: string[];
  /** At least one active rule matching text. */
  globalRuleTextAnyOf?: string[];
  /**
   * Supersession: for clientId pair (old, new), the OLD source memory's facts
   * about the superseded topic should mostly be validTo-set OR the NEW memory
   * must have current facts containing `newFactMustContain`.
   */
  supersession?: {
    oldClientId: string;
    newClientId: string;
    /** substring that should appear in a CURRENT (validTo null) fact from new */
    newFactMustContain: string;
    /** substring that should NOT be the only current answer — old-only terms */
    oldFactMarker: string;
  };
}

export const MEMORY_INGEST_EXPECTATIONS: MemoryIngestExpectation[] = [
  // ── Identity / facts ────────────────────────────────────────────────────
  {
    clientId: "g-id-name",
    category: "facts",
    note: "Name memory yields a self fact.",
    minFacts: 1,
    factTextAnyOf: ["kabir", "name", "rao"],
  },
  {
    clientId: "g-id-wife",
    category: "entities",
    note: "Sarah becomes a person entity.",
    minFacts: 1,
    entityNamesAnyOf: ["sarah"],
    factTextAnyOf: ["sarah", "wife"],
  },
  {
    clientId: "g-id-dog",
    category: "entities",
    note: "Max the dog is linked.",
    minFacts: 1,
    entityNamesAnyOf: ["max"],
  },
  {
    clientId: "g-id-dog-breed",
    category: "facts",
    note: "Breed/age fact about Max.",
    minFacts: 1,
    factTextAnyOf: ["golden", "retriever", "three", "3"],
  },

  // ── Jobs (supersession pair) ────────────────────────────────────────────
  {
    clientId: "g-job-old",
    category: "facts",
    note: "Old job extracts Northwind fact (may later be closed).",
    minFacts: 1,
    factTextAnyOf: ["northwind", "backend"],
    entityNamesAnyOf: ["northwind"],
  },
  {
    clientId: "g-job-new",
    category: "facts",
    note: "New job extracts Acme fact.",
    minFacts: 1,
    factTextAnyOf: ["acme", "senior"],
    entityNamesAnyOf: ["acme"],
  },

  // ── Location ────────────────────────────────────────────────────────────
  {
    clientId: "g-loc-old",
    category: "facts",
    note: "Old location Mumbai.",
    minFacts: 1,
    factTextAnyOf: ["mumbai"],
  },
  {
    clientId: "g-loc-new",
    category: "facts",
    note: "New location Pune.",
    minFacts: 1,
    factTextAnyOf: ["pune"],
  },

  // ── Two Urhans ──────────────────────────────────────────────────────────
  {
    clientId: "g-urhan-friend-1",
    category: "entities",
    note: "Friend Urhan linked as person.",
    entityNamesAnyOf: ["urhan"],
    minFacts: 0,
  },
  {
    clientId: "g-urhan-colleague-1",
    category: "entities",
    note: "Colleague Urhan linked as person.",
    entityNamesAnyOf: ["urhan"],
  },

  // ── Preferences / safety ────────────────────────────────────────────────
  {
    clientId: "g-pref-coffee",
    category: "facts",
    note: "Coffee preference fact.",
    minFacts: 1,
    factTextAnyOf: ["coffee"],
  },
  {
    clientId: "g-fact-allergy",
    category: "facts",
    note: "Peanut allergy is safety-critical — must extract.",
    minFacts: 1,
    factTextAnyOf: ["peanut", "allerg", "epipen"],
  },
  {
    clientId: "g-pref-food-sarah",
    category: "facts",
    note: "Sarah likes Italian / carbonara.",
    minFacts: 1,
    factTextAnyOf: ["italian", "carbonara"],
  },

  // ── Sleep supersession ──────────────────────────────────────────────────
  {
    clientId: "g-sleep-new",
    category: "facts",
    note: "Current sleep reality past midnight — soft: candid phrasing is often typed reflection.",
    // Do not hard-require atomic facts; retrieve case still checks answer quality.
    mustProcess: true,
  },

  // ── Project decisions ───────────────────────────────────────────────────
  {
    clientId: "g-proj-react",
    category: "facts",
    note: "React decision extracts.",
    minFacts: 1,
    factTextAnyOf: ["react"],
  },
  {
    clientId: "g-proj-postgres",
    category: "facts",
    note: "Postgres decision extracts.",
    minFacts: 1,
    factTextAnyOf: ["postgres", "pgvector"],
  },

  // ── Reflections: ZERO atomic facts ──────────────────────────────────────
  {
    clientId: "g-reflect-1",
    category: "reflection",
    note: "Pure reflection must not invent atomic life facts.",
    maxFacts: 0,
  },
  {
    clientId: "g-reflect-2",
    category: "reflection",
    note: "Grateful reflection — no fabricated events/facts.",
    maxFacts: 0,
  },

  // ── Intents → reminders ─────────────────────────────────────────────────
  {
    clientId: "g-intent-passport",
    category: "reminder",
    note: "Passport renew intent should suggest a reminder and/or open loop.",
    minReminders: 0, // soft: either reminder OR fact/loop is acceptable
    factTextAnyOf: ["passport", "renew"],
    minOpenLoops: 0,
  },
  {
    clientId: "g-intent-bank",
    category: "reminder",
    note: "Explicit 'remind me' Friday bank call → suggested reminder.",
    minReminders: 1,
    reminderTextAnyOf: ["bank", "mortgage", "call"],
    reminderStatus: "suggested",
  },
  {
    clientId: "g-intent-groceries",
    category: "reminder",
    note: "Groceries need — soft intent; no hard fact/reminder assertion (models vary).",
    mustProcess: true,
  },

  // ── Standing rule ───────────────────────────────────────────────────────
  {
    clientId: "g-rule-xpost",
    category: "rule",
    note: "Social post standing rule becomes a rules row.",
    minRules: 1,
    ruleTextAnyOf: ["post", "social", "real", "help"],
  },

  // ── Open loops ──────────────────────────────────────────────────────────
  {
    clientId: "g-loop-equity",
    category: "open-loop",
    note: "Unresolved equity split → open loop.",
    minOpenLoops: 1,
    openLoopTitleAnyOf: ["equity", "rahul", "split"],
  },
  {
    clientId: "g-loop-equity-done",
    category: "open-loop",
    note: "Settled equity — facts extract; loop resolution is graph-level.",
    minFacts: 1,
    factTextAnyOf: ["equity", "rahul", "60", "split"],
  },

  // ── Trips ───────────────────────────────────────────────────────────────
  {
    clientId: "g-trip-goa",
    category: "facts",
    note: "Goa New Year trip.",
    minFacts: 1,
    factTextAnyOf: ["goa"],
  },
  {
    clientId: "g-trip-japan",
    category: "facts",
    note: "Japan future trip — may also create loop/reminder.",
    minFacts: 1,
    factTextAnyOf: ["japan", "tokyo", "kyoto"],
  },

  // ── Mentor / goals ──────────────────────────────────────────────────────
  {
    clientId: "g-person-mentor",
    category: "entities",
    note: "Priya mentor entity.",
    entityNamesAnyOf: ["priya"],
  },
  {
    clientId: "g-goal-rust",
    category: "facts",
    note: "Rust learning goal.",
    minFacts: 1,
    factTextAnyOf: ["rust"],
  },
];

export const GLOBAL_INGEST_EXPECTATIONS: GlobalIngestExpectation[] = [
  {
    id: "g-global-two-urhans",
    category: "entity-collision",
    note: "Two distinct Urhan person entities (friend vs colleague) — not over-merged to one.",
    entityNameRegex: "urhan",
    entityNameCountMin: 2,
  },
  {
    id: "g-global-sarah-person",
    category: "graph",
    note: "Sarah exists as a person entity.",
    entityNameRegex: "sarah",
    entityNameCountMin: 1,
  },
  {
    id: "g-global-min-people",
    category: "graph",
    note: "Graph has a reasonable set of people (Kabir's world).",
    minPersonEntities: 4,
  },
  {
    id: "g-global-bank-reminder",
    category: "reminder",
    note: "At least one suggested/pending reminder about the bank call.",
    globalReminderTextAnyOf: ["bank", "mortgage"],
  },
  {
    id: "g-global-xpost-rule",
    category: "rule",
    note: "Standing rule about social posts is active.",
    globalRuleTextAnyOf: ["post", "social", "real"],
  },
  {
    id: "g-global-super-job",
    category: "supersession",
    note: "Current job truth is Acme (new memory facts), not only Northwind.",
    supersession: {
      oldClientId: "g-job-old",
      newClientId: "g-job-new",
      newFactMustContain: "acme",
      oldFactMarker: "northwind",
    },
  },
  {
    id: "g-global-super-loc",
    category: "supersession",
    note: "Current home truth is Pune.",
    supersession: {
      oldClientId: "g-loc-old",
      newClientId: "g-loc-new",
      newFactMustContain: "pune",
      oldFactMarker: "mumbai",
    },
  },
];
