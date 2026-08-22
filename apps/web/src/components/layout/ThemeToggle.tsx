import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../../theme/useTheme'

export function ThemeToggle() {
  const { mode, resolved, cycleMode } = useTheme()
  const label = `Theme: ${mode}`

  return (
    <button
      type="button"
      onClick={cycleMode}
      aria-label={label}
      title={label}
      className="inline-flex size-9 items-center justify-center rounded-md text-ink2 transition-colors hover:bg-surface-alt hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {resolved === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  )
}
