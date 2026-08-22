import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Spinner } from '../../components/ui/Spinner'
import { usePaletteCommands } from './commands'
import { closePalette } from './paletteBus'
import { usePaletteNavigate } from './navigation'
import { pushRecent } from './recent'
import { buildRows } from './rows'
import { PaletteRow } from './PaletteRow'
import { useUnifiedSearch } from './useUnifiedSearch'
import type { PaletteItem } from './types'

/**
 * The palette dialog itself. Mounted only while open, so query/cursor state
 * resets naturally on every open — no reset effects. Fully keyboard-operable:
 * ↑↓ move the cursor (wrapping), Home/End jump, ↵ runs, Esc clears then
 * closes, Tab is trapped (arrows are the navigation).
 */
export function PaletteDialog() {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const commands = usePaletteCommands()
  const navigate = usePaletteNavigate()
  const search = useUnifiedSearch(query)

  const rows = useMemo(
    () => buildRows({ query, commands, search, navigate }),
    [query, commands, search, navigate],
  )
  const flat = rows.flat

  // Derive a safe cursor instead of clamping in an effect.
  const maxIndex = Math.max(flat.length - 1, 0)
  const activeIndex = Math.min(cursor, maxIndex)
  const activeItem: PaletteItem | undefined = flat[activeIndex]
  const rowIndices = useMemo(() => new Map(flat.map((item, index) => [item.id, index])), [flat])

  // Focus is a DOM side effect, not state sync — runs once per mount.
  useEffect(() => {
    inputRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  // Keep the active row visible while arrowing through long groups.
  useEffect(() => {
    listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const close = useCallback(() => {
    closePalette()
  }, [])

  const choose = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item) return
      if (item.href && item.groupId !== 'recent') {
        pushRecent({ id: item.id, groupId: item.groupId, label: item.label, href: item.href })
      }
      item.select()
      close()
    },
    [close],
  )

  const onKeyDown = (event: React.KeyboardEvent): void => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        if (query) setQuery('')
        else close()
        return
      case 'Tab':
        event.preventDefault() // single-input dialog; arrows are the navigation
        return
      case 'ArrowDown':
        event.preventDefault()
        if (flat.length) setCursor((index) => (Math.min(index, maxIndex) + 1) % flat.length)
        return
      case 'ArrowUp':
        event.preventDefault()
        if (flat.length) setCursor((index) => (Math.min(index, maxIndex) - 1 + flat.length) % flat.length)
        return
      case 'Home':
        event.preventDefault()
        setCursor(0)
        return
      case 'End':
        event.preventDefault()
        setCursor(maxIndex)
        return
      case 'Enter':
        event.preventDefault()
        choose(activeItem)
        return
      default:
        return
    }
  }

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label="Close command palette"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-[2px]"
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        className="absolute left-1/2 top-[12vh] flex max-h-[70vh] w-[min(92vw,_640px)] -translate-x-1/2 flex-col overflow-hidden rounded-md border border-hairline bg-surface shadow-lg"
      >
        <div className="flex items-center gap-sm border-b border-hairline px-lg py-md">
          <Search size={16} className="shrink-0 text-ink3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setCursor(0)
            }}
            placeholder="Search memories, entities, facts — or jump anywhere…"
            aria-label="Search and run commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-listbox"
            aria-activedescendant={activeItem ? `palette-row-${activeIndex}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="h-8 w-full bg-transparent text-body text-ink placeholder:text-ink3 focus:outline-none"
          />
          {search.isSearching && <Spinner size={14} className="text-ink3" />}
        </div>

        <PaletteResults
          listRef={listRef}
          groups={rows.groups}
          rowIndices={rowIndices}
          activeIndex={activeIndex}
          hasQuery={query.trim().length > 0}
          isSearching={search.isSearching}
          isError={search.isError}
          onHover={setCursor}
          onSelect={choose}
        />

        <footer className="flex items-center gap-lg border-t border-hairline px-lg py-sm text-micro uppercase tracking-wide text-ink3">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc {query ? 'clear' : 'close'}</span>
          <span className="ml-auto normal-case">⌘K</span>
        </footer>
      </div>
    </div>
  )
}

interface PaletteResultsProps {
  listRef: React.RefObject<HTMLDivElement | null>
  groups: ReturnType<typeof buildRows>['groups']
  rowIndices: Map<string, number>
  activeIndex: number
  hasQuery: boolean
  isSearching: boolean
  isError: boolean
  onHover: (index: number) => void
  onSelect: (item: PaletteItem | undefined) => void
}

function PaletteResults({
  listRef,
  groups,
  rowIndices,
  activeIndex,
  hasQuery,
  isSearching,
  isError,
  onHover,
  onSelect,
}: PaletteResultsProps) {
  const isEmpty = !groups.some((group) => group.items.length > 0)

  return (
    <div
      ref={listRef}
      role="listbox"
      id="palette-listbox"
      aria-label="Results"
      className="min-h-[120px] flex-1 overflow-y-auto p-sm"
    >
      {isEmpty ? (
        <p className="px-md py-xl text-center text-sub text-ink3">
          {isSearching
            ? 'Searching…'
            : isError
              ? 'Search is unavailable right now.'
              : hasQuery
                ? 'No matches. Try fewer words.'
                : 'Type to search, or pick an action.'}
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.id} className="mb-xs">
            <h2 className="px-md pb-1 pt-md text-micro uppercase tracking-wide text-ink3">{group.label}</h2>
            {group.items.map((item) => {
              const index = rowIndices.get(item.id) ?? 0
              return (
                <PaletteRow
                  key={item.id}
                  id={`palette-row-${index}`}
                  item={item}
                  active={index === activeIndex}
                  onHover={() => onHover(index)}
                  onSelect={() => onSelect(item)}
                />
              )
            })}
          </section>
        ))
      )}
    </div>
  )
}
