import type { HTMLAttributes } from 'react'

type Tone = 'neutral' | 'accent' | 'success' | 'danger' | 'pending'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-surface-alt text-ink2',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-accent-soft text-success',
  danger: 'bg-accent-soft text-danger',
  pending: 'bg-accent-soft text-pending',
}

export function Badge({ tone = 'neutral', className = '', ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-pill px-sm py-0.5 text-micro uppercase ${toneClasses[tone]} ${className}`}
      {...rest}
    />
  )
}
