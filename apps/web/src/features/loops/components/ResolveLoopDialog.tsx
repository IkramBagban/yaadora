import { useState } from 'react'
import { Button } from '../../../components/ui/Button'
import type { EvidenceMemory, Loop } from '../types'
import { Dialog } from './dialog'
import { EvidencePicker } from './EvidencePicker'

interface ResolveLoopDialogProps {
  loop: Loop
  busy: boolean
  /** Persist failure message (from the patch mutation) shown inline. */
  error?: string | null
  /** Persist the resolution; `evidence` names the closing memory when picked. */
  onConfirm: (loop: Loop, evidenceId: string | null) => void
  onClose: () => void
}

/**
 * Close a loop, optionally citing the memory that proves it's done
 * ("this memory closes it"). Resolving without evidence stays available for
 * manually planted loops that never had a source memory.
 */
export function ResolveLoopDialog({
  loop,
  busy,
  error,
  onConfirm,
  onClose,
}: ResolveLoopDialogProps) {
  const [evidence, setEvidence] = useState<EvidenceMemory | null>(null)

  return (
    <Dialog
      title="Resolve loop"
      subtitle="Pick the memory that closes it — or close without evidence."
      onClose={onClose}
    >
      <p className="mb-lg rounded-md bg-surface-alt p-sm text-caption text-ink2">
        “{loop.title}”
      </p>

      <EvidencePicker value={evidence?.id ?? null} onChange={setEvidence} />

      {error && <p className="mt-md text-caption text-danger">{error}</p>}

      <div className="mt-lg flex justify-end gap-sm">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => onConfirm(loop, null)}>
          Close without evidence
        </Button>
        <Button disabled={busy || !evidence} onClick={() => onConfirm(loop, evidence!.id)}>
          {busy ? 'Resolving…' : evidence ? 'Resolve with this' : 'Resolve'}
        </Button>
      </div>
    </Dialog>
  )
}
