import { useState } from 'react'
import { Outlet } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false)

  return (
    <div className="min-h-screen bg-bg text-ink">
      <aside className="fixed inset-y-0 left-0 z-30 hidden md:block">
        <Sidebar />
      </aside>

      {navOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/40"
            onClick={() => setNavOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex flex-col shadow-xl">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setNavOpen(false)}
              className="absolute right-md top-3.5 z-10 text-ink2 hover:text-ink"
            >
              <X size={18} />
            </button>
            <Sidebar onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-h-screen flex-col md:pl-60">
        <Topbar onMenuClick={() => setNavOpen(true)} />
        <main className="mx-auto w-full max-w-5xl flex-1 px-lg py-xl md:px-xxl md:py-xxl">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
