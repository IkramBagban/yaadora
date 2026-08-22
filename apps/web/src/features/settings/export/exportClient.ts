import { request } from '../../../api/client'
import type { EntityListItem, Fact, Memory, MemoryPage, Reminder, ReminderList, StandingRule } from '../../../api/types'
import type {
  ExportDigest,
  ExportOpenLoop,
  MeProfile,
  Page,
  PrivacySettings,
} from '../types'
import { fetchMe, fetchPrivacySettings } from '../api'

/**
 * Client-side account export (S-3). Composed entirely from existing read
 * endpoints — memories and facts are keyset-paginated to completion; the
 * remaining lists are fetched in one shot at their server-side caps.
 */

/** Hard page cap so a pathological cursor loop can't hang the export. */
const MAX_PAGES = 200

export interface AccountExport {
  exportedAt: string;
  profile: MeProfile;
  privacy: PrivacySettings;
  memories: Memory[];
  facts: Fact[];
  entities: EntityListItem[];
  openLoops: ExportOpenLoop[];
  reminders: Reminder[];
  rules: StandingRule[];
  digests: ExportDigest[];
}

export type ExportProgress = (label: string) => void;

/** Drain a `{items, nextCursor}` listing until the cursor runs out. */
async function collectPages<T>(
  label: string,
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
  onProgress: ExportProgress,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchPage(cursor);
    all.push(...res.items);
    onProgress(`${label}… ${all.length}`);
    if (!res.nextCursor || res.items.length === 0) return all;
    cursor = res.nextCursor;
  }
  // A cursor that survives MAX_PAGES pages means the listing is not
  // terminating — abort rather than export a silently incomplete dataset.
  throw new Error(
    `${label}: pagination did not terminate after ${MAX_PAGES} pages. Export aborted so you don't get partial data.`,
  );
}

function collectMemories(onProgress: ExportProgress): Promise<Memory[]> {
  return collectPages<Memory>(
    'Collecting memories',
    (cursor) => {
      const q = new URLSearchParams({ limit: '100' });
      if (cursor) q.set('cursor', cursor);
      return request<MemoryPage>(`/memories?${q.toString()}`);
    },
    onProgress,
  );
}

function collectFacts(onProgress: ExportProgress): Promise<Fact[]> {
  // `view=history` includes ended/superseded rows — an export should have them all.
  return collectPages<Fact>(
    'Collecting facts',
    (cursor) => {
      const q = new URLSearchParams({ limit: '200', view: 'history' });
      if (cursor) q.set('cursor', cursor);
      return request<Page<Fact>>(`/facts?${q.toString()}`);
    },
    onProgress,
  );
}

interface ListEnvelope<T> {
  items: T[];
}

/** Single-shot lists fetched at their server-side limits. */
async function collectSingleShotLists(onProgress: ExportProgress): Promise<
  Pick<AccountExport, 'entities' | 'openLoops' | 'reminders' | 'rules' | 'digests'>
> {
  const [entities, openLoops, reminders, rules, digests] = await Promise.all([
    request<ListEnvelope<EntityListItem>>('/entities'),
    request<ListEnvelope<ExportOpenLoop>>('/open-loops?limit=500'),
    request<ReminderList>('/reminders?scope=all&limit=100'),
    request<{ rules: StandingRule[] }>('/rules'),
    request<{ digests: ExportDigest[] }>('/digests'),
  ]);
  onProgress('Collecting entities, loops, reminders, rules…');
  return {
    entities: entities.items,
    openLoops: openLoops.items,
    reminders: reminders.items,
    rules: rules.rules,
    digests: digests.digests,
  };
}

/** Fetch everything needed for the JSON export. Sequential phases keep the
 * progress labels meaningful; heavy lists stream through pagination. */
export async function collectAccountExport(
  onProgress: ExportProgress,
): Promise<AccountExport> {
  onProgress('Preparing export…');
  const profile = await fetchMe();
  const privacy = await fetchPrivacySettings();
  const memories = await collectMemories(onProgress);
  const facts = await collectFacts(onProgress);
  const rest = await collectSingleShotLists(onProgress);

  return {
    exportedAt: new Date().toISOString(),
    profile,
    privacy,
    memories,
    facts,
    ...rest,
  };
}
