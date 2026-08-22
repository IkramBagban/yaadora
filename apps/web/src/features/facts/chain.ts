import type { AdminFact } from '../../api/types'

/**
 * Pure grouping/chain logic for the facts explorer.
 *
 * Supersession chains are linked lists: `old.supersededBy === new.id`. The
 * oldest fact points forward; the newest (head) has `supersededBy: null`.
 * Chain completeness depends on which pages are loaded — facts whose forward
 * link leaves the loaded set simply start their own group.
 */

export interface SubjectGroup {
  key: string
  label: string
  facts: AdminFact[]
}

const UNKNOWN_SUBJECT = 'Unknown subject'

/** Group facts by subject entity, ordered by name, facts newest-first (as served). */
export function groupBySubject(facts: AdminFact[]): SubjectGroup[] {
  const groups = new Map<string, SubjectGroup>()
  for (const f of facts) {
    const key = f.subjectId ?? f.subjectName ?? UNKNOWN_SUBJECT
    let g = groups.get(key)
    if (!g) {
      g = { key, label: f.subjectName ?? UNKNOWN_SUBJECT, facts: [] }
      groups.set(key, g)
    }
    g.facts.push(f)
  }
  return [...groups.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
  )
}

export interface ChainResult {
  /** supersession chains, each sorted oldest → newest (length ≥ 2) */
  chains: AdminFact[][]
  /** facts with no loaded chain neighbours */
  singles: AdminFact[]
}

function startTime(f: AdminFact): number {
  return new Date(f.validFrom ?? f.createdAt).getTime()
}

/**
 * Group history facts into supersession chains. Every fact resolves to its
 * chain head by following `supersededBy` through the loaded set (memoised,
 * cycle-safe); facts sharing a head form one chain.
 */
export function buildChains(facts: AdminFact[]): ChainResult {
  const byId = new Map(facts.map((f) => [f.id, f]))

  const headOf = new Map<string, string>()
  const resolveHead = (id: string, seen: Set<string>): string => {
    if (headOf.has(id)) return headOf.get(id) as string
    if (seen.has(id)) return id // cycle guard (shouldn't happen; app-level integrity)
    seen.add(id)
    const fact = byId.get(id)
    const head =
      fact?.supersededBy && byId.has(fact.supersededBy)
        ? resolveHead(fact.supersededBy, seen)
        : id
    headOf.set(id, head)
    return head
  }

  const byHead = new Map<string, AdminFact[]>()
  for (const f of facts) {
    const head = resolveHead(f.id, new Set())
    let members = byHead.get(head)
    if (!members) byHead.set(head, (members = []))
    members.push(f)
  }

  const chains: AdminFact[][] = []
  const singles: AdminFact[] = []
  for (const members of byHead.values()) {
    if (members.length >= 2) {
      chains.push(members.sort((a, b) => startTime(a) - startTime(b)))
    } else {
      singles.push(members[0] as AdminFact)
    }
  }
  // newest chains first for scannability
  chains.sort((a, b) => startTime(b[b.length - 1] as AdminFact) - startTime(a[a.length - 1] as AdminFact))
  singles.sort((a, b) => startTime(b) - startTime(a))
  return { chains, singles }
}

export interface ConflictPair {
  /** the older side of the pair */
  a: AdminFact
  /** the newer side */
  b: AdminFact
}

/**
 * Pair cross-flagged facts for the inbox. Flags are written symmetrically, so
 * dedupe by sorted id-pair; a fact whose counterpart wasn't returned (hidden
 * by the page cut) is skipped — "Load more"-style re-fetches heal it.
 */
export function pairConflicts(items: AdminFact[]): ConflictPair[] {
  const byId = new Map(items.map((f) => [f.id, f]))
  const seen = new Set<string>()
  const pairs: ConflictPair[] = []
  for (const f of items) {
    if (!f.conflictsWith) continue
    const other = byId.get(f.conflictsWith)
    if (!other) continue
    const key = [f.id, other.id].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    const [older, newer] = startTime(f) <= startTime(other) ? [f, other] : [other, f]
    pairs.push({ a: older, b: newer })
  }
  return pairs.sort((p, q) => startTime(q.a) - startTime(p.a))
}
