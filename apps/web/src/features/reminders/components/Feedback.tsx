import type { ReactNode } from 'react';

/** Consistent empty-state block used across list views in this feature. */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-xs py-xxl text-center">
      <p className="text-body font-medium text-ink2">{title}</p>
      {hint && <p className="max-w-sm text-caption text-ink3">{hint}</p>}
    </div>
  );
}

/** Inline mutation-error note with a dismiss affordance. */
export function ErrorNote({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start justify-between gap-md rounded-md border border-danger/30 bg-danger/10 px-lg py-sm">
      <p className="text-caption text-danger">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="text-caption font-medium text-danger hover:underline"
      >
        dismiss
      </button>
    </div>
  );
}

/** Section heading with optional trailing content (counts, controls). */
export function SectionHeader({
  title,
  children,
}: {
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-md">
      <h3 className="text-title font-semibold">{title}</h3>
      {children}
    </div>
  );
}
