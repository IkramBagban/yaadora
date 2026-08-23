import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { Gauge, HeartPulse, TrendingUp, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AdminOnlyNotice, GateShell, tabLinkClasses } from '../features/admin/ui'
import { useMe } from '../features/admin/api'
import { isForbidden } from '../features/admin/lib'

/**
 * /admin section shell: sidebar-tab navigation (Overview · Users · Activity &
 * Retention · Engine Health) behind a role gate. The gate renders until GET
 * /me confirms `role === 'admin'`; anything else — including a 403 or a /me
 * response that doesn't carry the role yet — shows "Admins only".
 */

interface SectionTab {
  to: '/admin' | '/admin/users' | '/admin/activity' | '/admin/engine'
  label: string
  icon: LucideIcon
}

const SECTION_TABS: SectionTab[] = [
  { to: '/admin', label: 'Overview', icon: Gauge },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/activity', label: 'Activity & Retention', icon: TrendingUp },
  { to: '/admin/engine', label: 'Engine Health', icon: HeartPulse },
]

export const Route = createFileRoute('/admin')({
  component: function AdminLayout() {
    const { me, isAdmin } = useMe()

    if (me.isPending) {
      return (
        <GateShell>
          <span className="size-6 animate-pulse rounded-pill bg-surface-alt" aria-hidden="true" />
          <p className="text-caption text-ink2">Checking access…</p>
        </GateShell>
      )
    }

    if (me.isError && !isForbidden(me.error)) {
      return (
        <GateShell>
          <p className="text-sub text-ink2">Couldn't verify your account.</p>
          <button
            type="button"
            onClick={() => void me.refetch()}
            className="rounded-pill border border-hairline px-md py-1 text-micro uppercase text-ink2 transition-colors hover:border-accent hover:text-ink"
          >
            Retry
          </button>
        </GateShell>
      )
    }

    if (!isAdmin) {
      return (
        <GateShell>
          <AdminOnlyNotice />
        </GateShell>
      )
    }

    return (
      <div className="flex flex-col gap-xl pb-xl">
        <header className="flex items-center gap-sm">
          <span className="flex size-7 items-center justify-center rounded-sm bg-accent font-bold text-on-accent">
            A
          </span>
          <h1 className="text-display font-bold tracking-tight">Admin</h1>
        </header>

        <nav aria-label="Admin sections" className="flex flex-wrap gap-xs">
          {SECTION_TABS.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              activeOptions={{ exact: tab.to === '/admin' }}
              className={tabLinkClasses}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        <Outlet />
      </div>
    )
  },
})
