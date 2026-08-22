import { Menu, Search } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'
import { Button } from '../ui/Button'

interface TopbarProps {
  onMenuClick: () => void
}

export function Topbar({ onMenuClick }: TopbarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-sm border-b border-hairline bg-surface px-lg">
      <Button variant="ghost" size="sm" className="md:hidden" aria-label="Open navigation" onClick={onMenuClick}>
        <Menu size={18} />
      </Button>
      <div className="relative w-full max-w-md">
        <Search size={16} className="pointer-events-none absolute left-md top-1/2 -translate-y-1/2 text-ink3" />
        <input
          type="search"
          placeholder="Search your memories…"
          aria-label="Search"
          className="h-9 w-full rounded-pill border border-hairline bg-surface-alt pl-xxl pr-lg text-sub text-ink placeholder:text-ink3 focus:border-accent focus:bg-surface focus:outline-none"
        />
      </div>
      <div className="ml-auto flex items-center gap-xs">
        <ThemeToggle />
      </div>
    </header>
  )
}
