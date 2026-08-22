import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMemoryDetail, memoryKeys } from '../../api/memories';
import type { Memory } from '../../api/types';
import { formatDateTime } from '../../lib/time';
import { isInFlight } from './filters';
import { EntityChip } from './EntityChips';
import { DetailSkeleton } from './Skeletons';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { AlertCircle, Star, X } from 'lucide-react';

interface MemoryDetailPanelProps {
  memoryId: string | null;
  onClose: () => void;
  onTogglePin: (memory: Memory) => void;
}

/** Slide-over showing one capture with everything derived from it.
 *  Polls while ingestion is in flight so derived sections fill themselves in. */
export function MemoryDetailPanel({ memoryId, onClose, onTogglePin }: MemoryDetailPanelProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: memoryKeys.detail(memoryId ?? ''),
    queryFn: () => getMemoryDetail(memoryId as string),
    enabled: memoryId !== null,
    refetchInterval: (query) =>
      query.state.data && isInFlight(query.state.data.memory) ? 2500 : false,
  });

  useEffect(() => {
    if (!memoryId) return;
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [memoryId, onClose]);

  if (memoryId === null) return null;

  const memory = data?.memory;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Memory detail">
      <button
        type="button"
        aria-label="Close detail"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-hairline bg-bg shadow-xl">
        <header className="flex shrink-0 items-center gap-sm border-b border-hairline px-xl py-md">
          <h2 className="text-title font-semibold text-ink">Memory</h2>
          {memory && (
            <button
              type="button"
              onClick={() => onTogglePin(memory)}
              aria-pressed={memory.pinned}
              aria-label={memory.pinned ? 'Unpin memory' : 'Pin memory'}
              className="cursor-pointer rounded-sm p-xs text-ink3 transition-colors hover:bg-surface-alt hover:text-ink"
            >
              <Star
                size={16}
                aria-hidden
                className={memory.pinned ? 'fill-accent text-accent' : undefined}
              />
            </button>
          )}
          <button
            ref={closeRef}
            type="button"
            aria-label="Close detail"
            onClick={onClose}
            className="ml-auto cursor-pointer rounded-sm p-xs text-ink2 transition-colors hover:bg-surface-alt hover:text-ink"
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-xl py-lg">
          {isPending ? (
            <DetailSkeleton />
          ) : isError || !data ? (
            <div role="alert" className="flex flex-col items-center gap-md py-xxl text-center">
              <AlertCircle size={20} className="text-danger" aria-hidden />
              <p className="text-sub text-ink2">Could not load this memory.</p>
              <Button variant="secondary" size="sm" onClick={() => void refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <DetailBody detail={data} />
          )}
        </div>
      </aside>
    </div>
  );
}

type Detail = NonNullable<Awaited<ReturnType<typeof getMemoryDetail>>>;

function DetailBody({ detail }: { detail: Detail }) {
  const { memory } = detail;

  return (
    <div className="flex flex-col gap-xl">
      {isInFlight(memory) && (
        <p className="flex items-center gap-sm rounded-md border border-hairline bg-surface-alt px-md py-sm text-caption text-ink2">
          <Spinner size={14} className="text-pending" />
          Processing — derived facts, entities, loops and rules appear here once
          ingestion completes.
        </p>
      )}
      {memory.status === 'failed' && (
        <p className="flex items-center gap-sm rounded-md border border-danger/30 bg-accent-soft px-md py-sm text-caption text-danger">
          <AlertCircle size={14} aria-hidden />
          Ingestion failed for this capture. The raw text is stored and will not
          be lost.
        </p>
      )}

      <p className="whitespace-pre-wrap text-body text-ink">{memory.rawText}</p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-lg gap-y-xs text-caption">
        <dt className="text-ink3">Captured</dt>
        <dd className="text-ink2">{formatDateTime(memory.createdAt)}</dd>
        <dt className="text-ink3">Occurred</dt>
        <dd className="text-ink2">
          {memory.occurredAt
            ? formatDateTime(memory.occurredAt)
            : 'Not resolved yet'}
        </dd>
        <dt className="text-ink3">Source</dt>
        <dd className="text-ink2 capitalize">{memory.source}</dd>
        <dt className="text-ink3">Status</dt>
        <dd>
          <Badge
            tone={
              memory.status === 'failed'
                ? 'danger'
                : isInFlight(memory)
                  ? 'pending'
                  : 'success'
            }
          >
            {memory.status}
          </Badge>
        </dd>
      </dl>

      {detail.entities.length > 0 && (
        <Section title="Entities">
          <div className="flex flex-wrap gap-sm">
            {detail.entities.map((e) => (
              <EntityChip key={e.id} entity={e} />
            ))}
          </div>
        </Section>
      )}

      {detail.facts.length > 0 && (
        <Section title={`Facts (${detail.facts.length})`}>
          <ul className="flex flex-col gap-sm">
            {detail.facts.map((f) => (
              <li
                key={f.id}
                className="rounded-md border border-hairline bg-surface px-md py-sm"
              >
                <p className="text-body text-ink">{f.factText}</p>
                <p className="mt-xs text-caption text-ink3">
                  {f.confidence !== null && `${Math.round(f.confidence * 100)}% confidence`}
                  {f.confidence !== null && f.factType ? ' · ' : ''}
                  {f.factType ?? ''}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {detail.openLoops.length > 0 && (
        <Section title={`Open loops (${detail.openLoops.length})`}>
          <ul className="flex flex-col gap-sm">
            {detail.openLoops.map((l) => (
              <li
                key={l.id}
                className="rounded-md border border-hairline bg-surface px-md py-sm"
              >
                <p className="text-body text-ink">{l.title}</p>
                <p className="mt-xs text-caption text-ink3">
                  {l.kind}
                  {l.dueAt ? ` · due ${formatDateTime(l.dueAt)}` : ''}
                  {' · '}
                  {l.status}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {detail.reminders.length > 0 && (
        <Section title={`Reminders (${detail.reminders.length})`}>
          <ul className="flex flex-col gap-sm">
            {detail.reminders.map((r) => (
              <li
                key={r.id}
                className="rounded-md border border-hairline bg-surface px-md py-sm"
              >
                <p className="text-body text-ink">{r.text}</p>
                <p className="mt-xs text-caption text-ink3">
                  {r.dueAt ? `due ${formatDateTime(r.dueAt)}` : 'no due date'}
                  {' · '}
                  {r.status}
                  {' · '}
                  {r.origin}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {detail.rules.length > 0 && (
        <Section title={`Rules (${detail.rules.length})`}>
          <ul className="flex flex-col gap-sm">
            {detail.rules.map((r) => (
              <li
                key={r.id}
                className="rounded-md border border-hairline bg-surface px-md py-sm"
              >
                <p className="text-body text-ink">{r.ruleText}</p>
                <p className="mt-xs flex items-center gap-sm text-caption text-ink3">
                  {r.triggerText ? `when “${r.triggerText}”` : 'no trigger text'}
                  {r.active ? <Badge tone="success">active</Badge> : <Badge tone="neutral">inactive</Badge>}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!isInFlight(memory) &&
        detail.facts.length === 0 &&
        detail.entities.length === 0 &&
        detail.openLoops.length === 0 &&
        detail.reminders.length === 0 &&
        detail.rules.length === 0 && (
          <p className="text-caption text-ink3">
            Nothing was derived from this capture.
          </p>
        )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-sm text-caption-medium uppercase tracking-wide text-ink2">
        {title}
      </h3>
      {children}
    </section>
  );
}
