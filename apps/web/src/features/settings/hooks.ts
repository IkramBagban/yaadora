import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchPrivacySettings, patchPrivacySettings } from './api'
import type { PrivacyPatch, PrivacySettings } from './types'

/** Query hooks for the privacy settings form (S-2). */

const PRIVACY_KEY = ['settings', 'privacy'] as const

export function usePrivacySettings() {
  return useQuery({
    queryKey: PRIVACY_KEY,
    queryFn: fetchPrivacySettings,
    staleTime: 30_000,
  })
}

/**
 * PATCH /settings/privacy. The server returns the full saved settings, so the
 * cache is updated from the response — callers get the authoritative state
 * for "saved" feedback.
 */
export function useUpdatePrivacySettings() {
  const queryClient = useQueryClient()

  return useMutation<PrivacySettings, Error, PrivacyPatch>({
    mutationFn: patchPrivacySettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(PRIVACY_KEY, saved)
    },
  })
}
