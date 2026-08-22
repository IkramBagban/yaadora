import { useState } from 'react'
import { EyeOff, ShieldCheck } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card, CardTitle } from '../../components/ui/Card'
import { Spinner } from '../../components/ui/Spinner'
import { Badge } from '../../components/ui/Badge'
import { pairConflicts } from './chain'
import { FactCard } from './FactCard'
import { useConflictedFacts, usePatchFact } from './queries'

/**
 * Conflicts inbox: cross-flagged, same-period contradictions rendered
 * side-by-side. A pair leaves the inbox when one side is hidden; "keep both"
 * records the decision as a reviewer note on both facts (the flag itself is
 * pipeline-owned and never cleared over the wire).
 */
export function ConflictsInbox({ onShowSource }: { onShowSource: (memoryId: string) => void }) {
  const conflicts = useConflictedFacts()
  const patch = usePatchFact()
  const [busyPair, setBusyPair] = useState<string | null>(null)

  if (conflicts.isPending) {
    return (
      <Card className="flex items-center gap-sm text-ink2">
        <Spinner size={16} /> Loading conflicts…
      </Card>
    )
  }
  // The inbox is best-effort — a failed load shouldn't block exploring facts.
  if (conflicts.isError) return null

  const pairs = pairConflicts(conflicts.data.items).filter(
    (p) => !p.a.hidden && !p.b.hidden,
  )

  async function keepBoth(pairKey: string, aId: string, bId: string) {
    setBusyPair(pairKey)
    const note = `Reviewed ${new Date().toISOString().slice(0, 10)} — kept both sides.`
    try {
      await patch.mutateAsync({ id: aId, conflictNote: note })
      await patch.mutateAsync({ id: bId, conflictNote: note })
    } finally {
      setBusyPair(null)
    }
  }

  return (
    <Card>
      <div className="mb-md flex items-center gap-sm">
        <ShieldCheck size={18} className="text-danger" />
        <CardTitle>Conflicts inbox</CardTitle>
        {pairs.length > 0 && <Badge tone="danger">{pairs.length}</Badge>}
      </div>

      {pairs.length === 0 ? (
        <p className="text-sub text-ink2">
          No unresolved conflicts — nothing the pipeline flagged as contradictory.
        </p>
      ) : (
        <div className="flex flex-col gap-lg">
          {pairs.map((pair) => {
            const key = [pair.a.id, pair.b.id].sort().join('|')
            const reviewed = pair.a.conflictNote != null && pair.b.conflictNote != null
            const busy = busyPair === key || patch.isPending
            return (
              <div key={key} className="rounded-md border border-hairline p-md">
                {reviewed ? (
                  <p className="flex flex-wrap items-center gap-sm text-sub text-ink2">
                    <Badge tone="success">kept both</Badge>
                    <span className="truncate">{pair.a.factText}</span>
                    <span aria-hidden className="text-ink3">vs</span>
                    <span className="truncate">{pair.b.factText}</span>
                  </p>
                ) : (
                  <>
                    <div className="grid items-stretch gap-md md:grid-cols-2">
                      {[pair.a, pair.b].map((fact) => (
                        <FactCard
                          key={fact.id}
                          fact={fact}
                          onShowSource={onShowSource}
                          actions={
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={busy}
                              onClick={() => patch.mutate({ id: fact.id, hidden: true })}
                            >
                              <EyeOff size={14} /> Hide this one
                            </Button>
                          }
                        />
                      ))}
                    </div>
                    <div className="mt-md flex items-center justify-end gap-sm">
                      {patch.isError && (
                        <span className="text-caption text-danger">{patch.error.message}</span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void keepBoth(key, pair.a.id, pair.b.id)}
                      >
                        {busyPair === key ? <Spinner size={14} /> : null}
                        Keep both
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
