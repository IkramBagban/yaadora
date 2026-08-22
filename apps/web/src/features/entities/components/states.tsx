import type { ReactNode } from 'react'
import { Spinner } from '../../../components/ui/Spinner'
import { Button } from '../../../components/ui/Button'

/**
 * Shared async-state blocks for the entities feature (loading / error / empty).
 * Keeps every section consistent without repeating layout classes.
 */

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-sm py-xxl text-sub text-ink2">
      <Spinner />
      <span>{label}</span>
    </div>
  )
}

export function ErrorBlock({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-md py-xxl text-center">
      <p className="text-sub text-danger">{error.message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function EmptyBlock({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-xs py-xxl text-center">
      <p className="text-sub font-medium">{title}</p>
      {hint && <p className="max-w-md text-caption text-ink3">{hint}</p>}
    </div>
  )
}
