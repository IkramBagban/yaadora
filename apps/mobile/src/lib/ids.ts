import * as Crypto from 'expo-crypto';

/** Idempotency key for offline capture sync (server dedupes on it). */
export function newClientId(): string {
  return Crypto.randomUUID();
}
