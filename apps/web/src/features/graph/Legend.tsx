/** Canvas legend for the graph's visual encodings (size, width, dash). */
export function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-md left-md z-10 rounded-md border border-hairline bg-surface/90 px-md py-sm text-caption text-ink2 shadow-xs backdrop-blur-sm">
      <ul className="space-y-1">
        <li className="flex items-center gap-sm">
          <svg width="34" height="14" aria-hidden className="shrink-0">
            <circle cx="7" cy="7" r="6" fill="var(--g-topic)" />
            <circle cx="25" cy="7" r="3" fill="var(--g-place)" />
          </svg>
          size · mentions
        </li>
        <li className="flex items-center gap-sm">
          <svg width="34" height="14" aria-hidden className="shrink-0">
            <line x1="2" y1="4" x2="32" y2="4" stroke="var(--c-ink2)" strokeWidth="3" />
            <line x1="2" y1="10" x2="32" y2="10" stroke="var(--c-ink2)" strokeWidth="1" />
          </svg>
          width · strength
        </li>
        <li className="flex items-center gap-sm">
          <svg width="34" height="14" aria-hidden className="shrink-0">
            <line
              x1="2"
              y1="7"
              x2="32"
              y2="7"
              stroke="var(--c-ink3)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
            />
          </svg>
          dashed · inactive
        </li>
      </ul>
    </div>
  );
}
