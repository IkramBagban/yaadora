/**
 * Admin-panel wire types (issue #32). Shapes mirror the documented admin API
 * contract — the backend (#31) is being built against the same document, so
 * nothing here is invented beyond it. Dates are ISO strings.
 */

/** GET /me — gains `role` from #31; absent/other → treated as non-admin. */
export interface MeWithRole {
  id: string
  email: string
  timezone?: string
  createdAt?: string
  role?: string | null
}

export function isAdminRole(me: MeWithRole | undefined): boolean {
  return me?.role === 'admin'
}

// --- GET /admin/users ----------------------------------------------------------

export interface AdminUserFlags {
  hasFailedMemories: boolean
  insightsDisabled: boolean
}

/** One row of the admin users table. */
export interface AdminUserRow {
  id: string
  email: string
  role: string
  createdAt: string
  /** null when the user has never been seen active. */
  lastActiveAt: string | null
  streakDays: number
  memoriesTotal: number
  conversationsTotal: number
  tokens30d: number
  cost30dEstUsd: number
  flags: AdminUserFlags
}

export interface AdminUsersPage {
  users: AdminUserRow[]
  nextCursor: string | null
}

// --- GET /admin/users/:id ------------------------------------------------------

export interface AdminUserProfile {
  id: string
  email: string
  role: string
  createdAt: string
  timezone: string
}

/** Aggregate counts for one user's memory system. */
export interface AdminUserOverview {
  memoriesTotal: number
  factsTotal: number
  entitiesTotal: number
  openLoopsOpen: number
  conversationsTotal: number
  turnsTotal: number
  streakDays: number
  activeDays30: number
}

export interface AdminDeviceRow {
  deviceId: string
  updatedAt: string
}

export interface AdminUserProfilePayload {
  profile: AdminUserProfile
  overview: AdminUserOverview
  devices: AdminDeviceRow[]
}

// --- GET /admin/users/:id/memories ----------------------------------------------

export type MemoryStatusFilter = 'all' | 'failed'

/** One row of a user's records listing. */
export interface AdminMemoryRow {
  id: string
  rawTextSnippet: string
  source: string
  status: string
  occurredAt: string | null
  createdAt: string
  factsCount: number
}

export interface AdminMemoriesPage {
  items: AdminMemoryRow[]
  nextCursor: string | null
}

// --- GET /admin/users/:id/conversations (+ turns) -------------------------------

export interface AdminConversationRow {
  id: string
  startedAt: string
  turnCount: number
  status: string
  summarySnippet: string | null
}

export interface AdminConversationsPayload {
  items: AdminConversationRow[]
}

/** One durable turn; `meta` is an opaque JSON blob parsed defensively. */
export interface AdminConversationTurn {
  role: 'user' | 'assistant' | (string & {})
  content: string
  meta: unknown
  createdAt: string
}

export interface AdminTurnsPayload {
  turns: AdminConversationTurn[]
}

/**
 * Tool trace extracted from a turn's meta JSON. All parts optional because the
 * backend only includes what it has ("searches/citations/rulesApplied if
 * present"); missing or malformed meta yields null.
 */
export interface TurnToolTrace {
  searches: string[]
  citationCount: number
  rulesApplied: string[]
}

// --- GET /admin/users/:id/activity ----------------------------------------------

/** One day of a user's engagement buckets (`day` = YYYY-MM-DD). */
export interface AdminActivityDay {
  day: string
  requests: number
  memoriesCreated: number
  turns: number
}

/** One logged API request from the user's feed. */
export interface AdminApiRequestRow {
  ts: string
  method: string
  path: string
  status: number
  durationMs: number
}

export interface AdminUserActivityPayload {
  days: AdminActivityDay[]
  apiRequests: AdminApiRequestRow[]
}

// --- GET /admin/users/:id/usage -------------------------------------------------

export type UsageGranularity = 'day' | 'week' | 'month'

/** AI usage for one period × tier × model × phase cell. */
export interface UsageRow {
  period: string
  tier: string
  model: string
  phase: string
  calls: number
  inputTokens: number
  outputTokens: number
}

export interface UsageTotals {
  calls: number
  inputTokens: number
  outputTokens: number
  costEstimateUsd: number
}

export interface UsagePayload {
  rows: UsageRow[]
  totals: UsageTotals
}

// --- POST /admin/users/:id/memories/:memoryId/reprocess ---------------------------

export interface ReprocessResponse {
  queued: boolean
}

// --- GET /admin/activity ---------------------------------------------------------

export interface ActivityCountPoint {
  day: string
  count: number
}

export interface StreakLeaderboardEntry {
  userId: string
  email: string
  days: number
}

export interface GlobalActivityPayload {
  dau: ActivityCountPoint[]
  wau: ActivityCountPoint[]
  streakLeaderboard: StreakLeaderboardEntry[]
}

// --- GET /admin/engine ------------------------------------------------------------

export interface ConsolidationRun {
  startedAt: string
  finishedAt: string | null
  status: string
  counters: Record<string, number>
}

export interface EngineHealthPayload {
  consolidationRuns: ConsolidationRun[]
  ingestionFailures7d: number
}
