import type { HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds a hairline-separated header zone when children include a title. */
  padded?: boolean
}

export function Card({ padded = true, className = '', ...rest }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-hairline bg-surface ${padded ? 'p-xl' : ''} ${className}`}
      {...rest}
    />
  )
}

export function CardTitle({ className = '', ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={`text-title font-semibold ${className}`} {...rest} />
}
