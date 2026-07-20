import { useEffect, useRef } from 'react';
import type { ExpoSpeechRecognitionOptions } from 'expo-speech-recognition';
import { createMobileLogger } from '../lib/log';

const log = createMobileLogger('voice:speech-native');

/**
 * Safe access to expo-speech-recognition.
 *
 * The package calls `requireNativeModule('ExpoSpeechRecognition')` at import
 * time, so a normal `import` crashes Expo Go and any client that hasn't
 * linked the native module. We defer the require and treat a missing module
 * as "device engine unavailable" instead of taking down the whole app.
 */

type SpeechModule = {
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  start: (options: ExpoSpeechRecognitionOptions) => void | Promise<void>;
  stop: () => void;
  abort: () => void;
  addListener: (
    eventName: string,
    listener: (event: unknown) => void,
  ) => { remove: () => void };
};

let cached: SpeechModule | null | undefined;

function loadModule(): SpeechModule | null {
  if (cached !== undefined) return cached;

  try {
    // Deferred require so evaluation only happens when we need device STT.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-speech-recognition') as {
      ExpoSpeechRecognitionModule: SpeechModule;
    };
    cached = mod.ExpoSpeechRecognitionModule;
  } catch (err) {
    log.info('expo-speech-recognition unavailable (Expo Go or unlinked native)', {
      message: err instanceof Error ? err.message : String(err),
    });
    cached = null;
  }

  return cached;
}

/** True only in a dev/production build that includes the native module. */
export function isSpeechRecognitionAvailable(): boolean {
  return loadModule() != null;
}

export function getSpeechRecognitionModule(): SpeechModule | null {
  return loadModule();
}

/**
 * Subscribe to native speech events when the module is present; no-op otherwise.
 * Mirrors `useSpeechRecognitionEvent` without importing it (import would throw).
 */
export function useSpeechRecognitionEvent(
  eventName: string,
  listener: (event: unknown) => void,
): void {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    const mod = loadModule();
    if (!mod) return;

    const sub = mod.addListener(eventName, (event) => {
      listenerRef.current(event);
    });
    return () => sub.remove();
  }, [eventName]);
}

export type { ExpoSpeechRecognitionOptions };
