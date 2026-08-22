import type { ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'

/** Card with a quiet hairline header: title left, optional action right. */
export function WidgetCard({
  title,
  action,
  children,
  className,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card padded={false} className={className}>
      <div className="flex items-center justify-between gap-md border-b border-hairline px-xl py-md">
        <h3 className="text-sub font-semibold">{title}</h3>
        {action}
      </div>
      <div className="p-xl">{children}</div>
    </Card>
  )
}

/** Calm per-widget failure line with a retry. */
export function WidgetError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-md">
      <p className="text-caption text-ink2">Couldn't load this right now.</p>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        <RotateCcw size={14} />
        Retry
      </Button>
    </div>
  )
}

/** Empty-widget placeholder; explains how the section fills up. */
export function WidgetEmpty({ children }: { children: ReactNode }) {
  return <p className="text-caption text-ink3">{children}</p>
}
