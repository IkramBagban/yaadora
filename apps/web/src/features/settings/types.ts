/** Settings-feature wire types. Mirrors `apps/mobile/src/api/client.ts` conventions. */

/**
 * Privacy / budget settings — GET/PATCH /settings/privacy.
 * Shape matches mobile's `PrivacySettings` (wire-shape source of truth).
 * - `transcriptRetentionDays`: null = keep forever, 0 = discard once digested, N = days.
 */
export interface PrivacySettings {
  transcriptRetentionDays: number | null;
  quietHoursStart: string;
  quietHoursEnd: string;
  maxDailySurfacings: number;
  /** false suppresses inference-grade proactive nudges (spec 03 P4). */
  insightsEnabled: boolean;
}

/** PATCH /settings/privacy — every field optional; null only valid for retention. */
export type PrivacyPatch = Partial<PrivacySettings>;

/** GET /me — current authenticated user profile. */
export interface MeProfile {
  id: string;
  email: string;
  timezone: string;
  createdAt: string;
}

/**
 * A registered push/device token. NOTE: `GET /push-tokens` and
 * `DELETE /push-tokens/:id` are not exposed by the server yet (see
 * webdocs/backend-api-gaps.md) — this is the planned shape, kept local to the
 * feature until the backend contract lands.
 */
export interface DeviceToken {
  id: string;
  deviceId: string;
  expoToken: string;
  updatedAt: string;
}

/** GET /push-tokens (planned). */
export interface DeviceTokenList {
  items: DeviceToken[];
}

/** POST /settings/rebuild (planned) — accepted job descriptor. */
export interface RebuildJob {
  jobId: string;
  status: 'queued' | 'running' | 'done' | 'failed' | (string & {});
}

// --- data export (S-3) -------------------------------------------------------

/** Download format: full JSON dump or Markdown journal. */
export type ExportFormat = 'json' | 'markdown';

// Minimal shapes for list endpoints without shared wire types yet. Fields are
// taken from the server serializers (`apps/server/src/routes/*.ts`) and the
// db schema — not invented.

/** GET /open-loops item (subset relevant to exports). */
export interface ExportOpenLoop {
  id: string;
  kind: string;
  title: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
}

/** GET /digests item. */
export interface ExportDigest {
  kind: string;
  content: string;
  updatedAt: string;
}

/** One page of a cursor-paginated listing ({items, nextCursor}). */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
