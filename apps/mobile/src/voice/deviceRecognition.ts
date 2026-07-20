import { createMobileLogger } from '../lib/log';
import {
  getSpeechRecognitionModule,
  isSpeechRecognitionAvailable,
  type ExpoSpeechRecognitionOptions,
} from './speechRecognitionNative';

const log = createMobileLogger('voice:device');

/**
 * On-device speech recognition — iOS `SFSpeechRecognizer` / Android
 * `SpeechRecognizer`. Free, works offline, no audio leaves the phone.
 *
 * Used when the device is offline or cloud transcription is rate-limited.
 * Accuracy is meaningfully worse than Whisper on names and code-switched
 * speech, which is survivable only because the user proofreads the text in the
 * input before saving.
 *
 * Requires a development/production build: the native module is not available
 * in Expo Go. Callers should check `isDeviceRecognitionAvailable()` first.
 */

/** Android below 13 has no continuous mode; we restart on `end` instead. */
export const ANDROID_CONTINUOUS_MIN_API = 33;

export interface DeviceRecognitionOptions {
  /** BCP-47 tag, e.g. "en-US", "hi-IN". */
  lang: string;
  /**
   * Prefer the offline model. Falls back to the network recognizer if the
   * on-device model isn't downloaded — see `startDeviceRecognition`.
   */
  preferOnDevice?: boolean;
  continuous?: boolean;
}

export { isSpeechRecognitionAvailable as isDeviceRecognitionAvailable };

export async function requestSpeechPermissions(): Promise<boolean> {
  const mod = getSpeechRecognitionModule();
  if (!mod) return false;

  try {
    const result = await mod.requestPermissionsAsync();
    return result.granted;
  } catch (err) {
    log.warn('speech permission request failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function buildOptions(
  opts: DeviceRecognitionOptions,
  requiresOnDeviceRecognition: boolean,
): ExpoSpeechRecognitionOptions {
  return {
    lang: opts.lang,
    interimResults: true,
    continuous: opts.continuous ?? true,
    requiresOnDeviceRecognition,
    // Give the user room to pause and think mid-memory without being cut off.
    androidIntentOptions: {
      EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 2000,
      EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 2000,
    },
  };
}

/**
 * Start recognition, preferring the offline model but degrading gracefully.
 *
 * On Android the on-device model is a separate download; if it's missing,
 * `start` throws and we retry against the network recognizer. Silently falling
 * back is right here — the user asked to talk, not to manage language packs.
 */
export async function startDeviceRecognition(
  opts: DeviceRecognitionOptions,
): Promise<{ onDevice: boolean }> {
  const mod = getSpeechRecognitionModule();
  if (!mod) {
    throw new Error('On-device speech recognition is not available in this build.');
  }

  const preferOnDevice = opts.preferOnDevice ?? true;

  if (preferOnDevice) {
    try {
      await mod.start(buildOptions(opts, true));
      return { onDevice: true };
    } catch (err) {
      log.info('on-device model unavailable, using network recognizer', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await mod.start(buildOptions(opts, false));
  return { onDevice: false };
}

/** Stop and let the final result arrive. */
export function stopDeviceRecognition(): void {
  try {
    getSpeechRecognitionModule()?.stop();
  } catch {
    // Already stopped — nothing to do.
  }
}

/** Hard cancel: discard whatever was in flight (used on unmount). */
export function abortDeviceRecognition(): void {
  try {
    getSpeechRecognitionModule()?.abort();
  } catch {
    // Already stopped.
  }
}
