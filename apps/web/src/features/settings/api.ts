import { request } from '../../api/client'
import type {
  DeviceTokenList,
  MeProfile,
  PrivacyPatch,
  PrivacySettings,
  RebuildJob,
} from './types'

/**
 * Settings API surface. Thin wrappers over the existing Bun.serve endpoints.
 * Device list/remove and derived-rebuild endpoints are planned but not
 * exposed by the server yet (webdocs/backend-api-gaps.md); callers must
 * handle their absence gracefully (404 → friendly notice).
 */

// --- privacy (S-2) ----------------------------------------------------------

export function fetchPrivacySettings(): Promise<PrivacySettings> {
  return request<PrivacySettings>('/settings/privacy')
}

export function patchPrivacySettings(patch: PrivacyPatch): Promise<PrivacySettings> {
  return request<PrivacySettings>('/settings/privacy', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/** GET /me — included in JSON exports. */
export function fetchMe(): Promise<MeProfile> {
  return request<MeProfile>('/me')
}

// --- device tokens (S-4, backend pending) -----------------------------------

export function listDeviceTokens(): Promise<DeviceTokenList> {
  return request<DeviceTokenList>('/push-tokens')
}

export function removeDeviceToken(id: string): Promise<void> {
  return request<void>(`/push-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// --- danger zone rebuild (S-5, backend pending) ------------------------------

export function rebuildDerivedState(): Promise<RebuildJob> {
  return request<RebuildJob>('/settings/rebuild', { method: 'POST', body: '{}' })
}
