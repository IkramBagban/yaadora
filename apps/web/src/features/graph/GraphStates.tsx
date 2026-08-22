import { Link } from '@tanstack/react-router';
import { AlertTriangle } from 'lucide-react';
import { Button } from '../../components/ui/Button';

/** Pulsing rail + scattered dots while the snapshot loads. */
export function GraphSkeleton() {
  const dots = [
    { left: '12%', top: '18%', size: 44 },
    { left: '30%', top: '62%', size: 30 },
    { left: '48%', top: '28%', size: 56 },
    { left: '66%', top: '70%', size: 26 },
    { left: '78%', top: '34%', size: 38 },
    { left: '20%', top: '80%', size: 34 },
    { left: '58%', top: '12%', size: 24 },
    { left: '88%', top: '58%', size: 46 },
  ] as const;

  return (
    <div className="flex h-full w-full">
      <div className="w-60 shrink-0 space-y-xxl border-r border-hairline bg-surface px-lg py-lg">
        <div className="h-10 animate-pulse rounded-md bg-surface-alt" />
        <div className="space-y-xs">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-6 animate-pulse rounded-sm bg-surface-alt" />
          ))}
        </div>
        <div className="h-16 animate-pulse rounded-md bg-surface-alt" />
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        {dots.map((dot, i) => (
          <span
            key={i}
            className="absolute animate-pulse rounded-full bg-surface-alt"
            style={{
              left: dot.left,
              top: dot.top,
              width: dot.size,
              height: dot.size,
              animationDelay: `${i * 120}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function GraphEmptyState() {
  return (
    <div className="flex h-full w-full items-center justify-center p-xl">
      <div className="max-w-md text-center">
        <div
          aria-hidden
          className="mx-auto mb-lg h-16 w-16 rounded-full border-2 border-dashed border-hairline"
        />
        <h2 className="text-title font-semibold">Nothing to map yet</h2>
        <p className="mt-sm text-sub text-ink2">
          Your knowledge graph appears once memories are captured and processed —
          people, places, projects and how they connect.
        </p>
        <Link
          to="/"
          className="mt-xl inline-flex h-10 items-center rounded-md bg-accent px-lg text-sub font-medium text-on-accent transition-colors hover:opacity-90"
        >
          Capture your first memory
        </Link>
      </div>
    </div>
  );
}

export function GraphErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-xl">
      <div className="max-w-md text-center">
        <AlertTriangle size={28} className="mx-auto mb-md text-danger" />
        <h2 className="text-title font-semibold">Couldn't load the graph</h2>
        <p className="mt-sm text-sub text-ink2">
          The server didn't answer. Check your connection and try again.
        </p>
        <Button className="mt-xl" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  );
}
