import { useMemo, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { useRules } from './hooks'
import type { StandingRule } from '../../api/types'
import { RuleCard } from './components/RuleCard'
import { RuleEditor } from './components/RuleEditor'

type Filter = 'all' | 'active' | 'paused'

const filters: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'paused', label: 'Paused' },
]

function matches(rule: StandingRule, filter: Filter): boolean {
  if (filter === 'active') return rule.active
  if (filter === 'paused') return !rule.active
  return true
}

/**
 * Rules manager page (issue #12): audit which standing rules influence
 * behavior, pause/edit them, and test triggers before relying on them.
 */
export function RulesPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const [creating, setCreating] = useState(false)
  const query = useRules()
  // Memoized so downstream useMemo/useEffect deps stay stable across renders.
  const rules = useMemo(() => query.data?.rules ?? [], [query.data])

  const counts = useMemo(
    () => ({
      all: rules.length,
      active: rules.filter((r) => r.active).length,
      paused: rules.filter((r) => !r.active).length,
    }),
    [rules],
  )

  // Bars normalize against the busiest rule across the whole list, not the
  // filtered slice, so counts stay comparable while switching filters.
  const maxApplyCount = useMemo(
    () => rules.reduce((max, r) => Math.max(max, r.appliedCount), 0),
    [rules],
  )

  return (
    <section className="flex flex-col gap-xl">
      <header className="flex items-start justify-between gap-md">
        <div className="flex flex-col gap-xs">
          <h1 className="text-display font-bold tracking-tight">Rules</h1>
          <p className="text-sub text-ink2">
            Standing instructions yaadora follows — always/never behaviors matched
            by trigger situations.
          </p>
        </div>
        <Button onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
          {creating ? 'Close form' : 'New rule'}
        </Button>
      </header>

      {creating && (
        <RuleEditor
          mode="create"
          onCancel={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            setFilter('all')
          }}
        />
      )}

      <nav className="flex gap-sm" aria-label="Filter rules by state">
        {filters.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={`rounded-pill px-lg py-1 text-caption-medium transition-colors ${
              filter === key
                ? 'bg-accent-soft text-accent'
                : 'text-ink2 hover:bg-surface-alt hover:text-ink'
            }`}
          >
            {label} <span className="text-ink3">{counts[key]}</span>
          </button>
        ))}
      </nav>

      <Body query={query} filter={filter} maxApplyCount={maxApplyCount} />
    </section>
  )
}

interface BodyProps {
  query: ReturnType<typeof useRules>
  filter: Filter
  maxApplyCount: number
}

function Body({ query, filter, maxApplyCount }: BodyProps) {
  if (query.isPending) {
    return (
      <div className="flex justify-center py-huge">
        <Spinner size={28} />
      </div>
    )
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-center gap-md py-huge text-center">
        <p className="text-sub text-danger">
          {query.error instanceof Error ? query.error.message : 'Could not load rules.'}
        </p>
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  const visible = (query.data?.rules ?? []).filter((rule) => matches(rule, filter))

  if (visible.length === 0) {
    const emptyCopy =
      filter === 'all'
        ? 'No standing rules yet. Capture one in chat, or create one manually.'
        : `No ${filter} rules right now.`
    return (
      <div className="flex flex-col items-center gap-sm rounded-lg border border-dashed border-hairline py-huge text-center">
        <p className="text-sub text-ink2">{emptyCopy}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-lg">
      {visible.map((rule) => (
        <RuleCard key={rule.id} rule={rule} maxApplyCount={maxApplyCount} />
      ))}
    </div>
  )
}
