import { useMemo, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import type { GraphSnapshotEntity } from '../../api/types';
import { Input } from '../../components/ui/Input';
import { searchEntities, typeColorVar } from './graphModel';

export interface FilterRailProps {
  types: readonly string[];
  counts: ReadonlyMap<string, number>;
  enabledTypes: ReadonlySet<string>;
  onToggleType: (type: string) => void;
  onSetAllTypes: (enabled: boolean) => void;
  maxStrength: number;
  minStrength: number;
  onMinStrengthChange: (value: number) => void;
  withinMonths: number | null;
  onWithinMonthsChange: (months: number | null) => void;
  hideIsolated: boolean;
  onHideIsolatedChange: (hide: boolean) => void;
  entities: readonly GraphSnapshotEntity[];
  onJump: (id: string) => void;
}

const TIME_WINDOWS: Array<{ label: string; months: number | null }> = [
  { label: 'All', months: null },
  { label: '1m', months: 1 },
  { label: '3m', months: 3 },
  { label: '6m', months: 6 },
  { label: '12m', months: 12 },
];

export function FilterRail({
  types,
  counts,
  enabledTypes,
  onToggleType,
  onSetAllTypes,
  maxStrength,
  minStrength,
  onMinStrengthChange,
  withinMonths,
  onWithinMonthsChange,
  hideIsolated,
  onHideIsolatedChange,
  entities,
  onJump,
}: FilterRailProps) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchEntities(entities, query), [entities, query]);

  return (
    <div className="flex h-full w-60 shrink-0 flex-col gap-lg overflow-y-auto border-r border-hairline bg-surface px-lg py-lg">
      <div>
        <h3 className="mb-md flex items-center gap-xs text-sub font-semibold">
          <SlidersHorizontal size={14} className="text-ink3" /> Filters
        </h3>

        <div className="relative">
          <Search size={14} className="absolute top-1/2 left-md -translate-y-1/2 text-ink3" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search entities…"
            aria-label="Search entities"
            className="pl-9"
          />
        </div>
        {query.trim().length >= 2 && (
          <ul className="mt-xs space-y-1">
            {results.length === 0 && (
              <li className="px-xs py-xs text-caption text-ink3">No matches</li>
            )}
            {results.map((entity) => (
              <li key={entity.id}>
                <button
                  type="button"
                  onClick={() => {
                    onJump(entity.id);
                    setQuery('');
                  }}
                  className="flex w-full items-center gap-xs rounded-sm px-xs py-xs text-left text-caption hover:bg-surface-alt"
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: typeColorVar(entity.type) }}
                  />
                  <span className="min-w-0 flex-1 truncate">{entity.canonicalName}</span>
                  <span className="shrink-0 text-ink3">{entity.mentionCount}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-sm flex items-center justify-between">
          <h3 className="text-sub font-semibold">Entity types</h3>
          <div className="flex gap-xs text-micro">
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => onSetAllTypes(true)}
            >
              All
            </button>
            <span className="text-ink3">·</span>
            <button
              type="button"
              className="text-ink2 hover:underline"
              onClick={() => onSetAllTypes(false)}
            >
              None
            </button>
          </div>
        </div>
        <ul className="space-y-1">
          {types.map((type) => {
            const enabled = enabledTypes.has(type);
            return (
              <li key={type}>
                <button
                  type="button"
                  aria-pressed={enabled}
                  onClick={() => onToggleType(type)}
                  className="flex w-full items-center gap-sm rounded-sm px-xs py-1 text-left text-caption hover:bg-surface-alt"
                >
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full transition-opacity"
                    style={{
                      backgroundColor: typeColorVar(type),
                      opacity: enabled ? 1 : 0.25,
                    }}
                  />
                  <span
                    className={`flex-1 capitalize ${enabled ? 'text-ink' : 'text-ink3 line-through'}`}
                  >
                    {type}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink3">{counts.get(type) ?? 0}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <h3 className="mb-sm text-sub font-semibold">Relation strength</h3>
        <label className="block text-caption text-ink2">
          Minimum: <span className="tabular-nums text-ink">{minStrength.toFixed(1)}</span>
        </label>
        <input
          type="range"
          min={0}
          max={Math.max(maxStrength, 0.1)}
          step={Math.max(maxStrength / 50, 0.05)}
          value={minStrength}
          disabled={maxStrength <= 0}
          onChange={(e) => onMinStrengthChange(Number(e.target.value))}
          aria-label="Minimum edge strength"
          className="mt-xs w-full accent-(--c-accent)"
        />
        {maxStrength <= 0 && <p className="text-micro text-ink3">No relation data</p>}
      </div>

      <div>
        <h3 className="mb-sm text-sub font-semibold">Last mentioned</h3>
        <div className="flex flex-wrap gap-xs">
          {TIME_WINDOWS.map(({ label, months }) => {
            const active = withinMonths === months;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={active}
                onClick={() => onWithinMonthsChange(months)}
                className={`rounded-pill px-sm py-1 text-caption transition-colors ${
                  active
                    ? 'bg-accent text-on-accent'
                    : 'border border-hairline text-ink2 hover:bg-surface-alt'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-sm text-caption text-ink2">
        <input
          type="checkbox"
          checked={hideIsolated}
          onChange={(e) => onHideIsolatedChange(e.target.checked)}
          className="h-3.5 w-3.5 accent-(--c-accent)"
        />
        Hide isolated nodes
      </label>
    </div>
  );
}
