/**
 * TanStack Query hooks for the rules manager (issue #12).
 * One key family so mutations invalidate list + affected history chains.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  correctRule,
  createRule,
  fetchRuleHistory,
  fetchRules,
  patchRuleActive,
} from './api'
import type { RuleCorrectionInput, RuleCreateInput } from './types'

export const rulesKeys = {
  all: ['rules'] as const,
  list: () => [...rulesKeys.all, 'list'] as const,
  history: (id: string) => [...rulesKeys.all, 'history', id] as const,
}

/** GET /rules — head rules with usage stats. */
export function useRules() {
  return useQuery({ queryKey: rulesKeys.list(), queryFn: fetchRules })
}

/** GET /rules/:id/history — only fetched while a chain is open. */
export function useRuleHistory(ruleId: string | null) {
  return useQuery({
    queryKey: rulesKeys.history(ruleId ?? 'none'),
    queryFn: () => fetchRuleHistory(ruleId!),
    enabled: ruleId !== null,
  })
}

function useInvalidateRules() {
  const qc = useQueryClient()
  return (ruleId?: string) => {
    void qc.invalidateQueries({ queryKey: rulesKeys.list() })
    if (ruleId) void qc.invalidateQueries({ queryKey: rulesKeys.history(ruleId) })
  }
}

/** PATCH { active } — pause/resume. */
export function useToggleRuleActive() {
  const invalidate = useInvalidateRules()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      patchRuleActive(id, active),
    onSuccess: (updated) => invalidate(updated.id),
  })
}

/**
 * PATCH text fields — edit-as-correction. Resolves with the NEW rule version
 * so callers can surface "superseded old → created new" feedback.
 */
export function useCorrectRule() {
  const invalidate = useInvalidateRules()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: RuleCorrectionInput }) =>
      correctRule(id, patch),
    onSuccess: (created) => invalidate(created.id),
  })
}

/** POST /rules — manual creation. */
export function useCreateRule() {
  const invalidate = useInvalidateRules()
  return useMutation({
    mutationFn: (input: RuleCreateInput) => createRule(input),
    onSuccess: () => invalidate(),
  })
}
