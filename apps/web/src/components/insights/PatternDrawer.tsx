import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { fetchMemoryDetail, supportingMemoryIds } from '../../api/insights'
import type { Fact, Memory } from '../../api/types'
import { Badge } from '../ui/Badge'

/**
 * Click-through drawer for a pattern insight: the insight text plus its
 * supporting-memory receipts (multi-provenance ids parsed from objectText —
 * see api/insights.ts). Receipts load on open; a missing memory degrades to a
 * note instead of breaking the drawer.
 */

const MAX_RECEIPTS = 5

interface Receipt {
  id: string
  memory: Memory | null
}

export function PatternDrawer({ fact, onClose }: { fact: Fact; onClose: () => void }) {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(true)

  const supportingIds = useMemo(() => supportingMemoryIds(fact), [fact])

  useEffect(() => {
    let cancelled = false
    const ids = supportingIds.slice(0, MAX_RECEIPTS)
    Promise.all(
      ids.map(async (id): Promise<Receipt> => {
        try {
          const detail = await fetchMemoryDetail(id)
          return { id, memory: detail.memory }
        } catch {
          return { id, memory: null }
        }
      }),
    ).then((r) => {
      if (!cancelled) {
        setReceipts(r)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [fact.id, supportingIds])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Pattern insight detail">
      <button
        type="button"
        aria-label="Close detail"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col gap-lg overflow-y-auto border-l border-hairline bg-surface p-xl shadow-2xl">
        <header className="flex items-start justify-between gap-md">
          <div className="flex flex-col gap-xs">
            <Badge tone="accent">Pattern</Badge>
            <p className="text-caption text-ink2">
              Found by nightly consolidation · confidence{' '}
              {Math.round((fact.confidence ?? 0) * 100)}%
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-pill p-xs text-ink2 transition-colors hover:bg-surface-alt hover:text-ink"
          >
            <X size={18} />
          </button>
        </header>

        <p className="text-body text-ink">{fact.factText}</p>

        <section className="flex flex-col gap-md">
          <h3 className="text-micro uppercase text-ink2">
            Supporting memories ({supportingIds.length}
            {supportingIds.length > MAX_RECEIPTS ? `, showing first ${MAX_RECEIPTS}` : ''})
          </h3>
          {loading ? (
            <div className="flex flex-col gap-sm" aria-label="Loading supporting memories">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-md bg-surface-alt" />
              ))}
            </div>
          ) : (
            <ul className="flex flex-col gap-sm">
              {receipts.map((r, i) => (
                <li key={r.id} className="rounded-md border border-hairline bg-bg p-md">
                  {r.memory ? (
                    <>
                      <p className="text-caption text-ink">{truncate(r.memory.rawText, 220)}</p>
                      <p className="mt-1 text-micro uppercase text-ink3">
                        {formatWhen(r.memory.occurredAt ?? r.memory.createdAt)}
                      </p>
                    </>
                  ) : (
                    <p className="text-caption text-ink3">
                      Receipt {i + 1} is unavailable right now.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-auto text-caption text-ink3">
          Patterns are candidate observations, not conclusions. They're generated
          from your memories and never shown proactively without receipts.
        </p>
      </div>
    </div>
  )
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
