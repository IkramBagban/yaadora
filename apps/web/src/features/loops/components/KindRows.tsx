import { kindMeta } from '../loopUtils'
import { LOOP_KINDS, type Loop } from '../types'
import { LoopCard } from './LoopCard'

interface KindRowsProps {
  loops: Loop[]
  now: Date
  onOpen: (loop: Loop) => void
  onConvert: (loop: Loop) => void
  onResolve: (loop: Loop) => void
  /** True while a loop action is in flight; disables card actions. */
  busy?: boolean
}

/**
 * L-2 rows-by-kind view: flat list grouped into swim-lanes per kind, sharing
 * the exact card actions with the kanban. Unknown extraction kinds get their
 * own trailing lane so nothing disappears from the board.
 */
export function KindRows({ loops, now, onOpen, onConvert, onResolve, busy = false }: KindRowsProps) {
  const lanes = groupByKind(loops)
  const nonEmpty = [...lanes.entries()].filter(([, items]) => items.length > 0)

  if (nonEmpty.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-hairline px-md py-lg text-center text-caption text-ink3">
        No loops match the current filter.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-xl">
      {nonEmpty.map(([kind, items]) => {
        const meta = kindMeta(kind)
        const Icon = meta.icon
        return (
          <section key={kind} aria-label={`${meta.label} loops`}>
            <header className="mb-sm flex items-center gap-sm">
              <Icon size={14} className="text-accent" />
              <h2 className="text-caption-medium uppercase tracking-wide text-ink2">
                {meta.label}
              </h2>
              <span className="text-micro text-ink3">{items.length}</span>
            </header>
            <div className="grid grid-cols-1 gap-sm lg:grid-cols-2">
              {items.map((loop) => (
                <LoopCard
                  key={loop.id}
                  loop={loop}
                  now={now}
                  busy={busy}
                  onOpen={onOpen}
                  onConvert={onConvert}
                  onResolve={onResolve}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** Known kinds in canonical order, then any extra extraction kinds by name. */
function groupByKind(loops: Loop[]): Map<string, Loop[]> {
  const lanes = new Map<string, Loop[]>()
  for (const kind of LOOP_KINDS) lanes.set(kind, [])
  for (const loop of loops) {
    if (!lanes.has(loop.kind)) lanes.set(loop.kind, [])
    lanes.get(loop.kind)?.push(loop)
  }
  return lanes
}
