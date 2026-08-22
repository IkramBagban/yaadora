import { forwardRef, type InputHTMLAttributes } from 'react'

export type InputProps = InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = '', ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={`h-10 w-full rounded-md border border-hairline bg-surface px-lg text-body text-ink placeholder:text-ink3 focus:border-accent focus:outline-none disabled:opacity-50 ${className}`}
      {...rest}
    />
  )
})
