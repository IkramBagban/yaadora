import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { FactView } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { MemoryDrawer } from '../memory-drawer/MemoryDrawer'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import { groupBySubject } from './chain'
import { ConflictsInbox } from './ConflictsInbox'
import { SubjectSection } from './SubjectSection'
import { useFactsPages } from './queries'

const VIEW_OPTIONS: Array<{ value: FactView; label: string }> = [
  { value: 'current', label: 'Current beliefs' },
  { value: 'history', label: 'Full history' },
]

/**
 * Facts explorer: current beliefs vs full supersession history, grouped by
 * subject, with a conflicts inbox on top. Every fact links back to the memory
 * it was extracted from (slide-over drawer).
 */
export function FactsPage() {
  const [view, setView] = useState<FactView>('current')
  const [subjectInput, setSubjectInput] = useState('')
  const subject = useDebouncedValue(subjectInput, 300)
  const [sourceMemory, setSourceMemory] = useState<string | null>(null)

  const query = useFactsPages(view, subject)
  const facts = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  )
  const groups = useMemo(() => groupBySubject(facts), [facts])

  return (
    <div className="flex flex-col gap-xl">
      <header>
        <h1 className="text-display font-semibold">Facts</h1>
        <p className="mt-xs text-sub text-ink2">
          Atomic beliefs extracted from your memories — current truth, supersession
          history, and contradictions the pipeline couldn’t reconcile on its own.
        </p>
      </header>

      <ConflictsInbox onShowSource={setSourceMemory} />

      <div className="flex flex-col gap-md sm:flex-row sm:items-center">
        <div className="flex w-fit rounded-md border border-hairline bg-surface p-xs">
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={view === opt.value}
              onClick={() => setView(opt.value)}
              className={`rounded-sm px-lg py-1.5 text-caption-medium transition-colors ${
                view === opt.value
                  ? 'bg-accent-soft text-accent'
                  : 'text-ink2 hover:bg-surface-alt hover:text-ink'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="relative sm:ml-auto sm:w-72">
          <Search
            size={15}
            aria-hidden
            className="pointer-events-none absolute left-lg top-1/2 -translate-y-1/2 text-ink3"
          />
          <Input
            type="search"
            placeholder="Search subject…"
            value={subjectInput}
            onChange={(e) => setSubjectInput(e.target.value)}
            aria-label="Search facts by subject"
            className="pl-xxxl"
          />
        </div>
      </div>

      {query.isPending ? (
        <Card className="flex items-center gap-sm text-ink2">
          <Spinner size={16} /> Loading facts…
        </Card>
      ) : query.isError ? (
        <Card className="flex flex-wrap items-center justify-between gap-md">
          <p className="text-sub text-danger">{query.error.message}</p>
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <p className="text-sub text-ink2">
            {subject
              ? `No facts match “${subject}”.`
              : 'No facts yet — capture a memory and the pipeline will extract beliefs from it.'}
          </p>
        </Card>
      ) : (
        <>
          <p className="flex items-center gap-sm text-caption text-ink3">
            {facts.length} facts · {groups.length} subjects
            {view === 'history' && ' · supersession chains collapse into timelines'}
            {query.isFetching && <Spinner size={12} />}
          </p>

          <div className="flex flex-col gap-lg">
            {groups.map((group) => (
              <SubjectSection
                key={group.key}
                group={group}
                view={view}
                onShowSource={setSourceMemory}
              />
            ))}
          </div>

          {query.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
              >
                {query.isFetchingNextPage && <Spinner size={14} />}
                Load more
              </Button>
            </div>
          )}
        </>
      )}

      <MemoryDrawer memoryId={sourceMemory} onClose={() => setSourceMemory(null)} />
    </div>
  )
}
