import {
  CalendarClock,
  CircleHelp,
  Compass,
  Lightbulb,
  ListChecks,
  Network,
  ScrollText,
  Share2,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

export const navItems: NavItem[] = [
  { to: '/', label: 'Overview', icon: Compass },
  { to: '/timeline', label: 'Timeline', icon: CalendarClock },
  { to: '/graph', label: 'Graph', icon: Network },
  { to: '/entities', label: 'Entities', icon: Users },
  { to: '/facts', label: 'Facts', icon: Share2 },
  { to: '/loops', label: 'Loops', icon: CircleHelp },
  { to: '/rules', label: 'Rules', icon: ShieldCheck },
  { to: '/ask', label: 'Ask', icon: Sparkles },
  { to: '/reminders', label: 'Reminders', icon: ListChecks },
  { to: '/insights', label: 'Insights', icon: Lightbulb },
]

export const settingsNavItem: NavItem = {
  to: '/settings',
  label: 'Settings',
  icon: ScrollText,
}
