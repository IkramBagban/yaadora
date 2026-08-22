import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Spinner } from '../../../components/ui/Spinner'
import { searchEvidenceMemories } from '../api'
import type { EvidenceMemory } from '../types'

interface EvidencePickerProps {
  /** Chosen memory id (controlled). */
  value: string | null
  onChange: (memory: EvidenceMemory | null) => void
}

/**
 * "This memory closes it" — debounced semantic + lexical search over the
 * user's memories; picking one records it as the loop's closing evidence.
 */
export function EvidencePicker({ value, onChange }: EvidencePickerProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<EvidenceMemory[]>([])
  /** The trimmed query the current `results` belong to — guards staleness. */
  const [resultsFor, setResultsFor] = useState('')
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)
  // Derived during render so short queries need no effect-driven resets.
  const active = query.trim().length >= 2
  // Only ever show results that answer the text currently in the box.
  const fresh = resultsFor === query.trim() && active

  useEffect(() => {
    const trimmed = query.trim()
    if (!active) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      const current = ++seq.current
      setLoading(true)
      searchEvidenceMemories(trimmed, controller.signal)
        .then((res) => {
          if (current === seq.current) {
            setResults(res.memories)
            setResultsFor(trimmed)
          }
        })
        .catch(() => {
          // Aborted or failed — keep previous results; picker stays usable.
        })
        .finally(() => {
          if (current === seq.current) setLoading(false)
        })
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query, active])

  return (
    <div className="flex flex-col gap-sm">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-lg top-1/2 -translate-y-1/2 text-ink3" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search memories for the one that closes this…"
          aria-label="Search evidence memories"
          className="h-10 w-full rounded-md border border-hairline bg-surface pl-xxl pr-lg text-body text-ink placeholder:text-ink3 focus:border-accent focus:outline-none"
        />
      </div>

      {loading && (
        <p className="flex items-center gap-sm px-xs text-caption text-ink3">
          <Spinner size={13} /> searching…
        </p>
      )}

      <ul className="flex max-h-56 flex-col gap-xs overflow-y-auto">
        {fresh &&
          results.map((memory) => {
          const selected = memory.id === value
          const when = (memory.occurredAt ?? memory.createdAt).slice(0, 10)
          return (
            <li key={memory.id}>
              <button
                type="button"
                onClick={() => onChange(selected ? null : memory)}
                aria-pressed={selected}
                className={`w-full rounded-md border p-sm text-left transition-colors ${
                  selected
                    ? 'border-accent bg-accent-soft'
                    : 'border-hairline hover:bg-surface-alt'
                }`}
              >
                <span className="line-clamp-2 text-caption text-ink">{memory.rawText}</span>
                <span className="mt-0.5 block text-micro text-ink3">{when}</span>
              </button>
            </li>
          )
        })}
      </ul>

      {!loading && active && fresh && results.length === 0 && (
        <p className="px-xs text-caption text-ink3">No matching memories.</p>
      )}
    </div>
  )
}
