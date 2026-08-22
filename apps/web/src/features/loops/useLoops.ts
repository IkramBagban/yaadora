import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  cancelReminder,
  createLoop,
  createReminderFromLoop,
  fetchLoops,
  patchLoop,
} from './api'
import type { CreateLoopInput, Loop, PatchLoopInput } from './types'

export const loopKeys = {
  all: ['loops'] as const,
}

/** Full board payload: every loop across all lifecycle statuses. */
export function useLoopsQuery() {
  return useQuery({
    queryKey: loopKeys.all,
    queryFn: fetchLoops,
    // The board is the single writer for loops in this session; refetching on
    // window focus would fight optimistic drag-and-drop updates.
    refetchOnWindowFocus: false,
  })
}

function useInvalidateLoops() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: loopKeys.all })
}

/** POST /open-loops — manual planting. */
export function useCreateLoop() {
  const invalidate = useInvalidateLoops()
  return useMutation({
    mutationFn: (input: CreateLoopInput) => createLoop(input),
    onSuccess: () => invalidate(),
  })
}

/**
 * PATCH /open-loops/:id with an optimistic in-cache merge so drags and quick
 * actions land instantly; a failed persist rolls back and refetches.
 */
export function usePatchLoop() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PatchLoopInput }) =>
      patchLoop(id, patch),

    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: loopKeys.all })
      const previous = queryClient.getQueryData<{ items: Loop[] }>(loopKeys.all)
      queryClient.setQueryData<{ items: Loop[] }>(loopKeys.all, (old) =>
        old
          ? {
              items: old.items.map((loop) =>
                loop.id === id ? { ...loop, ...withoutUndefined(patch) } : loop,
              ),
            }
          : old,
      )
      return { previous }
    },

    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(loopKeys.all, context.previous)
      }
      void queryClient.invalidateQueries({ queryKey: loopKeys.all })
    },

    onSuccess: (updated) => {
      queryClient.setQueryData<{ items: Loop[] }>(loopKeys.all, (old) =>
        old
          ? {
              items: old.items.map((loop) =>
                loop.id === updated.id ? updated : loop,
              ),
            }
          : old,
      )
    },
  })
}

/** Result of converting a loop into a reminder. */
export interface ConvertResult {
  reminderId: string
}

/**
 * Convert-to-reminder: creates the one-shot reminder from the loop's title /
 * due date / provenance, then moves the loop out of the open column
 * (`status: 'resolved'` — the closest terminal state the schema offers; see
 * track learnings). An explicit `dueAt` (from the convert dialog) overrides
 * the loop's own.
 *
 * The two calls are not atomic server-side; if the follow-up PATCH fails we
 * soft-cancel the just-created reminder so a retry cannot duplicate it (the
 * confirm endpoint does no dedupe).
 */
export function useConvertToReminder() {
  const invalidate = useInvalidateLoops()
  return useMutation({
    mutationFn: async ({
      loop,
      dueAt,
    }: {
      loop: Loop
      dueAt?: string | null
    }): Promise<ConvertResult> => {
      const reminder = await createReminderFromLoop({
        title: loop.title,
        dueAt: dueAt !== undefined ? dueAt : loop.dueAt,
        sourceMemory: loop.sourceMemory,
      })
      try {
        await patchLoop(loop.id, { status: 'resolved' })
      } catch (err) {
        // Compensate so state stays consistent for a clean retry. If even the
        // cancel fails, surface the original error; invalidation will refetch.
        await cancelReminder(reminder.id).catch(() => undefined)
        throw err
      }
      return { reminderId: reminder.id }
    },
    onSuccess: () => invalidate(),
    onError: () => invalidate(),
  })
}

function withoutUndefined(patch: PatchLoopInput): Partial<PatchLoopInput> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  ) as Partial<PatchLoopInput>
}
