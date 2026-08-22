/**
 * Typed fetchers for the rules manager (issue #12).
 * Thin wrappers over the shared authed request() client.
 */

import { request } from '../../api/client'
import type { StandingRule } from '../../api/types'
import type {
  CreatedRule,
  RuleCorrectionInput,
  RuleCreateInput,
  RuleHistory,
  RuleTestResult,
} from './types'

/** GET /rules — head rules only, active first. */
export function fetchRules(): Promise<{ rules: StandingRule[] }> {
  return request<{ rules: StandingRule[] }>('/rules')
}

/** PATCH /rules/:id with `{ active }` — pause/resume a head rule. */
export function patchRuleActive(id: string, active: boolean): Promise<StandingRule> {
  return request<StandingRule>(`/rules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ active }),
  })
}

/**
 * PATCH /rules/:id with text fields — edit-as-correction.
 * The server supersedes the old row and returns the NEW version.
 */
export function correctRule(id: string, patch: RuleCorrectionInput): Promise<StandingRule> {
  return request<StandingRule>(`/rules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/** POST /rules — create a brand-new standing rule manually. */
export function createRule(input: RuleCreateInput): Promise<CreatedRule> {
  return request<CreatedRule>('/rules', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** GET /rules/:id/history — full supersession chain, newest first. */
export function fetchRuleHistory(id: string): Promise<RuleHistory> {
  return request<RuleHistory>(`/rules/${id}/history`)
}

/** POST /rules/:id/test — trigger playground dry run (no side effects). */
export function testRuleTrigger(id: string, text: string): Promise<RuleTestResult> {
  return request<RuleTestResult>(`/rules/${id}/test`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}
