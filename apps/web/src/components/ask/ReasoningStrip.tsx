import { useState } from 'react'
import {
  Bell,
  Brain,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { AskStep, AskStepKind } from '../../api/types'
import { cn } from '../../lib/cn'

const stepIcons: Record<AskStepKind, LucideIcon> = {
  search: Search,
  clarify: CircleHelp,
  synthesize: Sparkles,
  reminder: Bell,
  rule: ShieldCheck,
  entity: Users,
}

interface ReasoningStripProps {
  steps: AskStep[]
  streaming: boolean
}

/**
 * Collapsible reasoning trace for one exchange. Follows the stream (expanded
 * while frames arrive, collapsed once the turn settles) unless the user has
 * toggled it themselves.
 */
export function ReasoningStrip({ steps, streaming }: ReasoningStripProps) {
  const [override, setOverride] = useState<boolean | null>(null)
  const open = override ?? streaming

  if (steps.length === 0) return null

  const lastStep = steps[steps.length - 1]

  return (
    <div className="rounded-md border border-hairline bg-surface-alt/60">
      <button
        type="button"
        onClick={() => setOverride(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-sm rounded-md px-md py-sm text-caption-medium text-ink2 transition-colors hover:text-ink"
      >
        <Brain size={14} className="shrink-0 text-ink3" />
        {streaming && lastStep ? (
          <span className="flex min-w-0 items-center gap-xs">
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
            <span className="truncate">{lastStep.label}</span>
          </span>
        ) : (
          <span>
            {steps.length} step{steps.length === 1 ? '' : 's'}
          </span>
        )}
        {open ? (
          <ChevronDown size={14} className="ml-auto shrink-0 text-ink3" />
        ) : (
          <ChevronRight size={14} className="ml-auto shrink-0 text-ink3" />
        )}
      </button>

      {open && (
        <ol className="flex flex-col gap-xs border-t border-hairline px-md py-sm">
          {steps.map((step, index) => {
            const Icon = stepIcons[step.kind] ?? Sparkles
            const isLive = streaming && index === steps.length - 1
            return (
              <li
                key={`${step.kind}-${step.label}-${index}`}
                className="flex items-start gap-sm text-caption text-ink2"
              >
                <Icon size={13} className="mt-0.5 shrink-0 text-ink3" />
                <span className="min-w-0 flex-1">
                  {step.label}
                  {step.query && (
                    <span className="ml-xs text-ink3">“{step.query}”</span>
                  )}
                  {typeof step.count === 'number' && step.count > 0 && (
                    <span className="ml-xs text-ink3">· {step.count}</span>
                  )}
                </span>
                {isLive && (
                  <span className={cn('mt-1 size-1.5 shrink-0 animate-pulse rounded-full bg-accent')} />
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
