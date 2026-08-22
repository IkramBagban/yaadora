import { Gauge } from 'lucide-react'
import { Card } from '../ui/Card'

/**
 * AI usage placeholder. No server endpoint exposes token accounting yet
 * (checked apps/server/src/routes — /stats, /surfacings, /facts, /entities
 * carry nothing usage-shaped). Deliberately not faked; swap this card for a
 * real one when the endpoint lands.
 */
export function TokenUsageSection() {
  return (
    <Card className="flex flex-col gap-md">
      <div className="flex items-center gap-sm">
        <span className="flex size-9 items-center justify-center rounded-pill bg-surface-alt text-ink3">
          <Gauge size={16} />
        </span>
        <h2 className="text-title font-semibold">AI usage</h2>
      </div>
      <p className="text-caption text-ink2">
        Coming soon. The API doesn't expose token usage yet; this card will
        show ingestion, retrieval and consolidation spend once an endpoint
        ships. No estimates in the meantime.
      </p>
    </Card>
  )
}
