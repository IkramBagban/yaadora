import { Link } from '@tanstack/react-router'
import { navItems, settingsNavItem } from './navItems'
import { cn } from '../../lib/cn'

interface SidebarProps {
  onNavigate?: () => void
}

const linkClasses =
  'flex items-center gap-sm rounded-md px-md py-sm text-sub text-ink2 transition-colors hover:bg-surface-alt hover:text-ink data-[status=active]:bg-accent-soft data-[status=active]:text-accent'

export function Sidebar({ onNavigate }: SidebarProps) {
  return (
    <nav aria-label="Primary" className="flex h-full w-60 flex-col border-r border-hairline bg-surface">
      <div className="flex h-14 shrink-0 items-center gap-sm border-b border-hairline px-lg">
        <span className="flex size-7 items-center justify-center rounded-sm bg-accent font-bold text-on-accent">y</span>
        <span className="text-title font-semibold tracking-tight">yaadora</span>
      </div>
      <ul className="flex flex-1 flex-col gap-xs overflow-y-auto p-sm">
        {navItems.map((item) => (
          <li key={item.to}>
            <Link to={item.to} onClick={onNavigate} className={cn(linkClasses, 'active:text-accent')}>
              <item.icon size={16} strokeWidth={2} />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="border-t border-hairline p-sm">
        <Link to={settingsNavItem.to} onClick={onNavigate} className={linkClasses}>
          <settingsNavItem.icon size={16} strokeWidth={2} />
          {settingsNavItem.label}
        </Link>
      </div>
    </nav>
  )
}
