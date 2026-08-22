import { Badge } from '../../../components/ui/Badge'
import { Spinner } from '../../../components/ui/Spinner'
import type { StandingRule } from '../../../api/types'
import { useRuleHistory } from '../hooks'
import { timeAgo } from '../utils'

interface RuleHistoryProps {
  /** The head rule whose chain to load; also marks the current version. */
  ruleId: string
}

/**
 * Superseded-rule history chain (issue #12). Versions arrive newest-first;
 * the version without a supersededBy pointer is the live one.
 */
export function RuleHistory({ ruleId }: RuleHistoryProps) {
  const query = useRuleHistory(ruleId)

  if (query.isPending) {
    return (
      <div className="flex justify-center border-t border-hairline pt-lg">
        <Spinner />
      </div>
    )
  }

  if (query.isError) {
    return (
      <p role="alert" className="border-t border-hairline pt-lg text-caption text-danger">
        {query.error instanceof Error ? query.error.message : 'Could not load history.'}
      </p>
    )
  }

  const items = query.data?.items ?? []

  return (
    <div className="flex flex-col gap-sm border-t border-hairline pt-lg">
      <span className="text-caption-medium uppercase tracking-wide text-ink2">
        Version history
      </span>
      <ol className="ml-xs flex flex-col gap-md border-l border-hairline pl-xl">
        {items.map((version) => (
          <VersionRow key={version.id} version={version} isCurrent={version.supersededBy === null} />
        ))}
      </ol>
    </div>
  )
}

function VersionRow({ version, isCurrent }: { version: StandingRule; isCurrent: boolean }) {
  return (
    <li className="relative flex flex-col gap-xs">
      {/* Chain node dot */}
      <span
        aria-hidden
        className={`absolute -left-[25px] top-1.5 h-2 w-2 rounded-pill ${isCurrent ? 'bg-accent' : 'bg-hairline'}`}
      />
      <div className="flex flex-wrap items-center gap-sm">
        <Badge tone={isCurrent ? 'accent' : 'neutral'}>{isCurrent ? 'Current' : 'Superseded'}</Badge>
        <span className="text-micro text-ink3">
          {timeAgo(version.createdAt)} · applied {version.appliedCount}×
        </span>
      </div>
      <p className={`text-sub ${isCurrent ? 'text-ink' : 'text-ink2'}`}>{version.ruleText}</p>
      <p className="text-caption text-ink3">when: {version.triggerText}</p>
    </li>
  )
}
