import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { GitMerge, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import type { EntityDirectoryItem } from './api'
import { entityKeys, fetchEntityDirectory } from './api'
import { DirectoryControls, type EntitySort } from './components/DirectoryControls'
import { EntityCard } from './components/EntityCard'
import { MergeDialog } from './components/MergeDialog'
import { EmptyBlock, ErrorBlock, LoadingBlock } from './components/states'

/** Client-side filtering + sorting over the directory payload (server caps at 500 rows). */
function applyFilters(
  rows: EntityDirectoryItem[],
  query: string,
  type: string,
  sort: EntitySort,
): EntityDirectoryItem[] {
  const q = query.trim().toLowerCase()
  const filtered = rows.filter((e) => {
    if (type !== 'all' && e.type !== type) return false
    if (!q) return true
    return e.canonicalName.toLowerCase().includes(q) || e.type.includes(q)
  })

  const comparators: Record<
    EntitySort,
    (a: EntityDirectoryItem, b: EntityDirectoryItem) => number
  > = {
    mentions: (a, b) => b.mentionCount - a.mentionCount,
    recent: (a, b) =>
      (b.lastSeen ? Date.parse(b.lastSeen) : 0) - (a.lastSeen ? Date.parse(a.lastSeen) : 0),
    name: (a, b) => a.canonicalName.localeCompare(b.canonicalName),
  }
  return [...filtered].sort(comparators[sort])
}

export function EntitiesIndexPage() {
  const directory = useQuery({
    queryKey: entityKeys.directory(),
    queryFn: fetchEntityDirectory,
  })
  const queryClient = useQueryClient()
  const router = useRouter()

  const [query, setQuery] = useState('')
  const [type, setType] = useState('all')
  const [sort, setSort] = useState<EntitySort>('mentions')
  /** Checkbox picks for the merge dialog, in pick order. */
  const [picked, setPicked] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)

  const rows = useMemo(
    () => applyFilters(directory.data?.entities ?? [], query, type, sort),
    [directory.data, query, type, sort],
  )

  const togglePick = (id: string): void => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  const exitPickMode = (): void => {
    setPicking(false)
    setPicked([])
  }

  /** Land on the survivor's dossier so the folded result is visible immediately. */
  const finishMerge = (primaryId: string): void => {
    setMergeOpen(false)
    exitPickMode()
    void queryClient.invalidateQueries({ queryKey: entityKeys.all })
    void router.navigate({ to: '/entities/$id', params: { id: primaryId } })
  }

  return (
    <section className="flex flex-col gap-xl">
      <header className="flex flex-wrap items-end justify-between gap-md">
        <div>
          <h1 className="text-display font-bold tracking-tight">Entities</h1>
          <p className="text-sub text-ink2">
            Every person, place, project and topic yaadora knows about.
          </p>
        </div>
        {picking ? (
          <Button variant="ghost" size="sm" onClick={exitPickMode}>
            Cancel merge
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={(directory.data?.entities.length ?? 0) < 2}
            onClick={() => setPicking(true)}
            title="Spot two look-alikes? Tick both, then preview the merge"
          >
            <GitMerge size={15} /> Merge duplicates
          </Button>
        )}
      </header>

      <DirectoryControls
        query={query}
        onQuery={setQuery}
        type={type}
        onType={setType}
        sort={sort}
        onSort={setSort}
      />

      {directory.isPending && <LoadingBlock label="Loading entities…" />}
      {directory.isError && (
        <ErrorBlock error={directory.error} onRetry={() => void directory.refetch()} />
      )}
      {directory.isSuccess && rows.length === 0 && (
        <EmptyBlock
          title={query || type !== 'all' ? 'Nothing matches those filters.' : 'No entities yet.'}
          hint={
            query || type !== 'all'
              ? 'Try a different search or clear the type filter.'
              : 'Capture memories in the timeline — people and projects show up here once mentioned.'
          }
        />
      )}

      {directory.isSuccess && rows.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-lg sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((entity) => (
              <EntityCard
                key={entity.id}
                entity={entity}
                selectable={picking}
                selected={picked.includes(entity.id)}
                onToggleSelect={() => togglePick(entity.id)}
              />
            ))}
          </div>
          <p className="text-caption text-ink3">
            {rows.length} entit{rows.length === 1 ? 'y' : 'ies'}
          </p>
        </>
      )}

      {picking && picked.length >= 2 && !mergeOpen && (
        <div className="fixed bottom-xl left-1/2 z-40 flex -translate-x-1/2 items-center gap-md rounded-pill border border-hairline bg-surface px-xl py-sm shadow-lg">
          <span className="text-caption-medium">{picked.length} picked for merge</span>
          <Button size="sm" onClick={() => setMergeOpen(true)}>
            Preview merge
          </Button>
          <button
            type="button"
            aria-label="Clear selection"
            className="text-ink2 hover:text-ink"
            onClick={() => setPicked([])}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {mergeOpen && (
        <MergeDialog
          entities={directory.data?.entities ?? []}
          preselected={picked}
          onClose={() => setMergeOpen(false)}
          onMerged={finishMerge}
        />
      )}
    </section>
  )
}
