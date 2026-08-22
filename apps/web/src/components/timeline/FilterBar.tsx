import { Star } from 'lucide-react';
import { hasActiveFilters, type TimelineFilters } from './filters';

interface FilterBarProps {
  value: TimelineFilters;
  onChange: (next: TimelineFilters) => void;
}

const sourceOptions = [
  { value: 'manual', label: 'Manual' },
  { value: 'voice', label: 'Voice' },
  { value: 'import', label: 'Import' },
] as const;

const statusOptions = [
  { value: 'all', label: 'Any status' },
  { value: 'processing', label: 'Processing' },
  { value: 'processed', label: 'Processed' },
  { value: 'failed', label: 'Failed' },
] as const;

function chipClass(active: boolean): string {
  return active
    ? 'border-accent bg-accent-soft text-accent'
    : 'border-hairline bg-surface text-ink2 hover:border-accent/40 hover:text-ink';
}

function Chip({
  active,
  onClick,
  ariaPressed,
  children,
}: {
  active: boolean;
  onClick: () => void;
  ariaPressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ariaPressed ?? active}
      className={`cursor-pointer rounded-pill border px-sm py-1 text-caption-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${chipClass(active)}`}
    >
      {children}
    </button>
  );
}

/** Client-side filter strip: source chips, status, date range, pinned-only.
 *  The list API accepts only cursor + limit, so none of this round-trips. */
export function FilterBar({ value, onChange }: FilterBarProps) {
  const toggleSource = (source: (typeof sourceOptions)[number]['value']) => {
    const sources = new Set(value.sources);
    if (sources.has(source)) sources.delete(source);
    else sources.add(source);
    onChange({ ...value, sources });
  };

  const active = hasActiveFilters(value);

  return (
    <div
      className="flex flex-wrap items-center gap-sm"
      role="group"
      aria-label="Filter memories"
    >
      {sourceOptions.map((opt) => (
        <Chip
          key={opt.value}
          active={value.sources.has(opt.value)}
          onClick={() => toggleSource(opt.value)}
        >
          {opt.label}
        </Chip>
      ))}

      <span aria-hidden className="h-4 w-px bg-hairline" />

      {statusOptions.map((opt) => (
        <Chip
          key={opt.value}
          active={value.status === opt.value}
          onClick={() => onChange({ ...value, status: opt.value })}
        >
          {opt.label}
        </Chip>
      ))}

      <span aria-hidden className="h-4 w-px bg-hairline" />

      <Chip
        active={value.pinnedOnly}
        onClick={() => onChange({ ...value, pinnedOnly: !value.pinnedOnly })}
      >
        <span className="inline-flex items-center gap-xs">
          <Star size={12} aria-hidden />
          Pinned
        </span>
      </Chip>

      <label className="flex items-center gap-xs text-caption text-ink2">
        <span>From</span>
        <input
          type="date"
          value={value.dateFrom ?? ''}
          onChange={(e) =>
            onChange({ ...value, dateFrom: e.target.value || null })
          }
          aria-label="Filter from date"
          className="h-8 rounded-sm border border-hairline bg-surface px-xs text-caption text-ink focus:border-accent focus:outline-none"
        />
      </label>
      <label className="flex items-center gap-xs text-caption text-ink2">
        <span>To</span>
        <input
          type="date"
          value={value.dateTo ?? ''}
          onChange={(e) => onChange({ ...value, dateTo: e.target.value || null })}
          aria-label="Filter to date"
          className="h-8 rounded-sm border border-hairline bg-surface px-xs text-caption text-ink focus:border-accent focus:outline-none"
        />
      </label>

      {active && (
        <button
          type="button"
          onClick={() =>
            onChange({
              sources: new Set(),
              status: 'all',
              dateFrom: null,
              dateTo: null,
              pinnedOnly: false,
            })
          }
          className="cursor-pointer text-caption-medium text-accent underline-offset-2 hover:underline"
        >
          Clear
        </button>
      )}
    </div>
  );
}
