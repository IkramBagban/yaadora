import { cn } from '../../lib/cn'

/** Shimmer-less pulse placeholder matching the shape it stands in for. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-sm bg-surface-alt', className)} />
}
