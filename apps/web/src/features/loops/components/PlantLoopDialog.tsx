import { useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { LOOP_KINDS, type Loop, type PlantableKind } from '../types'
import { useCreateLoop } from '../useLoops'
import { Dialog } from './dialog'
import { Field } from './form'
import { fromDatetimeLocalValue } from '../loopUtils'

interface PlantLoopDialogProps {
  onClose: () => void
  onPlanted: (loop: Loop) => void
}

/**
 * L-5 manual planting: a goal/commitment the user adds themselves (not just
 * AI-detected ones). Provenance is the user's action server-side
 * (`sourceMemory` stays null). Goes through the invalidating mutation so the
 * board picks the new loop up immediately.
 */
export function PlantLoopDialog({ onClose, onPlanted }: PlantLoopDialogProps) {
  const createLoop = useCreateLoop()
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<PlantableKind>('goal')
  const [dueLocal, setDueLocal] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const trimmed = title.trim()
    if (!trimmed) {
      setError('Title is required.')
      return
    }
    try {
      const dueAt = fromDatetimeLocalValue(dueLocal) ?? undefined
      const loop = await createLoop.mutateAsync({ title: trimmed, kind, dueAt })
      onPlanted(loop)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this loop.')
    }
  }

  return (
    <Dialog
      title="Plant a loop"
      subtitle="Commit to something unfinished — it joins the board as open."
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-lg"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Field label="What needs closing?" htmlFor="loop-title" error={error}>
          <Input
            id="loop-title"
            autoFocus
            value={title}
            placeholder="e.g. Agree equity split with Rahul"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>

        <Field label="Kind" htmlFor="loop-kind" hint="Drives the swim-lane grouping.">
          <select
            id="loop-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as PlantableKind)}
            className="h-10 w-full rounded-md border border-hairline bg-surface px-lg text-body text-ink focus:border-accent focus:outline-none"
          >
            {LOOP_KINDS.map((k) => (
              <option key={k} value={k}>
                {k.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Due (optional)" htmlFor="loop-due">
          <Input
            id="loop-due"
            type="datetime-local"
            value={dueLocal}
            onChange={(event) => setDueLocal(event.target.value)}
          />
        </Field>

        <div className="flex justify-end gap-sm">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={createLoop.isPending}>
            {createLoop.isPending ? 'Planting…' : 'Plant loop'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
