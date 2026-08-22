import { useEffect, useMemo, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { ApiError } from '../../../api/client'
import { Field, SettingsSection, StatusBanner, ToggleSwitch } from '../ui'
import { usePrivacySettings, useUpdatePrivacySettings } from '../hooks'
import type { PrivacyPatch, PrivacySettings } from '../types'

/** Select choices for `transcriptRetentionDays`. `forever` → null, `0` =
 * discard once digested, N = keep N days. Matches the server contract. */
const RETENTION_CHOICES = [
  { value: 'forever', label: 'Keep forever' },
  { value: '0', label: 'Discard after digesting' },
  { value: '7', label: 'Keep 7 days' },
  { value: '30', label: 'Keep 30 days' },
  { value: '90', label: 'Keep 90 days' },
  { value: '365', label: 'Keep 1 year' },
] as const

function isKnownRetention(v: string): boolean {
  return RETENTION_CHOICES.some((c) => c.value === v)
}

/** Map the saved day count to its draft string. Values outside the preset
 * choices (the server accepts 0–3650) round-trip verbatim so they are shown
 * as a "custom" option instead of being silently rewritten on save. */
function retentionToDraft(days: number | null): string {
  return days === null ? 'forever' : String(days)
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

interface Draft {
  /** A RETENTION_CHOICES key, or the raw day count for custom values. */
  retention: string
  quietStart: string
  quietEnd: string
  budget: string
  insightsEnabled: boolean
}

function toDraft(s: PrivacySettings): Draft {
  return {
    retention: retentionToDraft(s.transcriptRetentionDays),
    quietStart: s.quietHoursStart.slice(0, 5),
    quietEnd: s.quietHoursEnd.slice(0, 5),
    budget: String(s.maxDailySurfacings),
    insightsEnabled: s.insightsEnabled,
  }
}

/** Extra select entry when the saved retention is not one of the presets. */
function customRetentionOption(days: number | null): { value: string; label: string } | null {
  if (days === null) return null
  const raw = String(days)
  return isKnownRetention(raw) ? null : { value: raw, label: `Keep ${raw} days (current)` }
}

function validate(d: Draft): string | null {
  if (d.retention !== 'forever') {
    const days = Number(d.retention)
    if (!Number.isInteger(days) || days < 0 || days > 3650) {
      return 'Transcript retention must be between 0 and 3650 days.'
    }
  }
  if (!TIME_RE.test(d.quietStart) || !TIME_RE.test(d.quietEnd)) {
    return 'Quiet hours must be valid HH:MM times.'
  }
  if (d.quietStart === d.quietEnd) {
    return 'Quiet hours start and end cannot be identical.'
  }
  const budget = Number(d.budget)
  if (!Number.isInteger(budget) || budget < 0 || budget > 50) {
    return 'Daily surfacing budget must be a whole number between 0 and 50.'
  }
  return null
}

export function PrivacySection() {
  const query = usePrivacySettings()
  const update = useUpdatePrivacySettings()
  /** User edits; null until something is changed — the form derives from the
   * saved server state, so no effect-based initialization is needed. */
  const [edits, setEdits] = useState<Draft | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  const saved = query.data
  const draft: Draft | null = edits ?? (saved ? toDraft(saved) : null)

  const dirty = useMemo(
    () => Boolean(saved && draft && JSON.stringify(toDraft(saved)) !== JSON.stringify(draft)),
    [saved, draft],
  )

  /** Extra select entry while the current retention isn't one of the presets. */
  const customRetention = useMemo(() => {
    if (!draft) return null
    return customRetentionOption(draft.retention === 'forever' ? null : Number(draft.retention))
  }, [draft])

  // Dirty-state guard: confirm before leaving with unsaved edits (S-1).
  useBlocker({
    shouldBlockFn: () => {
      if (!dirty) return false
      return !window.confirm('You have unsaved privacy changes. Leave anyway?')
    },
  })
  useEffect(() => {
    if (!dirty) return
    // Both signals: Chrome/Edge honor preventDefault, Safari/Firefox need
    // returnValue to reliably show the "leave site?" prompt.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const validationError = draft ? validate(draft) : null

  /** Merge a partial edit into the draft and clear stale save feedback. */
  function edit(partial: Partial<Draft>): void {
    if (!draft) return
    setEdits({ ...draft, ...partial })
    setFeedback(null)
  }

/** Build a diff-only PATCH against the last saved state — fields the user
 * didn't touch are never sent, so saving can't silently rewrite values that
 * the draft normalizes (e.g. custom retention day counts). */
function toPatch(d: Draft, s: PrivacySettings): PrivacyPatch {
  const patch: PrivacyPatch = {}
  const retention = d.retention === 'forever' ? null : Number(d.retention)
  if (retention !== s.transcriptRetentionDays) {
    patch.transcriptRetentionDays = retention
  }
  if (d.quietStart !== s.quietHoursStart.slice(0, 5)) patch.quietHoursStart = d.quietStart
  if (d.quietEnd !== s.quietHoursEnd.slice(0, 5)) patch.quietHoursEnd = d.quietEnd
  if (Number(d.budget) !== s.maxDailySurfacings) {
    patch.maxDailySurfacings = Number(d.budget)
  }
  if (d.insightsEnabled !== s.insightsEnabled) patch.insightsEnabled = d.insightsEnabled
  return patch
}

  function handleSave(): void {
    if (!draft || !saved || validationError) return
    const patch = toPatch(draft, saved)
    // The Save button is disabled unless dirty, so the diff is non-empty —
    // but never send an empty body (the server rejects it).
    if (Object.keys(patch).length === 0) return
    update.mutate(patch, {
      onSuccess: () =>
        setFeedback({ kind: 'success', message: 'Privacy settings saved.' }),
      onError: (err: Error) =>
        setFeedback({
          kind: 'error',
          message: err instanceof ApiError ? err.message : 'Could not save settings.',
        }),
    })
  }

  return (
    <SettingsSection
      id="privacy"
      title="Privacy"
      description="Control what stays, when things surface, and how proactive the system may be."
    >
      {query.isPending ? <p className="text-sub text-ink2">Loading…</p> : null}
      {query.isError ? (
        <StatusBanner kind="error" message="Could not load your privacy settings." />
      ) : null}

      {draft ? (
        <div className="flex flex-col gap-lg">
          <Field
            label="Transcript retention"
            htmlFor="retention"
            hint={customRetention ? `Server is set to keep ${customRetention.value} days.` : undefined}
          >
            <select
              id="retention"
              value={draft.retention}
              onChange={(e) => edit({ retention: e.target.value })}
              className="h-10 rounded-md border border-hairline bg-surface px-md text-body text-ink focus:border-accent focus:outline-none"
            >
              {RETENTION_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
              {customRetention ? (
                <option key={customRetention.value} value={customRetention.value}>
                  {customRetention.label}
                </option>
              ) : null}
            </select>
          </Field>

          <div className="grid grid-cols-1 gap-lg sm:grid-cols-2">
            <Field label="Quiet hours start" htmlFor="quiet-start" hint="No surfacing before this local time.">
              <Input
                id="quiet-start"
                type="time"
                value={draft.quietStart}
                onChange={(e) => edit({ quietStart: e.target.value })}
              />
            </Field>
            <Field label="Quiet hours end" htmlFor="quiet-end">
              <Input
                id="quiet-end"
                type="time"
                value={draft.quietEnd}
                onChange={(e) => edit({ quietEnd: e.target.value })}
              />
            </Field>
          </div>

          <Field
            label="Daily surfacing budget"
            htmlFor="budget"
            hint="Maximum proactive nudges per day across all channels (0–50)."
          >
            <Input
              id="budget"
              type="number"
              min={0}
              max={50}
              step={1}
              value={draft.budget}
              onChange={(e) => edit({ budget: e.target.value })}
              className="max-w-32"
            />
          </Field>

          <div className="flex items-center justify-between gap-lg">
            <div>
              <p className="text-caption-medium text-ink">Insights</p>
              <p className="text-micro text-ink3">
                Inferred nudges (intentions, patterns). Lookups like reminders stay on.
              </p>
            </div>
            <ToggleSwitch
              checked={draft.insightsEnabled}
              onChange={(next) => edit({ insightsEnabled: next })}
              label="Insights"
              disabled={update.isPending}
            />
          </div>

          {validationError ? (
            <StatusBanner kind="error" message={validationError} />
          ) : null}
          {!validationError && feedback ? (
            <StatusBanner kind={feedback.kind} message={feedback.message} />
          ) : null}

          <div className="flex items-center gap-md">
            <Button onClick={handleSave} disabled={!dirty || Boolean(validationError) || update.isPending}>
              {update.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
              Save changes
            </Button>
            {saved ? (
              <Button variant="ghost" disabled={!dirty || update.isPending} onClick={() => setEdits(null)}>
                Discard
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </SettingsSection>
  )
}
