import { useEffect, useState } from 'react'
import { onCloseRequest, onOpenRequest, onToggleRequest } from './paletteBus'
import { usePaletteHotkey } from './usePaletteHotkey'
import { PaletteDialog } from './PaletteDialog'

/**
 * Global cmd-K palette shell (P-8) and unified search entry point (P-9).
 * Mounted once in AppShell. Owns only open/close: the toggling ⌘K / Ctrl+K
 * hotkey, bus requests (`openPalette()` / `closePalette()`), and conditional
 * mounting of the dialog so each open starts with a fresh query and cursor.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)

  usePaletteHotkey()

  useEffect(() => onOpenRequest(() => setOpen(true)), [])
  useEffect(() => onCloseRequest(() => setOpen(false)), [])
  useEffect(() => onToggleRequest(() => setOpen((value) => !value)), [])

  if (!open) return null
  return <PaletteDialog />
}
