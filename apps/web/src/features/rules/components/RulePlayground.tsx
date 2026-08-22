import { useState } from 'react'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Spinner } from '../../../components/ui/Spinner'
import type { StandingRule } from '../../../api/types'
import type { RuleTestResult } from '../types'
import { testRuleTrigger } from '../api'
import { formatScore } from '../utils'

type Verdict = {
  tone: 'success' | 'danger' | 'pending' | 'neutral'
  label: string
}

/** Human verdict for a dry-run result. */
function verdictFor(result: RuleTestResult): Verdict {
  if (result.score === null) return { tone: 'pending', label: "Can't evaluate" }
  if (!result.ruleActive && result.wouldFire) {
    return { tone: 'neutral', label: 'Would match — rule is paused' }
  }
  if (result.wouldFire) return { tone: 'success', label: 'Would fire' }
  if (result.score > result.threshold) {
    return { tone: 'neutral', label: 'Match, but paused' }
  }
  return { tone: 'danger', label: 'Below threshold' }
}

interface RulePlaygroundProps {
  rule: StandingRule
}

/**
 * Trigger playground (issue #12): type a sample sentence, dry-run it against
 * the rule's stored trigger embedding, and see whether it would fire.
 * Mirrors the turn-time embedding gate (score > threshold, active only).
 */
export function RulePlayground({ rule }: RulePlaygroundProps) {
  const [probe, setProbe] = useState('')
  const [result, setResult] = useState<RuleTestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    const text = probe.trim()
    if (!text || loading) return
    setLoading(true)
    setError(null)
    try {
      setResult(await testRuleTrigger(rule.id, text))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed.')
    } finally {
      setLoading(false)
    }
  }

  // Meter geometry: score mapped to %, threshold marker at its own %.
  const scorePct =
    result?.score !== null && result?.score !== undefined
      ? Math.round(Math.max(0, Math.min(1, result.score)) * 100)
      : null
  const thresholdPct = Math.round((result?.threshold ?? 0.45) * 100)

  return (
    <div className="flex flex-col gap-lg border-t border-hairline pt-lg">
      <div className="flex items-center justify-between gap-sm">
        <span className="text-caption-medium uppercase tracking-wide text-ink2">
          Trigger playground
        </span>
        <span className="text-micro text-ink3">fires above {thresholdPct}% match</span>
      </div>

      <div className="flex gap-sm">
        <Input
          value={probe}
          onChange={(e) => setProbe(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void run()
            }
          }}
          placeholder='Try a sentence, e.g. "about to post this publicly"'
          aria-label="Sample sentence"
          disabled={loading}
        />
        <Button size="md" onClick={() => void run()} disabled={!probe.trim() || loading}>
          {loading ? <Spinner size={16} /> : 'Test'}
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-sm rounded-md bg-surface-alt p-lg">
          <div className="flex items-center gap-sm">
            <Badge tone={verdictFor(result).tone}>{verdictFor(result).label}</Badge>
            {result.score !== null && (
              <span className="text-caption text-ink2">
                match score <span className="font-medium text-ink">{formatScore(result.score)}</span>{' '}
                vs threshold {thresholdPct}%
              </span>
            )}
          </div>

          {scorePct !== null && (
            <div
              className="relative h-2 w-full overflow-hidden rounded-pill bg-hairline"
              role="meter"
              aria-valuenow={scorePct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Trigger match score"
            >
              <div
                className={`h-full rounded-pill ${result.wouldFire ? 'bg-success' : 'bg-pending'}`}
                style={{ width: `${scorePct}%` }}
              />
              {/* Threshold marker */}
              <div
                className="absolute inset-y-0 w-px bg-ink2"
                style={{ left: `${thresholdPct}%` }}
                aria-hidden
              />
            </div>
          )}

          <p className="text-caption text-ink3">{result.reason ?? 'No side effects — dry run only.'}</p>
        </div>
      )}
    </div>
  )
}
