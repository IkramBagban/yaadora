import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-accent text-on-accent hover:opacity-90 active:opacity-80 shadow-xs',
  secondary:
    'bg-surface-alt text-ink border border-hairline hover:bg-accent-soft hover:border-accent-soft',
  ghost: 'text-ink2 hover:bg-surface-alt hover:text-ink',
}

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 px-sm gap-xs rounded-sm text-caption-medium',
  md: 'h-10 px-lg gap-sm rounded-md text-sub font-medium',
}

export function Button({ variant = 'primary', size = 'md', className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...rest}
    />
  )
}
