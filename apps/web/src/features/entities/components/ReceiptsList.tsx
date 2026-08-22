import { useState } from 'react'
import { ChevronDown, ExternalLink } from 'lucide-react'
import type { EntityReceipt } from '../api'
import { cn } from '../../../lib/cn'
import { formatDate } from '../format'
import { EmptyBlock } from './states'

interface ReceiptsListProps {
  receipts: EntityReceipt[]
}

/**
 * E-7 receipts: the memories that mention this entity — tappable sources.
 * Each expands inline to the full snippet and deep-links into the timeline
 * (`?memory=` focus param, honoured by the timeline track's detail view).
 */
export function ReceiptsList({ receipts }: ReceiptsListProps) {
  const [openId, setOpenId] = useState<string | null>(null)

  if (receipts.length === 0) {
    return <EmptyBlock title="No receipts yet." hint="Memories that mention this entity appear here as sources." />
  }

  return (
    <ul className="flex flex-col divide-y divide-hairline">
      {receipts.map((receipt) => {
        const open = openId === receipt.id
        return (
          <li key={receipt.id} className="py-md">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : receipt.id)}
              className="group flex w-full items-start gap-sm text-left"
            >
              <ChevronDown
                size={14}
                className={cn('mt-1 shrink-0 text-ink3 transition-transform', open && 'rotate-180')}
              />
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sub text-ink', !open && 'truncate')}>
                  {receipt.snippet}
                </span>
                <span className="mt-xs block text-caption text-ink3">
                  {formatDate(receipt.occurredAt ?? receipt.createdAt)}
                </span>
              </span>
            </button>

            {open && (
              <div className="mt-sm flex items-center justify-between gap-md pl-lg">
                <span className="text-caption text-ink3">memory · {receipt.id.slice(0, 8)}…</span>
                {/* Timeline owns memory detail; ?memory= focuses it once shipped. */}
                <a
                  href={`/timeline?memory=${encodeURIComponent(receipt.id)}`}
                  className="inline-flex items-center gap-1 text-caption text-accent hover:underline"
                  title="Open in timeline"
                >
                  <ExternalLink size={12} /> open source
                </a>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
