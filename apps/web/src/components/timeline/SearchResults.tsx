import { useQuery } from '@tanstack/react-query';
import { memoryKeys, searchMemories } from '../../api/memories';
import type { Memory } from '../../api/types';
import { MemoryRow } from './MemoryRow';
import { SearchSkeleton } from './Skeletons';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ArrowLeft, AlertCircle } from 'lucide-react';

interface SearchResultsProps {
  query: string;
  onOpen: (id: string) => void;
  onTogglePin: (memory: Memory) => void;
  onBack: () => void;
}

/** Distinct results view (semantic + lexical hybrid) that replaces the
 *  chronological feed while a query is active. */
export function SearchResults({ query, onOpen, onTogglePin, onBack }: SearchResultsProps) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: memoryKeys.search(query),
    queryFn: () => searchMemories(query),
    staleTime: 30_000,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-sm py-sm">
        <Button variant="ghost" size="sm" onClick={onBack} aria-label="Back to timeline">
          <ArrowLeft size={16} />
        </Button>
        {isPending ? (
          <span className="text-sub text-ink2">Searching…</span>
        ) : (
          <span className="text-sub text-ink2">
            {data
              ? `${data.memories.length} ${data.memories.length === 1 ? 'memory' : 'memories'} and ${data.facts.length} ${data.facts.length === 1 ? 'fact' : 'facts'} for “${data.query}”`
              : `Results for “${query}”`}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-xs pb-lg">
        {isPending ? (
          <SearchSkeleton />
        ) : isError ? (
          <div role="alert" className="flex flex-col items-center gap-md py-xxl text-center">
            <AlertCircle size={20} className="text-danger" aria-hidden />
            <p className="text-sub text-ink2">Search failed to complete.</p>
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        ) : data && data.memories.length === 0 && data.facts.length === 0 ? (
          <div className="flex flex-col items-center gap-sm py-xxl text-center">
            <p className="text-title font-semibold text-ink">No matches</p>
            <p className="max-w-sm text-sub text-ink2">
              Nothing in your memory matches “{data.query}”. Try fewer or
              different words.
            </p>
          </div>
        ) : data ? (
          <div className="flex flex-col gap-lg">
            {data.memories.length > 0 && (
              <section aria-label="Matching memories" className="flex flex-col gap-sm">
                {data.memories.map((m) => (
                  <div key={m.id} className="flex flex-col gap-xs">
                    <MemoryRow memory={m} onOpen={onOpen} onTogglePin={onTogglePin} />
                    <ChannelLine channels={m.channels} />
                  </div>
                ))}
              </section>
            )}

            {data.facts.length > 0 && (
              <section aria-label="Matching facts" className="flex flex-col gap-sm">
                <h2 className="px-xs text-caption-medium uppercase tracking-wide text-ink2">
                  Facts
                </h2>
                {data.facts.map((f) => (
                  <div
                    key={f.id}
                    className="rounded-md border border-hairline bg-surface px-md py-sm"
                  >
                    <p className="text-body text-ink">{f.factText}</p>
                    <div className="mt-xs flex items-center gap-sm">
                      <ChannelLine channels={f.channels} />
                      {f.validTo ? (
                        <Badge tone="neutral">historical</Badge>
                      ) : (
                        <Badge tone="success">current</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ChannelLine({ channels }: { channels: string[] }) {
  if (channels.length === 0) return null;
  return (
    <p className="px-xs text-micro uppercase tracking-wide text-ink3">
      matched by {channels.join(' + ')}
    </p>
  );
}
