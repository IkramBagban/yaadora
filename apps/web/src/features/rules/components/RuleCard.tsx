import { useState } from 'react'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import type { StandingRule } from '../../../api/types'
import { useToggleRuleActive } from '../hooks'
import { applyBarWidth, timeAgo } from '../utils'
import { RuleEditor } from './RuleEditor'
import { RuleHistory } from './RuleHistory'
import { RulePlayground } from './RulePlayground'

type Panel = 'edit' | 'test' | 'history' | null

interface RuleCardProps {
  rule: StandingRule
  /** Largest applyCount in the list, for normalizing usage bars. */
  maxApplyCount: number
}

/**
 * One standing rule: wording + trigger, usage stats, pause/resume, and the
 * three expandable tools from issue #12 — edit-as-correction, trigger
 * playground, supersession history.
 */
export function RuleCard({ rule, maxApplyCount }: RuleCardProps) {
  const [panel, setPanel] = useState<Panel>(null)
  const toggle = useToggleRuleActive()

  function open(next: Exclude<Panel, null>) {
    setPanel((current) => (current === next ? null : next))
  }

  return (
    <Card className="flex flex-col gap-md">
      <div className="flex items-start justify-between gap-md">
        <div className="flex flex-col gap-xs">
          <p className="text-body font-medium text-ink">{rule.ruleText}</p>
          <p className="text-caption text-ink2">when: {rule.triggerText}</p>
        </div>
        <Badge tone={rule.active ? 'success' : 'pending'}>
          {rule.active ? 'Active' : 'Paused'}
        </Badge>
      </div>

      <UsageStats rule={rule} maxApplyCount={maxApplyCount} />

      <div className="flex flex-wrap gap-xs">
        <Button
          variant="secondary"
          size="sm"
          disabled={toggle.isPending}
          onClick={() =>
            toggle.mutate({ id: rule.id, active: !rule.active })
          }
        >
          {rule.active ? 'Pause' : 'Resume'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={panel === 'edit'}
          onClick={() => open('edit')}
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={panel === 'test'}
          onClick={() => open('test')}
        >
          Test
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={panel === 'history'}
          onClick={() => open('history')}
        >
          History
        </Button>
      </div>

      {panel === 'edit' && (
        <RuleEditor
          mode="correct"
          initial={{ ruleText: rule.ruleText, triggerText: rule.triggerText }}
          ruleId={rule.id}
          onCancel={() => setPanel(null)}
          // The list refetches after correction; the new head replaces this
          // card, so closing the panel is all that's needed here.
          onSaved={() => setPanel(null)}
        />
      )}

      {panel === 'test' && <RulePlayground rule={rule} />}

      {panel === 'history' && <RuleHistory ruleId={rule.id} />}
    </Card>
  )
}

function UsageStats({ rule, maxApplyCount }: RuleCardProps) {
  return (
    <div className="flex flex-col gap-xs">
      <div className="flex items-center justify-between text-micro text-ink3">
        <span>
          Applied <span className="font-medium text-ink2">{rule.appliedCount}×</span>
        </span>
        <span>last {timeAgo(rule.lastAppliedAt)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-pill bg-hairline" aria-hidden>
        <div
          className={`h-full rounded-pill ${rule.appliedCount > 0 ? 'bg-accent' : ''}`}
          style={{ width: `${applyBarWidth(rule.appliedCount, maxApplyCount)}%` }}
        />
      </div>
    </div>
  )
}
