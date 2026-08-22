import type { ReactNode } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import { cn } from '../../lib/cn'

/** Local building blocks shared by the settings sections. Feature-scoped on
 * purpose — shared-infra (`components/ui`) is frozen for this track. */

export function SettingsSection({
  id,
  title,
  description,
  tone = 'default',
  children,
}: {
  id: string
  title: string
  description?: string
  tone?: 'default' | 'danger'
  children: ReactNode
}) {
  return (
    <section
      id={id}
      className="scroll-mt-20 rounded-lg border border-hairline bg-surface"
    >
      <header className="border-b border-hairline px-xl py-lg">
        <h2
          className={cn(
            'text-title font-semibold',
            tone === 'danger' && 'text-danger',
          )}
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-xs text-caption text-ink2">{description}</p>
        ) : null}
      </header>
      <div className="px-xl py-lg">{children}</div>
    </section>
  )
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-xs">
      <label htmlFor={htmlFor} className="text-caption-medium text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="text-micro text-ink3">{hint}</p> : null}
    </div>
  )
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50',
        checked ? 'border-accent bg-accent' : 'border-hairline bg-surface-alt',
      )}
    >
      <span
        className={cn(
          'inline-block size-4 rounded-pill bg-surface transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string; icon?: ReactNode }>
  onChange: (next: T) => void
  ariaLabel: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border border-hairline bg-surface-alt p-0.5"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'inline-flex items-center gap-xs rounded-sm px-md py-1.5 text-caption-medium transition-colors',
            value === opt.value
              ? 'bg-surface text-ink shadow-xs'
              : 'text-ink2 hover:text-ink',
          )}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function StatusBanner({ kind, message }: { kind: 'success' | 'error'; message: string }) {
  return (
    <p
      role={kind === 'success' ? 'status' : 'alert'}
      className={cn(
        'flex items-start gap-sm rounded-md px-md py-sm text-caption',
        kind === 'success'
          ? 'bg-accent-soft text-success'
          : 'bg-accent-soft text-danger',
      )}
    >
      {kind === 'success' ? (
        <Check size={14} className="mt-0.5 shrink-0" />
      ) : (
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      )}
      <span>{message}</span>
    </p>
  )
}
