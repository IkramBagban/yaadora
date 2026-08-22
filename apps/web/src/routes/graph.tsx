import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { SlidersHorizontal } from 'lucide-react'
import { fetchGraphSnapshot } from '../api/graph'
import { EntityPanel } from '../features/graph/EntityPanel'
import { GraphCanvas } from '../features/graph/GraphCanvas'
import { FilterRail } from '../features/graph/FilterRail'
import { Legend } from '../features/graph/Legend'
import { GraphEmptyState, GraphErrorState, GraphSkeleton } from '../features/graph/GraphStates'
import {
  buildVisibleGraph,
  computeMetrics,
  orderedTypes,
  typeCounts,
  type VisibleGraph,
} from '../features/graph/graphModel'
import { computeLayout } from '../features/graph/layout'

const EMPTY_GRAPH: VisibleGraph = { nodes: [], edges: [] }

export const Route = createFileRoute('/graph')({
  component: function GraphPage() {
    const { data: snapshot, isPending, isError, refetch } = useQuery({
      queryKey: ['graph-snapshot'],
      queryFn: fetchGraphSnapshot,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    })

    // Heavy derivations run once per dataset, never per interaction.
    const metrics = useMemo(() => (snapshot ? computeMetrics(snapshot) : null), [snapshot])
    const layout = useMemo(
      () => (snapshot ? computeLayout(snapshot.entities, snapshot.edges) : null),
      [snapshot],
    )
    const types = useMemo(() => (snapshot ? orderedTypes(snapshot.entities) : []), [snapshot])
    const counts = useMemo(
      () => (snapshot ? typeCounts(snapshot.entities) : new Map<string, number>()),
      [snapshot],
    )

    const [enabledTypes, setEnabledTypes] = useState<ReadonlySet<string> | null>(null)
    const [minStrength, setMinStrength] = useState(0)
    const [withinMonths, setWithinMonths] = useState<number | null>(null)
    const [hideIsolated, setHideIsolated] = useState(false)
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [focusId, setFocusId] = useState<string | null>(null)
    const [jumpTo, setJumpTo] = useState<{ id: string } | null>(null)
    const [fitNonce, setFitNonce] = useState(0)
    const [railOpen, setRailOpen] = useState(false)

    // null means "everything on" until the dataset's types are known.
    const effectiveTypes = useMemo(() => enabledTypes ?? new Set(types), [enabledTypes, types])

    const visible = useMemo(
      () =>
        snapshot && layout && metrics
          ? buildVisibleGraph(
              snapshot,
              layout,
              metrics,
              { enabledTypes: effectiveTypes, minStrength, withinMonths, hideIsolated },
              focusId,
            )
          : EMPTY_GRAPH,
      [snapshot, layout, metrics, effectiveTypes, minStrength, withinMonths, hideIsolated, focusId],
    )

    const selectedEntity = useMemo(
      () => snapshot?.entities.find((e) => e.id === selectedId),
      [snapshot, selectedId],
    )

    const refit = () => setFitNonce((n) => n + 1)

    const toggleType = (type: string) => {
      setEnabledTypes((prev) => {
        const next = new Set(prev ?? types)
        if (next.has(type)) next.delete(type)
        else next.add(type)
        return next
      })
      refit()
    }

    const setAllTypes = (enabled: boolean) => {
      setEnabledTypes(new Set(enabled ? types : []))
      refit()
    }

    const jump = (id: string) => {
      // Search is global: leave any focused neighborhood and centre on the hit.
      setFocusId(null)
      setSelectedId(id)
      setJumpTo({ id })
    }

    if (isPending) return <GraphSkeleton />
    if (isError) return <GraphErrorState onRetry={() => void refetch()} />
    if (!snapshot || snapshot.entities.length === 0) return <GraphEmptyState />

    return (
      <div className="relative flex h-[calc(100dvh-3.5rem)] w-full overflow-hidden">
        <div
          className={`${railOpen ? 'flex' : 'hidden'} absolute inset-y-0 left-0 z-20 shadow-xl md:relative md:z-auto md:flex md:shadow-none`}
        >
          <FilterRail
            types={types}
            counts={counts}
            enabledTypes={effectiveTypes}
            onToggleType={toggleType}
            onSetAllTypes={setAllTypes}
            maxStrength={metrics?.maxStrength ?? 0}
            minStrength={minStrength}
            onMinStrengthChange={(value) => {
              setMinStrength(value)
              refit()
            }}
            withinMonths={withinMonths}
            onWithinMonthsChange={(months) => {
              setWithinMonths(months)
              refit()
            }}
            hideIsolated={hideIsolated}
            onHideIsolatedChange={(hide) => {
              setHideIsolated(hide)
              refit()
            }}
            entities={snapshot.entities}
            onJump={jump}
          />
        </div>

        <div className="relative min-w-0 flex-1">
          <button
            type="button"
            aria-label={railOpen ? 'Close filters' : 'Open filters'}
            onClick={() => setRailOpen((v) => !v)}
            className="absolute top-md left-md z-10 rounded-md border border-hairline bg-surface p-xs text-ink2 shadow-xs hover:text-ink md:hidden"
          >
            <SlidersHorizontal size={16} />
          </button>

          <GraphCanvas
            nodes={visible.nodes}
            edges={visible.edges}
            jumpTo={jumpTo}
            fitNonce={fitNonce}
            onSelectNode={setSelectedId}
          />

          <Legend />

          {focusId && (
            <div className="absolute top-md left-1/2 z-10 -translate-x-1/2 rounded-pill border border-hairline bg-surface px-lg py-xs text-caption text-ink2 shadow-xs">
              Neighborhood view —{' '}
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => {
                  setFocusId(null)
                  refit()
                }}
              >
                show full graph
              </button>
            </div>
          )}

          {visible.nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <p className="rounded-md border border-hairline bg-surface px-lg py-md text-sub text-ink2 shadow-xs">
                No entities match the current filters.
              </p>
            </div>
          )}
        </div>

        {selectedId && (
          <div className="absolute inset-y-0 right-0 z-20 shadow-xl md:relative md:z-auto md:h-full md:shadow-none">
            <EntityPanel
              entityId={selectedId}
              snapshotEntity={selectedEntity}
              focused={focusId === selectedId}
              onClose={() => setSelectedId(null)}
              onFocus={() => {
                setFocusId(selectedId)
                refit()
              }}
              onClearFocus={() => {
                setFocusId(null)
                refit()
              }}
            />
          </div>
        )}
      </div>
    )
  },
})
