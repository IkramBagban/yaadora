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

export interface Reminder {
  id: string;
  text: string;
  dueAt: string;
  status: ReminderStatus;
  origin: ReminderOrigin;
  sourceMemory: string | null;
  createdAt: string;
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

export type AskStepKind = 'search' | 'clarify' | 'synthesize' | 'reminder';

/** One visible step in the agent's reasoning trace. */
export interface AskStep {
  kind: AskStepKind;
  label: string;
  query?: string;
  count?: number;
}

/** One in-session turn replayed to the stateless server for follow-up context. */
export interface AskHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** SSE frames streamed by POST /ask. */
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
    }
  | { type: 'captured'; memoryId: string; statement: string }
  | { type: 'reminder_suggestion'; text: string; dueAt: string; sourceMemoryId?: string }
  | { type: 'error'; message: string };

/** A transient reminder chip proposed during an Ask turn (not yet saved). */
export interface ReminderSuggestion {
  text: string;
  dueAt: string;
  sourceMemoryId?: string;
}
