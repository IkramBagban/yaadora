import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { ApiError } from '../../api/client'
import { Card, CardTitle } from '../../components/ui/Card'
import {
  entityKeys,
  fetchEntityContext,
  fetchEntityDirectory,
  fetchEntityFacts,
} from './api'
import { FactsSection } from './components/FactsSection'
import { HistorySection } from './components/HistorySection'
import { OpenLoopsList } from './components/OpenLoopsList'
import { ProfileHeader } from './components/ProfileHeader'
import { ReceiptsList } from './components/ReceiptsList'
import { RelationsMap } from './components/RelationsMap'
import { ErrorBlock, LoadingBlock } from './components/states'

/** Render-pure "now" for this module load — validity windows are coarse by design. */
const LOADED_AT = Date.now()

function NotFoundBlock(): React.ReactElement {
  return (
    <ErrorBlock
      error={new Error('This entity does not exist (it may have been merged into another one).')}
    />
  )
}

/** E-2..E-7 dossier: header + AI profile + facts/history/conflicts + loops + relations + receipts. */
export function EntityProfilePage({ entityId }: { entityId: string }) {
  const context = useQuery({
    queryKey: entityKeys.context(entityId),
    queryFn: () => fetchEntityContext(entityId),
    retry: (failureCount, error) => !(error instanceof ApiError && error.status === 404) && failureCount < 2,
  })
  const currentFacts = useQuery({
    queryKey: [...entityKeys.facts(entityId), 'current'],
    queryFn: () => fetchEntityFacts(entityId, 'current'),
    enabled: context.isSuccess,
  })
  const historyFacts = useQuery({
    queryKey: [...entityKeys.facts(entityId), 'history'],
    queryFn: () => fetchEntityFacts(entityId, 'history'),
    enabled: context.isSuccess,
  })
  const directory = useQuery({
    queryKey: entityKeys.directory(),
    queryFn: fetchEntityDirectory,
    enabled: context.isSuccess,
  })

  const directoryRow = directory.data?.entities.find((e) => e.id === entityId) ?? null

  /** Observation window for validity bars: earliest fact bound → now. */
  const [windowStart, windowEnd] = useMemo(() => {
    const all = [...(currentFacts.data ?? []), ...(historyFacts.data ?? [])]
    const times = all.flatMap((f) =>
      [f.validFrom, f.createdAt].map((iso) => (iso ? Date.parse(iso) : Number.NaN)),
    )
    const valid = times.filter((t) => !Number.isNaN(t))
    return [valid.length ? Math.min(...valid) : LOADED_AT, LOADED_AT] as const
  }, [currentFacts.data, historyFacts.data])

  if (context.isPending) return <LoadingBlock label="Opening dossier…" />

  if (context.isError) {
    return context.error instanceof ApiError && context.error.status === 404 ? (
      <NotFoundBlock />
    ) : (
      <ErrorBlock error={context.error} onRetry={() => void context.refetch()} />
    )
  }

  const payload = context.data
  const closedFacts = (historyFacts.data ?? []).filter(
    (f) => f.validTo !== null && !(currentFacts.data ?? []).some((c) => c.id === f.id),
  )

  return (
    <section className="flex flex-col gap-xl">
      <ProfileHeader payload={payload} directoryRow={directoryRow} />

      {payload.profile && (
        <Card>
          <CardTitle className="flex items-center gap-sm">
            <Sparkles size={16} className="text-accent" /> Profile
          </CardTitle>
          <p className="mt-sm text-body text-ink2">{payload.profile}</p>
          <p className="mt-md text-caption text-ink3">
            Consolidated by yaadora — rebuilt nightly from every mention.
          </p>
        </Card>
      )}

      <Card>
        <CardTitle>Facts</CardTitle>
        <div className="mt-md">
          {currentFacts.isPending ? (
            <LoadingBlock label="Loading facts…" />
          ) : currentFacts.isError ? (
            <ErrorBlock error={currentFacts.error} onRetry={() => void currentFacts.refetch()} />
          ) : (
            <FactsSection facts={currentFacts.data} windowStart={windowStart} windowEnd={windowEnd} />
          )}
        </div>

        {historyFacts.isError && (
          <p className="mt-md text-caption text-ink3">Superseded history unavailable right now.</p>
        )}
        {!historyFacts.isPending && !historyFacts.isError && (closedFacts.length > 0 || (currentFacts.data?.length ?? 0) > 0) && (
          <div className="mt-md border-t border-hairline pt-md">
            <HistorySection facts={closedFacts} windowStart={windowStart} windowEnd={windowEnd} />
          </div>
        )}
      </Card>

      <div className="grid gap-xl lg:grid-cols-2">
        <Card>
          <CardTitle>Relationships</CardTitle>
          <div className="mt-md">
            <RelationsMap edges={payload.edges} />
          </div>
        </Card>

        <Card>
          <CardTitle>Open loops</CardTitle>
          <div className="mt-md">
            <OpenLoopsList loops={payload.openLoops} />
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle>Receipts</CardTitle>
        <p className="mb-md mt-xs text-caption text-ink3">
          The memories behind this dossier — tappable sources.
        </p>
        <ReceiptsList receipts={payload.receipts} />
      </Card>
    </section>
  )
}
