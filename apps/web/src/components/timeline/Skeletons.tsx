/** Shimmer placeholders shaped like the views they stand in for. */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-pill bg-surface-alt ${className}`} />;
}

export function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-sm py-sm" aria-hidden>
      <Bar className="h-4 w-24" />
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="rounded-md border border-hairline bg-surface p-md"
        >
          <Bar className="mb-xs h-3.5 w-full" />
          <Bar className={`h-3.5 ${i % 3 === 0 ? 'w-2/3' : 'w-full'}`} />
          <Bar className="mt-md h-3 w-28" />
        </div>
      ))}
    </div>
  );
}

export function SearchSkeleton() {
  return (
    <div className="flex flex-col gap-sm py-sm" aria-hidden>
      <Bar className="h-4 w-40" />
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className="rounded-md border border-hairline bg-surface p-md"
        >
          <Bar className="mb-xs h-3.5 w-full" />
          <Bar className={`h-3.5 ${i % 2 === 0 ? 'w-3/4' : 'w-1/2'}`} />
          <Bar className="mt-md h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-xl p-xxl" aria-hidden>
      <Bar className="h-5 w-40" />
      <Bar className="h-3.5 w-full" />
      <Bar className="h-3.5 w-5/6" />
      <Bar className="h-3.5 w-2/3" />
      <div className="flex gap-sm">
        <Bar className="h-7 w-20 rounded-pill" />
        <Bar className="h-7 w-24 rounded-pill" />
      </div>
      <Bar className="h-3.5 w-1/2" />
    </div>
  );
}
