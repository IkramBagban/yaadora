import { useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import type { Loop } from '../types'
import { Dialog } from './dialog'
import { Field } from './form'
import {
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from '../loopUtils'

interface ConvertReminderDialogProps {
  loop: Loop
  busy: boolean
  onConfirm: (loop: Loop, dueAt: string | null) => void
  onClose: () => void
}

/**
 * L-4 convert-to-reminder with an adjustable fire time (pre-filled from the
 * loop's due date). The one-click path skips this dialog when the loop
 * already has a due date.
 */
export function ConvertReminderDialog({ loop, busy, onConfirm, onClose }: ConvertReminderDialogProps) {
  const [dueLocal, setDueLocal] = useState(() =>
    toDatetimeLocalValue(loop.dueAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()),
  )
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const dueAt = fromDatetimeLocalValue(dueLocal)
    if (!dueAt) {
      setError('A reminder needs a concrete fire time.')
      return
    }
    onConfirm(loop, dueAt)
  }

  return (
    <Dialog
      title="Convert to reminder"
      subtitle="Creates a one-shot reminder, then closes the loop."
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-lg"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Field label="Remind me about" htmlFor="convert-text">
          <Input id="convert-text" value={loop.title} disabled />
        </Field>

        <Field label="Fire at" htmlFor="convert-due" error={error}>
          <Input
            id="convert-due"
            type="datetime-local"
            autoFocus
            value={dueLocal}
            onChange={(event) => setDueLocal(event.target.value)}
          />
        </Field>

        <div className="flex justify-end gap-sm">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Converting…' : 'Create reminder'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
