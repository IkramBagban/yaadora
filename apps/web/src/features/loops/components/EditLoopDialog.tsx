import { useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { STATUS_LABELS } from '../loopUtils'
import { LOOP_STATUSES, type Loop, type LoopStatus } from '../types'
import { Dialog } from './dialog'
import { Field } from './form'
import {
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from '../loopUtils'

interface EditLoopDialogProps {
  loop: Loop
  busy: boolean
  /** Persist only the fields the user actually changed. */
  onSave: (
    loop: Loop,
    patch: { title?: string; dueAt?: string | null; status?: LoopStatus },
  ) => void
  onClose: () => void
}

/**
 * L-6 loop detail/edit: click a card to adjust title / due date / lifecycle
 * status. Title stays required; clearing the due date is explicit via the
 * "clear" checkbox.
 */
export function EditLoopDialog({ loop, busy, onSave, onClose }: EditLoopDialogProps) {
  const [title, setTitle] = useState(loop.title)
  const [titleError, setTitleError] = useState<string | null>(null)
  const [hasDue, setHasDue] = useState(loop.dueAt !== null)
  const [dueLocal, setDueLocal] = useState(() => toDatetimeLocalValue(loop.dueAt))
  const [status, setStatus] = useState<LoopStatus>(loop.status)

  const submit = () => {
    const trimmed = title.trim()
    if (!trimmed) {
      setTitleError('Title is required.')
      return
    }

    let dueAt: string | null | undefined
    if (!hasDue && loop.dueAt !== null) dueAt = null
    if (hasDue) {
      const nextDue = fromDatetimeLocalValue(dueLocal)
      if (nextDue !== loop.dueAt) dueAt = nextDue
    }

    const patch: { title?: string; dueAt?: string | null; status?: LoopStatus } = {}
    if (trimmed !== loop.title) patch.title = trimmed
    if (dueAt !== undefined) patch.dueAt = dueAt
    if (status !== loop.status) patch.status = status

    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }
    onSave(loop, patch)
  }

  return (
    <Dialog title="Edit loop" onClose={onClose}>
      <form
        className="flex flex-col gap-lg"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Field label="Title" htmlFor="edit-title" error={titleError}>
          <Input
            id="edit-title"
            autoFocus
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              if (titleError) setTitleError(null)
            }}
          />
        </Field>

        <Field label="Status" htmlFor="edit-status">
          <select
            id="edit-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as LoopStatus)}
            className="h-10 w-full rounded-md border border-hairline bg-surface px-lg text-body text-ink focus:border-accent focus:outline-none"
          >
            {LOOP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex flex-col gap-xs">
          <label className="flex items-center gap-sm text-caption-medium text-ink2">
            <input
              type="checkbox"
              checked={hasDue}
              onChange={(event) => setHasDue(event.target.checked)}
              className="accent-[var(--c-accent)]"
            />
            Has a due date
          </label>
          {hasDue && (
            <Input
              aria-label="Due date"
              type="datetime-local"
              value={dueLocal}
              onChange={(event) => setDueLocal(event.target.value)}
            />
          )}
        </div>

        <div className="flex justify-end gap-sm">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
