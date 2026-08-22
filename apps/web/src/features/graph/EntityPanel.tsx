import { useQuery } from '@tanstack/react-query';
import { Crosshair, X } from 'lucide-react';
import { fetchEntityContext } from '../../api/graph';
import type { GraphSnapshotEntity } from '../../api/types';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { formatDate, formatRelative } from '../../lib/format';
import { typeColorVar, typeLabel } from './graphModel';

export interface EntityPanelProps {
  entityId: string;
  /** Snapshot copy of the same entity, for an instant header while context loads. */
  snapshotEntity: GraphSnapshotEntity | undefined;
  focused: boolean;
  onClose: () => void;
  onFocus: () => void;
  onClearFocus: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-hairline px-lg py-md first:border-t-0">
      <h4 className="mb-sm text-micro uppercase tracking-wider text-ink3">{title}</h4>
      {children}
    </section>
  );
}

export function EntityPanel({
  entityId,
  snapshotEntity,
  focused,
  onClose,
  onFocus,
  onClearFocus,
}: EntityPanelProps) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['entity-context', entityId],
    queryFn: () => fetchEntityContext(entityId),
    staleTime: 60_000,
  });

  const name = data?.entity.canonicalName ?? snapshotEntity?.canonicalName ?? 'Entity';
  const type = data?.entity.type ?? snapshotEntity?.type ?? 'other';

  return (
    <div className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l border-hairline bg-surface xl:w-96">
      <header className="flex items-start gap-md px-lg py-md">
        <span
          aria-hidden
          className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-caption font-semibold"
          style={{ backgroundColor: typeColorVar(type), color: 'var(--g-on)' }}
        >
          {[...name].slice(0, 2).join('').toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-title font-semibold">{name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-xs">
            <Badge tone="neutral">{typeLabel(type)}</Badge>
            {snapshotEntity && (
              <span className="text-caption text-ink3">
                {snapshotEntity.mentionCount} mentions
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          className="rounded-sm p-xs text-ink2 hover:bg-surface-alt hover:text-ink"
        >
          <X size={16} />
        </button>
      </header>

      {focused ? (
        <div className="px-lg pb-md">
          <Button size="sm" variant="secondary" className="w-full" onClick={onClearFocus}>
            Show full graph
          </Button>
        </div>
      ) : (
        <div className="px-lg pb-md">
          <Button size="sm" className="w-full" onClick={onFocus}>
            <Crosshair size={14} /> Focus on neighborhood
          </Button>
        </div>
      )}

      {isPending && (
        <div className="flex items-center justify-center gap-sm px-lg py-xl text-sub text-ink2">
          <Spinner size={16} /> Loading context…
        </div>
      )}

      {isError && (
        <div className="px-lg py-xl text-sub text-danger">
          Couldn't load this entity's context.
          <Button size="sm" variant="ghost" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      )}

      {data && (
        <>
          {data.profile && (
            <Section title="Profile">
              <p className="text-sub text-ink2">{data.profile}</p>
            </Section>
          )}

          {data.facts.length > 0 && (
            <Section title={`Current facts (${data.facts.length})`}>
              <ul className="space-y-xs">
                {data.facts.slice(0, 6).map((fact) => (
                  <li
                    key={fact.id}
                    className="rounded-sm bg-surface-alt px-sm py-xs text-sub"
                    title={fact.factText}
                  >
                    {fact.factText}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {data.openLoops.length > 0 && (
            <Section title={`Open loops (${data.openLoops.length})`}>
              <ul className="space-y-xs">
                {data.openLoops.map((loop) => (
                  <li
                    key={loop.id}
                    className="flex items-baseline justify-between gap-sm rounded-sm bg-surface-alt px-sm py-xs"
                  >
                    <span className="min-w-0 flex-1 truncate text-sub" title={loop.title}>
                      {loop.title}
                    </span>
                    {loop.dueAt && (
                      <span className="shrink-0 text-caption text-pending">
                        {formatRelative(loop.dueAt)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {data.receipts.length > 0 && (
            <Section title={`Receipt memories (${data.receipts.length})`}>
              <ul className="space-y-sm">
                {data.receipts.map((receipt) => (
                  <li key={receipt.id} className="border-l-2 border-hairline pl-sm">
                    <p className="line-clamp-2 text-caption text-ink2" title={receipt.snippet}>
                      “{receipt.snippet}”
                    </p>
                    <span className="text-micro uppercase tracking-wide text-ink3">
                      {formatDate(receipt.occurredAt ?? receipt.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {!data.profile &&
            data.facts.length === 0 &&
            data.openLoops.length === 0 &&
            data.receipts.length === 0 && (
              <p className="px-lg py-xl text-sub text-ink3">
                No recorded context for this entity yet.
              </p>
            )}
        </>
      )}
    </div>
  );
}
