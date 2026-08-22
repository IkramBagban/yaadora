import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { getMemoryDetail } from '../../api/memories'
import { Badge } from '../../components/ui/Badge'
import { Spinner } from '../../components/ui/Spinner'
import { formatDateTime } from '../../lib/format'

/**
 * Slide-over showing the provenance memory behind a fact/rule/loop: the raw
 * capture plus everything ingestion derived from it. Controlled — the parent
 * owns which memory is open (`memoryId`); null renders nothing.
 */
interface MemoryDrawerProps {
  memoryId: string | null
  onClose: () => void
}

export function MemoryDrawer({ memoryId, onClose }: MemoryDrawerProps) {
  const open = memoryId != null

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  const detail = useQuery({
    queryKey: ['memory-detail', memoryId],
    queryFn: () => getMemoryDetail(memoryId as string),
    enabled: open,
    staleTime: 30_000,
    retry: 1,
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Source memory">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-hairline bg-surface shadow-xl">
        <header className="flex items-center justify-between border-b border-hairline px-xl py-md">
          <h2 className="text-title font-semibold">Source memory</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-sm p-xs text-ink2 hover:bg-surface-alt hover:text-ink"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-xl overflow-y-auto p-xl">
          {detail.isPending && (
            <div className="flex items-center gap-sm text-ink2">
              <Spinner size={16} /> Loading memory…
            </div>
          )}

          {detail.isError && (
            <p className="text-sub text-danger">
              Couldn’t load this memory. {detail.error.message}
            </p>
          )}

          {detail.data && (
            <>
              <blockquote className="rounded-md bg-surface-alt p-lg text-serif-body leading-relaxed text-ink">
                {detail.data.memory.rawText}
              </blockquote>

              <dl className="grid grid-cols-2 gap-x-lg gap-y-sm text-caption">
                <Meta label="Captured" value={formatDateTime(detail.data.memory.createdAt)} />
                <Meta label="Occurred" value={formatDateTime(detail.data.memory.occurredAt)} />
                <Meta label="Source" value={detail.data.memory.source} />
                <Meta label="Status" value={detail.data.memory.status} />
              </dl>

              {detail.data.entities.length > 0 && (
                <section>
                  <SectionTitle>Entities mentioned</SectionTitle>
                  <div className="flex flex-wrap gap-xs">
                    {detail.data.entities.map((e) => (
                      <Badge key={e.id} tone="neutral">
                        {e.canonicalName}
                      </Badge>
                    ))}
                  </div>
                </section>
              )}

              {detail.data.facts.length > 0 && (
                <section>
                  <SectionTitle>Facts derived from this memory</SectionTitle>
                  <ul className="space-y-sm">
                    {detail.data.facts.map((f) => (
                      <li key={f.id} className="rounded-md border border-hairline p-md text-sub">
                        {f.factText}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-micro uppercase text-ink3">{label}</dt>
      <dd className="text-ink2">{value}</dd>
    </div>
  )
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="mb-sm text-micro uppercase text-ink3">{children}</h3>
}
