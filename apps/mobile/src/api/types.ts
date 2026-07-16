/** Wire types matching apps/server responses. Do not invent fields here. */

export type MemorySource = 'manual' | 'voice' | 'conversation' | 'import' | (string & {});

/** A reminder (docs/specs/reminder-feature). */
export type ReminderStatus =
  | 'suggested'
  | 'pending'
  | 'done'
  | 'dismissed'
  | (string & {});
export type ReminderOrigin = 'manual' | 'suggested' | (string & {});

/**
 * How a reminder repeats.
 * - `once`   → fires a single time at `dueAt`.
 * - `daily`  → fires every day at `dueAt`'s clock time.
 * - `weekly` → fires on each weekday in `weekdays` at `dueAt`'s clock time.
 */
export type Recurrence = 'once' | 'daily' | 'weekly';

/** Weekday numbers use JS `Date.getDay()` convention: 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Reminder {
  id: string;
  text: string;
  /**
   * For `once`, the exact fire time. For `daily`/`weekly`, the next occurrence —
   * its clock time (hour:minute) is the recurring time-of-day.
   */
  dueAt: string;
  recurrence: Recurrence;
  /** Selected weekdays (0–6) for `weekly`; `null` for `once`/`daily`. */
  weekdays: number[] | null;
  status: ReminderStatus;
  origin: ReminderOrigin;
  sourceMemory: string | null;
  createdAt: string;
}

/** Schedule payload shared by create/confirm/update. `weekdays` required (non-empty) iff `weekly`. */
export interface ReminderSchedule {
  dueAt: string;
  recurrence?: Recurrence;
  weekdays?: number[] | null;
}

/** GET /reminders */
export interface ReminderList {
  items: Reminder[];
}

export type ReminderScope = 'upcoming' | 'all' | 'suggested';

/** Ingestion status of a raw memory ("pending" until the worker processes it). */
export type IngestionStatus = 'pending' | 'processed' | 'failed' | (string & {});

export interface Memory {
  id: string;
  userId: string;
  rawText: string;
  occurredAt: string | null;
  createdAt: string;
  source: MemorySource;
  status: IngestionStatus;
}

/** POST /memories → 201 */
export interface CreatedMemory {
  id: string;
  status: IngestionStatus;
  createdAt: string;
}

/** GET /memories */
export interface MemoryPage {
  items: Memory[];
  nextCursor: string | null;
}

export interface Fact {
  id: string;
  subjectId: string | null;
  predicate: string;
  objectText: string | null;
  objectId: string | null;
  factText: string;
  validFrom: string | null;
  validTo: string | null;
  confidence: number | null;
  factType: string | null;
  origin: string | null;
  sourceMemory: string;
  createdAt: string;
}

export interface Entity {
  id: string;
  type: string;
  canonicalName: string;
  aliases: string[] | null;
  profile: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  mentionCount: number | null;
}

/** GET /memories/:id */
export interface MemoryDetail {
  memory: Memory;
  facts: Fact[];
  entities: Entity[];
}

export interface Citation {
  memoryId: string;
  snippet: string;
  occurredAt: string | null;
}

export type AskMode = 'recall' | 'reason' | 'clarify';

export type AskStepKind =
  | 'search'
  | 'clarify'
  | 'synthesize'
  | 'reminder'
  | 'rule'
  | 'entity';

/** One visible step in the agent's reasoning trace. */
export interface AskStep {
  kind: AskStepKind;
  label: string;
  query?: string;
  count?: number;
}

/** GET /rules · PATCH /rules/:id */
export interface StandingRule {
  id: string;
  ruleText: string;
  triggerText: string;
  active: boolean;
  sourceMemory: string;
  appliedCount: number;
  lastAppliedAt: string | null;
  createdAt: string;
  supersededBy: string | null;
}

/** @deprecated History is loaded server-side from durable turns. */
export interface AskHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** SSE frames streamed by POST /conversations/:id/turns (and legacy /ask). */
export type AskEvent =
  | { type: 'step'; kind: AskStepKind; label: string; query?: string; count?: number }
  | { type: 'token'; text: string }
  | {
      type: 'done';
      citations: Citation[];
      confidence: number;
      mode: AskMode;
      steps: AskStep[];
      clarifyOptions?: string[];
      /** Proactive nudge woven this turn (receipt affordance, P2). */
      surfacingId?: string;
      evidence?: string[];
    }
  | { type: 'captured'; memoryId: string; statement: string }
  | { type: 'reminder_suggestion'; text: string; dueAt: string; sourceMemoryId?: string }
  | { type: 'error'; message: string };

/** GET /surfacings — pending chip candidates on app open. */
export interface PendingSurfacing {
  id: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  channel: string;
  evidence: string[];
  evidenceSnippets: string[];
  shownAt: string;
  reaction: string | null;
}

export interface SurfacingEvidenceMemory {
  id: string;
  rawText: string;
  occurredAt: string | null;
  createdAt: string;
}

/** A transient reminder chip proposed during an Ask turn (not yet saved). */
export interface ReminderSuggestion {
  text: string;
  dueAt: string;
  sourceMemoryId?: string;
}

// --- entity pages / graph doorway (spec 02 §8, P3) -------------------------

/** A current fact about an entity, with provenance for a tappable receipt. */
export interface EntityContextFact {
  id: string;
  predicate: string | null;
  factText: string;
  sourceMemory: string;
}

/** An open loop attached to an entity. */
export interface EntityContextLoop {
  id: string;
  kind: string;
  title: string;
  dueAt: string | null;
  sourceMemory: string;
}

/** A 1-hop relationship edge with its derived status. */
export interface EntityContextEdge {
  id: string;
  relType: string;
  status: string;
  lastMentioned: string | null;
  otherId: string;
  otherName: string;
  otherType: string;
  otherIsKnownEntity: boolean;
  evidence: string[];
}

/** A provenance memory shown as a tappable receipt. */
export interface EntityReceipt {
  id: string;
  snippet: string;
  occurredAt: string | null;
  createdAt: string;
}

/** GET /entities/:id/context */
export interface EntityContextPayload {
  entity: { id: string; canonicalName: string; type: string };
  profile: string | null;
  facts: EntityContextFact[];
  openLoops: EntityContextLoop[];
  edges: EntityContextEdge[];
  receipts: EntityReceipt[];
}

/** GET /entities */
export interface EntityListItem {
  id: string;
  type: string;
  canonicalName: string;
  profile: string | null;
  mentionCount: number;
  lastSeen: string | null;
}
