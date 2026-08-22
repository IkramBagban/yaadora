import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import {
  SegmentedControl,
  SettingsSection,
  StatusBanner,
} from '../ui'
import type { ExportFormat } from '../types'
import { collectAccountExport } from '../export/exportClient'
import { downloadTextFile, exportFileStem } from '../export/download'
import { buildMarkdownJournal } from '../export/markdown'

const FORMAT_OPTIONS = [
  { value: 'json' as const, label: 'JSON (everything)' },
  { value: 'markdown' as const, label: 'Markdown journal' },
]

/** S-3 — account data export. Runs fully client-side over existing read
 * endpoints; progress is reported per collection phase. */
export function ExportSection() {
  const [format, setFormat] = useState<ExportFormat>('json')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleExport(): Promise<void> {
    setRunning(true)
    setError(null)
    setProgress('Preparing export…')
    try {
      const data = await collectAccountExport(setProgress)
      if (format === 'json') {
        downloadTextFile(
          `${exportFileStem()}.json`,
          'application/json',
          JSON.stringify(data, null, 2),
        )
      } else {
        downloadTextFile(
          `${exportFileStem()}.md`,
          'text/markdown',
          buildMarkdownJournal(data),
        )
      }
    } catch (err) {
      // Surface abort reasons (e.g. non-terminating pagination) verbatim.
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Export failed. Please try again.',
      )
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  return (
    <SettingsSection
      id="export"
      title="Your data"
      description="Download everything yaadora knows about you — no questions asked."
    >
      <div className="flex flex-col gap-lg">
        <SegmentedControl<ExportFormat>
          ariaLabel="Export format"
          value={format}
          options={FORMAT_OPTIONS}
          onChange={setFormat}
        />

        <div className="flex items-center gap-md">
          <Button onClick={() => void handleExport()} disabled={running}>
            {running ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Download size={16} />
            )}
            Export
          </Button>
          {running && progress ? (
            <p aria-live="polite" className="text-caption text-ink2">
              {progress}
            </p>
          ) : null}
        </div>

        {error ? <StatusBanner kind="error" message={error} /> : null}

        <p className="text-micro text-ink3">
          JSON includes your profile, privacy settings, memories, facts,
          entities, open loops, reminders, rules and digests. The Markdown
          journal renders memories as a dated diary.
        </p>
      </div>
    </SettingsSection>
  )
}
