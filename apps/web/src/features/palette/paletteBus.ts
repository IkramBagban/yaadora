/**
 * Open/close bus for the palette, decoupled from React tree shape: anything
 * (hotkey hook, future Topbar button) can request open/close without prop
 * drilling through AppShell. Implemented with window CustomEvents so the
 * feature stays self-contained.
 */
const OPEN_EVENT = 'yaadora:palette-open'
const CLOSE_EVENT = 'yaadora:palette-close'
const TOGGLE_EVENT = 'yaadora:palette-toggle'

type Listener = () => void

function emit(name: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(name))
}

export function openPalette(): void {
  emit(OPEN_EVENT)
}

export function closePalette(): void {
  emit(CLOSE_EVENT)
}

export function togglePalette(): void {
  emit(TOGGLE_EVENT)
}

function subscribe(names: string[], listener: Listener): () => void {
  if (typeof window === 'undefined') return () => undefined
  for (const name of names) window.addEventListener(name, listener)
  return () => {
    for (const name of names) window.removeEventListener(name, listener)
  }
}

/** Subscribe to open requests. Returns an unsubscribe function. */
export function onOpenRequest(listener: Listener): () => void {
  return subscribe([OPEN_EVENT], listener)
}

/** Subscribe to close requests. Returns an unsubscribe function. */
export function onCloseRequest(listener: Listener): () => void {
  return subscribe([CLOSE_EVENT], listener)
}

/** Subscribe to toggle requests. Returns an unsubscribe function. */
export function onToggleRequest(listener: Listener): () => void {
  return subscribe([TOGGLE_EVENT], listener)
}
