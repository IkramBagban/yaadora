import type { MouseEventHandler } from 'react'
import { cn } from '../../lib/cn'
import type { PaletteItem } from './types'

interface PaletteRowProps {
  /** DOM id — referenced by the input's aria-activedescendant. */
  id: string
  item: PaletteItem
  active: boolean
  /** Mouse-over moves the keyboard cursor so hover and keys stay in sync. */
  onHover: () => void
  onSelect: () => void
}

export function PaletteRow({ id, item, active, onHover, onSelect }: PaletteRowProps) {
  const handleMouseMove: MouseEventHandler<HTMLButtonElement> = () => {
    if (!active) onHover()
  }

  return (
    <button
      type="button"
      id={id}
      role="option"
      tabIndex={-1}
      aria-selected={active}
      data-active={active || undefined}
      onClick={onSelect}
      onMouseMove={handleMouseMove}
      className={cn(
        'flex w-full items-center gap-md rounded-sm px-md py-sm text-left transition-colors',
        active ? 'bg-accent-soft' : 'hover:bg-surface-alt',
      )}
    >
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-xs border border-hairline bg-surface',
          active ? 'text-accent' : 'text-ink2',
        )}
      >
        <item.icon size={15} strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sub text-ink">{item.label}</span>
        {item.detail && <span className="block truncate text-caption text-ink3">{item.detail}</span>}
      </span>
      {item.meta && (
        <span className="shrink-0 text-micro uppercase tracking-wide text-ink3">{item.meta}</span>
      )}
    </button>
  )
}
