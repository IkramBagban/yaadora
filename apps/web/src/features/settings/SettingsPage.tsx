import { Settings } from 'lucide-react'
import { DangerZoneSection } from './sections/DangerZoneSection'
import { DevicesSection } from './sections/DevicesSection'
import { ExportSection } from './sections/ExportSection'
import { PrivacySection } from './sections/PrivacySection'
import { ThemeSection } from './sections/ThemeSection'

const SECTION_LINKS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'export', label: 'Your data' },
  { id: 'devices', label: 'Devices' },
  { id: 'danger-zone', label: 'Danger zone' },
] as const;

/** S-1 — settings shell: routed page with per-section nav. Sections own
 * their data; the dirty-state guard lives in the privacy form. */
export function SettingsPage() {
  return (
    <div className="flex flex-col gap-xl">
      <header className="flex items-center gap-md">
        <span className="inline-flex size-10 items-center justify-center rounded-md bg-accent-soft text-accent">
          <Settings size={20} />
        </span>
        <div>
          <h1 className="text-display font-bold tracking-tight">Settings</h1>
          <p className="text-sub text-ink2">
            Privacy, appearance and data ownership — reshape your memory without
            asking anyone for help.
          </p>
        </div>
      </header>

      <nav aria-label="Settings sections" className="flex flex-wrap gap-sm">
        {SECTION_LINKS.map((link) => (
          <a
            key={link.id}
            href={`#${link.id}`}
            className="rounded-pill border border-hairline bg-surface px-md py-1 text-caption-medium text-ink2 transition-colors hover:border-accent hover:text-accent"
          >
            {link.label}
          </a>
        ))}
      </nav>

      <ThemeSection />
      <PrivacySection />
      <ExportSection />
      <DevicesSection />
      <DangerZoneSection />
    </div>
  )
}
