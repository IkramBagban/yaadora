import type { ReactNode } from 'react'

interface FieldProps {
  label: string
  htmlFor?: string
  error?: string | null
  hint?: string
  children: ReactNode
}

/** Labeled form row with inline validation message. */
export function Field({ label, htmlFor, error, hint, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-xs">
      <label htmlFor={htmlFor} className="text-caption-medium text-ink2">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-caption text-danger">{error}</p>
      ) : hint ? (
        <p className="text-caption text-ink3">{hint}</p>
      ) : null}
    </div>
  )
}

