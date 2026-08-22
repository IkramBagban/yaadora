import { useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { Spinner } from '../../../components/ui/Spinner'
import { useCorrectRule, useCreateRule } from '../hooks'
import type { StandingRule } from '../../../api/types'
import type { RuleCorrectionInput } from '../types'

interface RuleEditorProps {
  mode: 'create' | 'correct'
  /** Prefill for correction mode (the current head version's wording). */
  initial?: { ruleText: string; triggerText: string }
  /** Head rule being corrected; required in correct mode. */
  ruleId?: string
  onSaved: (rule: StandingRule) => void
  onCancel: () => void
}

const fieldClasses =
  'w-full rounded-md border border-hairline bg-surface px-lg py-sm text-body text-ink placeholder:text-ink3 focus:border-accent focus:outline-none disabled:opacity-50 resize-y'

const copy = {
  create: {
    heading: 'New standing rule',
    hint: 'Write the behavior yaadora should always follow, and the situation that calls for it.',
    submit: 'Create rule',
  },
  correct: {
    heading: 'Edit as correction',
    hint: 'Saving supersedes this rule with a corrected version — the old wording stays in history.',
    submit: 'Save correction',
  },
} as const

/**
 * One form for both text-changing flows of issue #12: manual creation and
 * edit-as-correction. The server decides supersession; this component only
 * collects the two required fields.
 */
export function RuleEditor({ mode, initial, ruleId, onSaved, onCancel }: RuleEditorProps) {
  const [ruleText, setRuleText] = useState(initial?.ruleText ?? '')
  const [triggerText, setTriggerText] = useState(initial?.triggerText ?? '')

  const create = useCreateRule()
  const correct = useCorrectRule()
  const pending = create.isPending || correct.isPending
  const error = create.error ?? correct.error

  const canSubmit =
    ruleText.trim().length > 0 && triggerText.trim().length > 0 && !pending

  function submit() {
    if (!canSubmit) return
    const payload = { ruleText: ruleText.trim(), triggerText: triggerText.trim() }
    if (mode === 'create') {
      create.mutate(payload, { onSuccess: ({ rule }) => onSaved(rule) })
      return
    }
    if (!ruleId) return
    // Correction: send only what changed so no-op edits don't churn history.
    const patch: RuleCorrectionInput = {}
    if (payload.ruleText !== initial?.ruleText) patch.ruleText = payload.ruleText
    if (payload.triggerText !== initial?.triggerText) patch.triggerText = payload.triggerText
    if (Object.keys(patch).length === 0) {
      onCancel()
      return
    }
    correct.mutate({ id: ruleId, patch }, { onSuccess: onSaved })
  }

  const c = copy[mode]

  return (
    <form
      className="flex flex-col gap-lg rounded-md border border-hairline bg-surface-alt p-xl"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="flex flex-col gap-xs">
        <h3 className="text-title font-semibold">{c.heading}</h3>
        <p className="text-caption text-ink2">{c.hint}</p>
      </div>

      <label className="flex flex-col gap-xs">
        <span className="text-caption-medium uppercase tracking-wide text-ink2">Rule</span>
        <textarea
          className={`${fieldClasses} min-h-[72px]`}
          value={ruleText}
          onChange={(e) => setRuleText(e.target.value)}
          placeholder="e.g. Always run drafts past me before posting"
          maxLength={8000}
          disabled={pending}
        />
      </label>

      <label className="flex flex-col gap-xs">
        <span className="text-caption-medium uppercase tracking-wide text-ink2">Trigger</span>
        <textarea
          className={`${fieldClasses} min-h-[56px]`}
          value={triggerText}
          onChange={(e) => setTriggerText(e.target.value)}
          placeholder="e.g. Whenever I am about to publish a post publicly"
          maxLength={2000}
          disabled={pending}
        />
      </label>

      {error instanceof Error && (
        <p role="alert" className="text-caption text-danger">
          {error.message}
        </p>
      )}

      <div className="flex items-center gap-sm">
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {pending && <Spinner size={14} />}
          {c.submit}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
