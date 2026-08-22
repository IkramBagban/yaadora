import { useEffect } from 'react'
import { togglePalette } from './paletteBus'

/**
 * Global ⌘K / Ctrl+K hotkey. Rendered once by <CommandPalette> inside
 * AppShell so the shortcut works on every page, palette mounted or not.
 * ⌘K toggles: pressed again while open, it closes.
 */
export function usePaletteHotkey(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      togglePalette()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
