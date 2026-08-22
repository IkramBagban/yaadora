import { useMemo } from 'react'
import { BellPlus, Plus, SunMoon } from 'lucide-react'
import { navItems, settingsNavItem } from '../../components/layout/navItems'
import { useTheme } from '../../theme/useTheme'
import { COMPOSER_PATHS, usePaletteNavigate } from './navigation'
import type { PaletteItem } from './types'

/**
 * Static palette commands: every sidebar destination plus quick actions.
 * Search-result rows are built separately (see rows.ts); this hook only
 * owns commands that exist without any query.
 */
export function usePaletteCommands(): PaletteItem[] {
  const navigate = usePaletteNavigate()
  const { cycleMode, resolved } = useTheme()

  return useMemo(() => {
    const navCommands: PaletteItem[] = [...navItems, settingsNavItem].map((item) => ({
      id: `nav:${item.to}`,
      groupId: 'navigate',
      label: item.label,
      icon: item.icon,
      href: item.to,
      select: () => navigate(item.to),
    }))

    const actionCommands: PaletteItem[] = [
      {
        id: 'action:new-memory',
        groupId: 'actions',
        label: 'New memory',
        detail: 'Capture something to remember',
        icon: Plus,
        href: COMPOSER_PATHS.newMemory,
        select: () => navigate(COMPOSER_PATHS.newMemory),
      },
      {
        id: 'action:new-reminder',
        groupId: 'actions',
        label: 'New reminder',
        detail: 'Schedule a follow-up',
        icon: BellPlus,
        href: COMPOSER_PATHS.newReminder,
        select: () => navigate(COMPOSER_PATHS.newReminder),
      },
      {
        id: 'action:toggle-theme',
        groupId: 'actions',
        label: 'Toggle theme',
        detail: `Switch light / dark / system — now ${resolved}`,
        icon: SunMoon,
        select: () => cycleMode(),
      },
    ]

    return [...actionCommands, ...navCommands]
  }, [navigate, cycleMode, resolved])
}
