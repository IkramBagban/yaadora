import { AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { cn } from '../../lib/cn'

export interface Toast {
  toastId: string
  tone: 'saved' | 'error'
  message: string
}

interface ToastsProps {
  toasts: Toast[]
  onDismiss: (toastId: string) => void
}

/**
 * Bottom-right notices for the Ask page: deduped "Saved: …" confirmations for
 * `captured` frames and transient errors (voice, network). Auto-expiry is
 * driven by the page; each toast also closes on click.
 */
export function Toasts({ toasts, onDismiss }: ToastsProps) {
  if (toasts.length === 0) return null

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-xxl right-xxl z-50 flex w-80 flex-col gap-sm"
    >
      {toasts.map((toast) => (
        <div
          key={toast.toastId}
          className="toast-enter pointer-events-auto flex items-start gap-sm rounded-md border border-hairline bg-surface p-md shadow-lg"
        >
          {toast.tone === 'saved' ? (
            <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-success" />
          ) : (
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-danger" />
          )}
          <p className={cn('min-w-0 flex-1 text-caption', toast.tone === 'saved' ? 'text-ink2' : 'text-danger')}>
            {toast.tone === 'saved' && <span className="font-medium text-ink">Saved: </span>}
            <span className="line-clamp-2">{toast.message}</span>
          </p>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(toast.toastId)}
            className="shrink-0 rounded-sm text-ink3 transition-colors hover:text-ink"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
