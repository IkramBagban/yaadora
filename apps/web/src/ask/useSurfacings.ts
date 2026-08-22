import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from '../api/client'
import type { PendingSurfacing, SurfacingReactionResponse } from '../api/types'

/**
 * Pending nudge cards for the Ask page (spec 02 §2.4). The ledger only counts
 * a surfacing as "shown" once it earned a reaction, so cards leave the page
 * through POST /surfacings/:id/reaction — engage or dismiss, never silently.
 */
export function usePendingSurfacings(enabled: boolean) {
  return useQuery({
    queryKey: ['surfacings', 'pending'],
    queryFn: () =>
      request<{ surfacings: PendingSurfacing[] }>('/surfacings?status=pending'),
    enabled,
    staleTime: 60_000,
    select: (data) => data.surfacings,
  })
}

export type SurfacingReaction = 'engaged' | 'dismissed'

/** POST /surfacings/:id/reaction — removes the card optimistically. */
export function useSurfacingReaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { id: string; reaction: SurfacingReaction }) =>
      request<SurfacingReactionResponse>(`/surfacings/${params.id}/reaction`, {
        method: 'POST',
        body: JSON.stringify({ reaction: params.reaction }),
      }),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['surfacings', 'pending'] })
      const previous = queryClient.getQueryData<{ surfacings: PendingSurfacing[] }>([
        'surfacings',
        'pending',
      ])
      queryClient.setQueryData(['surfacings', 'pending'], {
        surfacings: (previous?.surfacings ?? []).filter((s) => s.id !== id),
      })
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['surfacings', 'pending'], context.previous)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['surfacings', 'pending'] })
    },
  })
}
