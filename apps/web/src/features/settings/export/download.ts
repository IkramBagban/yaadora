/** Trigger a client-side file download for generated export content. */
export function downloadTextFile(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** `yaadora-export-2026-08-22` style stem for export filenames. */
export function exportFileStem(now = new Date()): string {
  const iso = now.toISOString().slice(0, 10)
  return `yaadora-export-${iso}`
}
