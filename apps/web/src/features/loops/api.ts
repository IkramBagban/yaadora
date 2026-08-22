import { request } from '../../api/client'
import type {
  CreatedReminder,
  CreateLoopInput,
  Loop,
  LoopList,
  PatchLoopInput,
  SearchMemoriesResult,
} from './types'

/** Board wants every lifecycle column at once; server caps at 500. */
const LIST_LIMIT = 500
/** Evidence picker result size. */
const SEARCH_LIMIT = 12

/** GET /open-loops — full board payload (all statuses, soonest-due first). */
export function fetchLoops(): Promise<LoopList> {
  return request<LoopList>(`/open-loops?limit=${LIST_LIMIT}`)
}

/** POST /open-loops — manual planting; the loop enters status `open`. */
export function createLoop(input: CreateLoopInput): Promise<Loop> {
  return request<Loop>('/open-loops', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** PATCH /open-loops/:id — lifecycle + metadata edits. Drops unset keys so the server's "at least one field" refine is satisfied by exactly what changed. */
export function patchLoop(id: string, patch: PatchLoopInput): Promise<Loop> {
  const body = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  )
  return request<Loop>(`/open-loops/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

/** GET /memories/search — semantic + lexical; powers the evidence picker. */
export function searchEvidenceMemories(
  query: string,
  signal?: AbortSignal,
): Promise<SearchMemoriesResult> {
  const params = new URLSearchParams({ q: query, limit: String(SEARCH_LIMIT) })
  return request<SearchMemoriesResult>(`/memories/search?${params}`, { signal })
}

/**
 * POST /reminders/confirm — convert a loop into a one-shot reminder,
 * pre-filling title/due date and carrying provenance when the loop was
 * extraction-derived.
 */
export function createReminderFromLoop(loop: {
  title: string
  dueAt: string | null
  sourceMemory: string | null
}): Promise<CreatedReminder> {
  // Reminders need a concrete fire time; a loop without a due date converts
  // to "tomorrow" so the confirm endpoint's required dueAt stays honest.
  const dueAt = loop.dueAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000)
  return request<CreatedReminder>('/reminders/confirm', {
    method: 'POST',
    body: JSON.stringify({
      text: loop.title,
      dueAt: new Date(dueAt).toISOString(),
      recurrence: 'once',
      origin: 'manual',
      sourceMemoryId: loop.sourceMemory ?? undefined,
    }),
  })
}

/** DELETE /reminders/:id — soft-cancel. Used to undo an orphaned conversion. */
export function cancelReminder(id: string): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>(`/reminders/${id}`, {
    method: 'DELETE',
  })
}
