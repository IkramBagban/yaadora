import { Search } from 'lucide-react'
import { Input } from '../../../components/ui/Input'
import { cn } from '../../../lib/cn'
import { ENTITY_TYPES } from '../meta'

export type EntitySort = 'mentions' | 'recent' | 'name'

interface DirectoryControlsProps {
  query: string
  onQuery: (value: string) => void
  type: string
  onType: (value: string) => void
  sort: EntitySort
  onSort: (value: EntitySort) => void
}

const SORT_OPTIONS: Array<{ value: EntitySort; label: string }> = [
  { value: 'mentions', label: 'Most mentioned' },
  { value: 'recent', label: 'Recently seen' },
  { value: 'name', label: 'Name A–Z' },
]

/**
 * E-1 toolbar: search box, type filter chips, sort select.
 * Filtering/sorting happen client-side over the directory payload.
 */
export function DirectoryControls({ query, onQuery, type, onType, sort, onSort }: DirectoryControlsProps) {
  const chipClasses = (active: boolean): string =>
    cn(
      'rounded-pill border px-md py-1 text-caption-medium transition-colors',
      active
        ? 'border-accent bg-accent-soft text-accent'
        : 'border-hairline bg-surface text-ink2 hover:border-accent hover:text-accent',
    )

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-center gap-md">
        <div className="relative min-w-56 flex-1">
          <Search size={15} className="pointer-events-none absolute left-md top-1/2 -translate-y-1/2 text-ink3" />
          <Input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search people, places, projects…"
            aria-label="Search entities"
            className="pl-xxl"
          />
        </div>
        <label className="flex items-center gap-sm text-caption text-ink2">
          Sort
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as EntitySort)}
            aria-label="Sort entities"
            className="h-10 rounded-md border border-hairline bg-surface px-md text-caption-medium text-ink focus:border-accent focus:outline-none"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-xs" role="group" aria-label="Filter by type">
        <button type="button" className={chipClasses(type === 'all')} onClick={() => onType('all')}>
          All
        </button>
        {ENTITY_TYPES.map((t) => (
          <button key={t} type="button" className={chipClasses(type === t)} onClick={() => onType(t)}>
            {t}
          </button>
        ))}
      </div>
    </div>
  )
}
