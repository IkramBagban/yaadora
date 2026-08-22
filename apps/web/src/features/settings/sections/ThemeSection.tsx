import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from '../../../theme/useTheme'
import { SegmentedControl, SettingsSection } from '../ui'
import type { ThemeMode } from '../../../theme/types'

const MODE_OPTIONS = [
  { value: 'light' as const, label: 'Light', icon: <Sun size={14} /> },
  { value: 'dark' as const, label: 'Dark', icon: <Moon size={14} /> },
  { value: 'system' as const, label: 'System', icon: <Monitor size={14} /> },
]

/** S-6 — light/dark/system selector on the ported mobile tokens.
 * Persistence lives in `ThemeProvider` (localStorage). */
export function ThemeSection() {
  const { mode, setMode } = useTheme()

  return (
    <SettingsSection
      id="appearance"
      title="Appearance"
      description="Matches your mobile app — light and dark are both first-class."
    >
      <SegmentedControl<ThemeMode>
        ariaLabel="Theme mode"
        value={mode}
        options={MODE_OPTIONS}
        onChange={setMode}
      />
    </SettingsSection>
  )
}
