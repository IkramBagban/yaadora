import { Link } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { Card } from '../../../components/ui/Card'
import { Badge } from '../../../components/ui/Badge'
import { cn } from '../../../lib/cn'
import { formatRelative } from '../format'
import { entityTypeMeta } from '../meta'
import type { EntityDirectoryItem } from '../api'

interface EntityCardProps {
  entity: EntityDirectoryItem
  /** Merge-selection mode is active → show a pick checkbox. */
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: () => void
}

/**
 * E-1 directory card. The whole card links to the profile page; the merge
 * checkbox sits on top and stops propagation so both stay tappable.
 */
export function EntityCard({ entity, selectable = false, selected = false, onToggleSelect }: EntityCardProps) {
  const { icon: Icon } = entityTypeMeta(entity.type)

  return (
    <Card padded={false} className="group relative overflow-hidden">
      <Link
        to="/entities/$id"
        params={{ id: entity.id }}
        className="block p-xl transition-colors hover:bg-surface-alt"
      >
        <div className="flex items-start justify-between gap-sm">
          <div className="flex min-w-0 items-center gap-sm">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
              <Icon size={16} />
            </span>
            <h3 className="truncate text-body font-semibold">{entity.canonicalName}</h3>
          </div>
          <Badge tone="accent">{entity.type}</Badge>
        </div>

        {entity.profile && (
          <p className="mt-sm line-clamp-2 text-caption text-ink2">{entity.profile}</p>
        )}

        <div className="mt-lg flex items-center gap-lg text-caption text-ink3">
          <span className="font-medium text-ink2">{entity.mentionCount} mentions</span>
          <span aria-label="last seen">seen {formatRelative(entity.lastSeen)}</span>
        </div>
      </Link>

      {selectable && (
        <button
          type="button"
          aria-label={selected ? `Deselect ${entity.canonicalName}` : `Select ${entity.canonicalName} for merge`}
          aria-pressed={selected}
          onClick={onToggleSelect}
          className={cn(
            'absolute right-md top-md flex size-6 items-center justify-center rounded-sm border transition-colors',
            selected
              ? 'border-accent bg-accent text-on-accent'
              : 'border-hairline bg-surface text-transparent hover:border-accent',
          )}
        >
          <Check size={14} strokeWidth={3} />
        </button>
      )}
    </Card>
  )
}
