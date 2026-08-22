import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
interface DialogProps {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
}

/**
 * Feature-local modal shell (the shared ui kit has none yet). Escape closes,
 * the overlay click closes, focus lands inside via autoFocus on fields.
 */
export function Dialog({ title, subtitle, onClose, children }: DialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-lg md:p-xxl"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={-1}
        className="fixed inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative z-10 my-[8vh] w-full max-w-md rounded-lg border border-hairline bg-surface p-xl shadow-xl">
        <div className="mb-lg flex items-start justify-between gap-md">
          <div>
            <h2 className="text-title font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-caption text-ink2">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-sm p-xs text-ink2 hover:bg-surface-alt hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
