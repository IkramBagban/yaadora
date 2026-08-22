import type { Memory, MemorySource } from '../../api/types';
import { displayTime, relativeTime } from '../../lib/time';
import { isInFlight } from './filters';
import { Badge } from '../ui/Badge';
import { Inbox, Mic, PenLine, Star } from 'lucide-react';

const sourceIcons = { manual: PenLine, voice: Mic, import: Inbox } as const;

function SourceMark({ source }: { source: MemorySource }) {
  const Icon = sourceIcons[source as keyof typeof sourceIcons] ?? PenLine;
  return (
    <span className="inline-flex items-center gap-xs text-caption text-ink2">
      <Icon size={13} aria-hidden />
      <span className="capitalize">{source}</span>
    </span>
  );
}

interface MemoryRowProps {
  memory: Memory;
  onOpen: (id: string) => void;
  onTogglePin: (memory: Memory) => void;
}

/** One timeline entry. Raw text stays verbatim; metadata sits underneath. */
export function MemoryRow({ memory, onOpen, onTogglePin }: MemoryRowProps) {
  const when = relativeTime(displayTime(memory.occurredAt, memory.createdAt));

  return (
    <article className="rounded-md border border-hairline bg-surface transition-colors hover:border-accent/40">
      <button
        type="button"
        onClick={() => onOpen(memory.id)}
        className="block w-full cursor-pointer px-md pb-xs pt-md text-left"
        aria-label="Open memory detail"
      >
        <p className="line-clamp-3 whitespace-pre-wrap text-body text-ink">
          {memory.rawText}
        </p>
      </button>

      <div className="flex items-center gap-sm px-md pb-md pt-xs">
        <SourceMark source={memory.source} />
        {when && (
          <>
            <span aria-hidden className="text-caption text-ink3">
              ·
            </span>
            <time className="text-caption text-ink2" dateTime={memory.createdAt}>
              {when}
            </time>
          </>
        )}
        {memory.status === 'failed' && <Badge tone="danger">failed</Badge>}
        {isInFlight(memory) && <Badge tone="pending">processing…</Badge>}

        <button
          type="button"
          onClick={() => onTogglePin(memory)}
          aria-pressed={memory.pinned}
          aria-label={memory.pinned ? 'Unpin memory' : 'Pin memory'}
          className="ml-auto cursor-pointer rounded-sm p-xs text-ink3 transition-colors hover:bg-surface-alt hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Star
            size={16}
            aria-hidden
            className={memory.pinned ? 'fill-accent text-accent' : undefined}
          />
        </button>
      </div>
    </article>
  );
}
