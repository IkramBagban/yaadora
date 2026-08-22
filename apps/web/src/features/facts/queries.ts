import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query'
import { listFacts, patchFact, type PatchFactBody } from '../../api/facts'
import type { AdminFact, FactPage, FactView } from '../../api/types'

const PAGE_SIZE = 100

/** History of facts for the explorer body, keyset-paginated ("Load more"). */
export function useFactsPages(view: FactView, subject: string) {
  return useInfiniteQuery({
    queryKey: ['facts', view, subject],
    queryFn: ({ pageParam }) =>
      listFacts({ view, subject: subject || undefined, limit: PAGE_SIZE, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  })
}

/** All conflict-flagged facts (history view — flags survive supersession). */
export function useConflictedFacts() {
  return useQuery({
    queryKey: ['facts', 'conflicted'],
    queryFn: () => listFacts({ view: 'history', conflicted: true, limit: 200 }),
    staleTime: 30_000,
  })
}

function isFactPage(value: unknown): value is FactPage {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as FactPage).items)
  )
}

function isInfiniteFactData(value: unknown): value is InfiniteData<FactPage> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as InfiniteData<FactPage>).pages)
  )
}

function patchPage(page: FactPage, updated: AdminFact): FactPage {
  return {
    ...page,
    items: page.items.map((f) => (f.id === updated.id ? { ...f, ...updated } : f)),
  }
}

/** Splice a patched fact back into every ['facts'] cache it appears in,
 *  regardless of infinite vs flat query shape. */
function updateCachedFact(qc: QueryClient, updated: AdminFact): void {
  qc.setQueriesData<unknown>({ queryKey: ['facts'] }, (old: unknown) => {
    if (isInfiniteFactData(old)) {
      return { ...old, pages: old.pages.map((p) => patchPage(p, updated)) }
    }
    if (isFactPage(old)) return patchPage(old, updated)
    return old
  })
}

/** PATCH /facts/:id — hide/unhide + conflict note, with cache splice-in. */
export function usePatchFact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & PatchFactBody) =>
      patchFact(id, body),
    onSuccess: (updated) => updateCachedFact(qc, updated),
  })
}
