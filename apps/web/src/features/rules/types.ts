/**
 * Rules-feature wire types (issue #12).
 *
 * `StandingRule` lives in the shared api/types.ts (GET/PATCH /rules).
 * Everything below matches the newer rules-manager responses:
 * routes/rules-manage.ts and routes/rules-test.ts on the server.
 */

import type { StandingRule } from '../../api/types'

/** POST /rules → 201 { rule }. Manual standing-rule creation. */
export interface CreatedRule {
  rule: StandingRule
}

/**
 * POST /rules/:id/test — trigger-playground dry run.
 * `score` is cosine similarity of the probe text vs the stored trigger
 * embedding; `null` means the gate could not be evaluated (see `reason`).
 */
export interface RuleTestResult {
  ruleId: string
  score: number | null
  wouldFire: boolean
  threshold: number
  reason?: string
  ruleActive?: boolean
  triggerText?: string
}

/** GET /rules/:id/history — supersession chain, newest version first. */
export interface RuleHistory {
  items: StandingRule[]
}

/** Payload for manual creation. Both fields are required by the server. */
export interface RuleCreateInput {
  ruleText: string
  triggerText: string
}

/** Edit-as-correction payload; at least one text field must change. */
export interface RuleCorrectionInput {
  ruleText?: string
  triggerText?: string
}
