import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createMemory, memoryKeys } from '../../api/memories';
import type { Memory } from '../../api/types';
import {
  patchMemoryInList,
  prependMemoryToList,
  removeMemoryFromList,
} from './cache';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { AlertCircle } from 'lucide-react';

/** Wait before refreshing the list so the worker can flip pending →
 *  processed/failed; the row badge updates in place. */
const STATUS_REFRESH_DELAY_MS = 4000;

interface QuickCaptureProps {
  onCaptured: (id: string) => void;
}

/** Pinned composer. Enter or ⌘Enter submits; Shift+Enter makes a newline.
 *  Each draft carries a fresh clientId, so replaying a failed submit hits
 *  the server's idempotency key instead of duplicating the capture. */
export function QuickCapture({ onCaptured }: QuickCaptureProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const clientIdRef = useRef(crypto.randomUUID());
  const qc = useQueryClient();

  const capture = useMutation({
    mutationFn: (rawText: string) =>
      createMemory({ rawText, source: 'manual', clientId: clientIdRef.current }),
    onMutate: (rawText) => {
      setError(null);
      // Optimistic prepend: a pending row lands above the feed immediately.
      const optimistic: Memory = {
        id: `temp-${clientIdRef.current}`,
        userId: '',
        rawText,
        occurredAt: null,
        createdAt: new Date().toISOString(),
        source: 'manual',
        status: 'pending',
        pinned: false,
      };
      prependMemoryToList(qc, optimistic);
    },
    onSuccess: (created) => {
      patchMemoryInList(qc, `temp-${clientIdRef.current}`, {
        id: created.id,
        status: created.status,
        createdAt: created.createdAt,
      });
      onCaptured(created.id);
      clientIdRef.current = crypto.randomUUID();
      window.setTimeout(() => {
        void qc.invalidateQueries({ queryKey: memoryKeys.list });
      }, STATUS_REFRESH_DELAY_MS);
    },
    onError: (err, rawText) => {
      removeMemoryFromList(qc, `temp-${clientIdRef.current}`);
      setDraft(rawText);
      setError(err instanceof Error ? err.message : 'Capture failed.');
    },
  });

  const submit = () => {
    const text = draft.trim();
    if (!text || capture.isPending) return;
    setDraft('');
    capture.mutate(text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (!e.shiftKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section aria-label="Quick capture" className="shrink-0">
      <div className="rounded-lg border border-hairline bg-surface-alt/60 p-md focus-within:border-accent">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Capture a thought, moment, or plan…"
          aria-label="New memory"
          className="w-full resize-none bg-transparent text-body text-ink placeholder:text-ink3 focus:outline-none"
        />
        <div className="mt-xs flex items-center justify-between">
          <span className="text-caption text-ink3">
            {capture.isPending ? 'Saving…' : 'Enter to capture · Shift+Enter for a new line'}
          </span>
          <Button size="sm" onClick={submit} disabled={!draft.trim() || capture.isPending}>
            {capture.isPending ? <Spinner size={14} /> : null}
            Capture
          </Button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-xs flex items-center gap-sm rounded-md border border-danger/30 bg-accent-soft px-md py-sm text-caption text-danger"
        >
          <AlertCircle size={14} aria-hidden />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              submit();
            }}
            className="cursor-pointer font-medium underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      )}
    </section>
  );
}
