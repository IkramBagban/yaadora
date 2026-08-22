import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { ApiError } from '../../../api/client'
import { SettingsSection, StatusBanner } from '../ui'
import { rebuildDerivedState } from '../api'
import type { RebuildJob } from '../types'

/**
 * S-5 — danger zone: rebuild derived state from raw memories. Facts,
 * entities and edges are re-derived; raw memories are immutable and never
 * touched. Double confirmation: dialog → type-to-confirm → run.
 */

const CONFIRM_PHRASE = 'REBUILD';

type Step = 'warning' | 'confirm' | null;

function ConfirmDialog({
  step,
  busy,
  onClose,
  onConfirm,
}: {
  step: 'warning' | 'confirm';
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [phrase, setPhrase] = useState('');

  // Reset typed phrase each time the dialog opens.
  useEffect(() => {
    setPhrase('');
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-lg" role="dialog" aria-modal="true" aria-label="Confirm derived-state rebuild">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        disabled={busy}
      />
      <div className="relative w-full max-w-md rounded-lg border border-hairline bg-surface p-xl shadow-xl">
        <h3 className="flex items-center gap-sm text-title font-semibold text-danger">
          <AlertTriangle size={18} />
          Rebuild derived data?
        </h3>

        {step === 'warning' ? (
          <>
            <p className="mt-md text-sub text-ink2">
              Facts, entities, relationships, open loops and digests will be
              rebuilt from your raw memories. Raw memories are immutable and
              are never modified. This can take a while.
            </p>
            <div className="mt-xl flex justify-end gap-sm">
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                className="border-danger/40 text-danger hover:border-danger"
                onClick={onConfirm}
              >
                Continue
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-md text-sub text-ink2">
              Final step — type <strong>{CONFIRM_PHRASE}</strong> to start the
              rebuild.
            </p>
            <input
              autoFocus
              value={phrase}
              disabled={busy}
              onChange={(e) => setPhrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && phrase === CONFIRM_PHRASE) onConfirm();
              }}
              className="mt-md h-10 w-full rounded-md border border-hairline bg-surface px-lg text-body text-ink focus:border-accent focus:outline-none"
              aria-label={`Type ${CONFIRM_PHRASE} to confirm`}
            />
            <div className="mt-xl flex justify-end gap-sm">
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                className="border-danger/40 text-danger hover:border-danger"
                onClick={onConfirm}
                disabled={phrase !== CONFIRM_PHRASE || busy}
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Rebuild now
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function DangerZoneSection() {
  const [dialogStep, setDialogStep] = useState<Step>(null);
  const [job, setJob] = useState<RebuildJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rebuild = useMutation<RebuildJob, Error, void>({
    mutationFn: rebuildDerivedState,
    onSuccess: (accepted) => {
      setJob(accepted);
      setError(null);
      setDialogStep(null);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError && err.status === 404
          ? 'The server doesn\'t expose derived-state rebuild yet. It will appear here once the endpoint ships.'
          : 'Could not start the rebuild. Please try again.',
      );
      setDialogStep(null);
    },
  });

  return (
    <SettingsSection
      id="danger-zone"
      title="Danger zone"
      description="Destructive maintenance operations. They cannot be undone."
      tone="danger"
    >
      <p className="text-sub text-ink2">
        Rebuild all derived state — facts, entities, relationships, open loops
        and digests — from your raw memories. Use this if derived data looks
        wrong or after import changes.
      </p>

      <Button variant="secondary" className="mt-lg" onClick={() => setDialogStep('warning')}>
        Rebuild derived data…
      </Button>

      {rebuild.isPending ? (
        <p className="mt-md flex items-center gap-sm text-caption text-pending" role="status">
          <Loader2 size={14} className="animate-spin" /> Starting rebuild…
        </p>
      ) : null}

      {job ? (
        <StatusBanner kind="success" message={`Rebuild accepted — job ${job.jobId.slice(0, 8)}… is ${job.status}.`} />
      ) : null}

      {error ? (
        <StatusBanner kind="error" message={error} />
      ) : null}

      {dialogStep ? (
        <ConfirmDialog
          step={dialogStep}
          busy={rebuild.isPending}
          onClose={() => (rebuild.isPending ? undefined : setDialogStep(null))}
          onConfirm={() => {
            if (dialogStep === 'warning') setDialogStep('confirm');
            else rebuild.mutate(undefined);
          }}
        />
      ) : null}
    </SettingsSection>
  );
}
