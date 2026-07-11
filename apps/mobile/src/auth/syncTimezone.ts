import { api } from '../api/client';
import { createMobileLogger } from '../lib/log';

const log = createMobileLogger('auth:timezone');

/** Best-effort: push device IANA timezone to the server after sign-in. */
export async function syncDeviceTimezone(): Promise<void> {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timezone) {
      log.warn('no device timezone available');
      return;
    }
    log.info('syncing device timezone', { timezone });
    const me = await api.patchMe({ timezone });
    log.info('timezone synced', { userId: me.id, timezone: me.timezone });
  } catch (err) {
    log.warn('timezone sync failed (non-fatal)', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
