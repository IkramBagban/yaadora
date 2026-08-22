import { request } from './client'
import type { AdminFact, FactPage, FactView } from './types'

export interface ListFactsParams {
  view: FactView
  /** entity uuid or a canonical-name fragment (server ILIKEs both sides) */
  subject?: string
  conflicted?: boolean
  limit?: number
  cursor?: string | null
}

/** GET /facts — filterable, keyset-paginated admin listing. */
export function listFacts(params: ListFactsParams): Promise<FactPage> {
  const qs = new URLSearchParams({ view: params.view })
  if (params.subject) qs.set('subject', params.subject)
  if (params.conflicted) qs.set('conflicted', 'true')
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.cursor) qs.set('cursor', params.cursor)
  return request<FactPage>(`/facts?${qs.toString()}`)
}

export interface PatchFactBody {
  hidden?: boolean | null
  conflictNote?: string | null
}

/** PATCH /facts/:id — review metadata only; provenance is never destroyed. */
export function patchFact(id: string, body: PatchFactBody): Promise<AdminFact> {
  return request<AdminFact>(`/facts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}
