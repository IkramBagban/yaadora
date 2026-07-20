import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Haptics from 'expo-haptics';
import {
  AudioModule,
  RecordingPresets,
  useAudioRecorder,
  useAudioRecorderState,
  setAudioModeAsync,
} from 'expo-audio';
import { api, ApiError } from '../api/client';
import { createMobileLogger } from '../lib/log';
import {
  abortDeviceRecognition,
  isDeviceRecognitionAvailable,
  requestSpeechPermissions,
  startDeviceRecognition,
  stopDeviceRecognition,
} from './deviceRecognition';
import { isCloudHealthy, markCloudDegraded, markCloudHealthy } from './health';
import { useSpeechRecognitionEvent } from './speechRecognitionNative';

const log = createMobileLogger('voice');

/**
 * Minimal shapes for the native speech events we consume. Declared locally so
 * the hook keeps its types under `strict` even before native modules resolve.
 */
interface SpeechResultEvent {
  results?: { transcript?: string; confidence?: number }[];
  isFinal?: boolean;
}
interface SpeechVolumeEvent {
  value?: number;
}
interface SpeechErrorEvent {
  error?: string;
  message?: string;
}

/**
 * Voice capture — one hook, two engines.
 *
 *   cloud  → record with expo-audio, POST to /transcribe (Groq Whisper).
 *            Better accuracy, especially on names. Needs network.
 *   device → expo-speech-recognition streaming, with live interim text.
 *            Free, offline, less accurate.
 *
 * The engine is chosen *before* recording starts, so we can never end up
 * holding audio we have no way to transcribe. Offline or cloud-rate-limited →
 * device. Otherwise → cloud, with device as the recovery path if the upload
 * fails after the fact.
 *
 * The transcript is handed to the caller to put in a text input. It is never
 * saved directly: the user always sees and can edit the text before it becomes
 * a memory. Without stored audio, that edit step is the only correction
 * mechanism there is.
 */

export type VoiceStatus =
  | 'idle'
  | 'requesting-permission'
  | 'recording'
  | 'transcribing'
  | 'error';

export type VoiceEngine = 'cloud' | 'device';

export interface UseVoiceCaptureOptions {
  /**
   * Called with the final transcript. The caller appends it to the input —
   * never saves it directly.
   */
  onTranscript: (text: string) => void;
  /** Live partial text while the device engine runs. Not called for cloud. */
  onInterim?: (text: string) => void;
  /** BCP-47 locale. Defaults to the device locale. */
  lang?: string;
  /** Hard cap on a single recording. */
  maxDurationMs?: number;
}

export interface VoiceCapture {
  status: VoiceStatus;
  engine: VoiceEngine | null;
  /** 0–1, for the waveform. */
  level: number;
  error: string | null;
  isActive: boolean;
  start: () => void;
  stop: () => void;
  cancel: () => void;
  dismissError: () => void;
}

const DEFAULT_MAX_DURATION_MS = 5 * 60 * 1000;

/** Whisper only uses 16kHz mono; anything more is upload weight for nothing. */
const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  // Required for the waveform — without it `metering` is always undefined.
  isMeteringEnabled: true,
};

/** Recorder state poll interval. The 500ms default makes the waveform stutter. */
const METERING_INTERVAL_MS = 100;

function deviceLocale(): string {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale;
    if (tag && tag.includes('-')) return tag;
    return tag ? `${tag}-${tag.toUpperCase()}` : 'en-US';
  } catch {
    return 'en-US';
  }
}

/** expo-speech-recognition reports volume on a -2..10 scale; map to 0..1. */
function normalizeVolume(value: number): number {
  return Math.max(0, Math.min(1, (value + 2) / 12));
}

/** expo-audio metering is dBFS (-160..0). */
function normalizeMetering(db: number | undefined): number {
  if (db === undefined || Number.isNaN(db)) return 0;
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

export function useVoiceCapture(
  options: UseVoiceCaptureOptions,
): VoiceCapture {
  const {
    onTranscript,
    onInterim,
    lang = deviceLocale(),
    maxDurationMs = DEFAULT_MAX_DURATION_MS,
  } = options;

  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [engine, setEngine] = useState<VoiceEngine | null>(null);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, METERING_INTERVAL_MS);

  // Refs mirror state for use inside native event callbacks, which capture a
  // stale closure otherwise.
  const engineRef = useRef<VoiceEngine | null>(null);
  const statusRef = useRef<VoiceStatus>('idle');
  const deviceTranscriptRef = useRef('');
  const cancelledRef = useRef(false);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest callbacks, so native listeners never fire a stale handler.
  const onTranscriptRef = useRef(onTranscript);
  const onInterimRef = useRef(onInterim);
  // Indirection so the max-duration timer inside `start` can reach `stop`,
  // which is declared after it.
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onInterimRef.current = onInterim;
  }, [onTranscript, onInterim]);

  const setStatusBoth = useCallback((next: VoiceStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const setEngineBoth = useCallback((next: VoiceEngine | null) => {
    engineRef.current = next;
    setEngine(next);
  }, []);

  const clearMaxTimer = useCallback(() => {
    if (maxTimer.current) {
      clearTimeout(maxTimer.current);
      maxTimer.current = null;
    }
  }, []);

  const finish = useCallback(
    (text: string) => {
      clearMaxTimer();
      setLevel(0);
      setEngineBoth(null);
      setStatusBoth('idle');
      const trimmed = text.trim();
      if (trimmed.length > 0) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onTranscriptRef.current(trimmed);
      }
    },
    [clearMaxTimer, setEngineBoth, setStatusBoth],
  );

  const fail = useCallback(
    (message: string) => {
      clearMaxTimer();
      setLevel(0);
      setEngineBoth(null);
      setStatusBoth('error');
      setError(message);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    },
    [clearMaxTimer, setEngineBoth, setStatusBoth],
  );

  // --- device engine events (no-op when native module is missing) ----------

  useSpeechRecognitionEvent('result', (raw) => {
    const event = raw as SpeechResultEvent;
    if (engineRef.current !== 'device' || cancelledRef.current) return;
    const transcript = event.results?.[0]?.transcript ?? '';
    if (!transcript) return;

    deviceTranscriptRef.current = transcript;
    if (!event.isFinal) onInterimRef.current?.(transcript);
  });

  useSpeechRecognitionEvent('volumechange', (raw) => {
    const event = raw as SpeechVolumeEvent;
    if (engineRef.current !== 'device') return;
    setLevel(normalizeVolume(event.value ?? 0));
  });

  useSpeechRecognitionEvent('end', () => {
    if (engineRef.current !== 'device') return;
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    finish(deviceTranscriptRef.current);
    deviceTranscriptRef.current = '';
  });

  useSpeechRecognitionEvent('error', (raw) => {
    const event = raw as SpeechErrorEvent;
    if (engineRef.current !== 'device') return;
    // "no-speech" just means silence — not worth an error banner.
    if (event.error === 'no-speech' || event.error === 'aborted') {
      finish(deviceTranscriptRef.current);
      deviceTranscriptRef.current = '';
      return;
    }
    log.warn('device recognition error', { error: event.error });
    fail("Couldn't catch that. Try again?");
  });

  // Mirror recorder metering into the waveform while the cloud engine runs.
  useEffect(() => {
    if (engineRef.current !== 'cloud' || !recorderState.isRecording) return;
    setLevel(normalizeMetering(recorderState.metering));
  }, [recorderState.isRecording, recorderState.metering]);

  // --- start ---------------------------------------------------------------

  const start = useCallback(async () => {
    if (statusRef.current !== 'idle' && statusRef.current !== 'error') return;

    setError(null);
    cancelledRef.current = false;
    deviceTranscriptRef.current = '';
    setStatusBoth('requesting-permission');

    const netState = await NetInfo.fetch();
    const online = netState.isConnected === true;
    const deviceAvailable = isDeviceRecognitionAvailable();
    // Prefer cloud when online and healthy. Fall back to device only when the
    // native module is linked (not Expo Go).
    const useCloud = online && isCloudHealthy();

    try {
      if (useCloud) {
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (!permission.granted) {
          fail('Microphone access is needed to record.');
          return;
        }

        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        });

        setEngineBoth('cloud');
        await recorder.prepareToRecordAsync();
        recorder.record();
      } else if (deviceAvailable) {
        const granted = await requestSpeechPermissions();
        if (!granted) {
          fail('Microphone access is needed to record.');
          return;
        }

        setEngineBoth('device');
        await startDeviceRecognition({ lang, preferOnDevice: !online });
        log.info('using on-device recognition', {
          reason: online ? 'cloud-degraded' : 'offline',
        });
      } else {
        fail(
          online
            ? 'Voice needs a development build for offline/fallback recognition.'
            : 'Connect to the internet, or use a development build for offline voice.',
        );
        return;
      }

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setStatusBoth('recording');

      clearMaxTimer();
      maxTimer.current = setTimeout(() => {
        log.info('max recording duration reached, stopping');
        stopRef.current();
      }, maxDurationMs);
    } catch (err) {
      log.error('failed to start voice capture', {
        message: err instanceof Error ? err.message : String(err),
      });
      fail("Couldn't start recording.");
    }
  }, [
    clearMaxTimer,
    fail,
    lang,
    maxDurationMs,
    recorder,
    setEngineBoth,
    setStatusBoth,
  ]);

  // --- stop ----------------------------------------------------------------

  const stopInternal = useCallback(async () => {
    if (statusRef.current !== 'recording') return;
    clearMaxTimer();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (engineRef.current === 'device') {
      // The 'end' event finishes the flow.
      stopDeviceRecognition();
      return;
    }

    setStatusBoth('transcribing');
    setLevel(0);

    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
    } catch (err) {
      log.error('failed to stop recorder', {
        message: err instanceof Error ? err.message : String(err),
      });
      fail("Couldn't finish that recording.");
      return;
    }

    if (!uri) {
      finish('');
      return;
    }

    try {
      const result = await api.transcribe({
        uri,
        mimeType: Platform.OS === 'ios' ? 'audio/m4a' : 'audio/mp4',
        filename: 'memory.m4a',
        language: lang.split('-')[0],
      });
      markCloudHealthy();
      finish(result.text ?? '');
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;

      // 503 = every key rate-limited or none configured. Not the user's
      // problem: route to on-device from here on, and tell them to retry.
      if (apiErr?.status === 503 || apiErr?.code === 'transcription_unavailable') {
        markCloudDegraded();
        log.warn('cloud transcription unavailable, degrading to on-device');
        fail('Voice is busy right now — tap again to use on-device.');
        return;
      }

      if (apiErr?.status === null) {
        // Network dropped mid-upload.
        markCloudDegraded();
        fail('Lost connection — tap again to use on-device.');
        return;
      }

      log.error('transcription failed', {
        status: apiErr?.status ?? null,
        code: apiErr?.code ?? 'unknown',
      });
      fail("Couldn't turn that into text.");
    }
  }, [clearMaxTimer, fail, finish, lang, recorder, setStatusBoth]);

  useEffect(() => {
    stopRef.current = () => void stopInternal();
  }, [stopInternal]);

  const cancel = useCallback(() => {
    clearMaxTimer();
    cancelledRef.current = true;
    deviceTranscriptRef.current = '';

    if (engineRef.current === 'device') {
      abortDeviceRecognition();
    } else if (engineRef.current === 'cloud') {
      void recorder.stop().catch(() => {});
    }

    setLevel(0);
    setEngineBoth(null);
    setStatusBoth('idle');
  }, [clearMaxTimer, recorder, setEngineBoth, setStatusBoth]);

  // Never leave the mic hot after the screen goes away.
  useEffect(
    () => () => {
      clearMaxTimer();
      abortDeviceRecognition();
    },
    [clearMaxTimer],
  );

  return {
    status,
    engine,
    level,
    error,
    isActive: status === 'recording' || status === 'transcribing',
    start: useCallback(() => void start(), [start]),
    stop: useCallback(() => void stopInternal(), [stopInternal]),
    cancel,
    dismissError: useCallback(() => {
      setError(null);
      setStatusBoth('idle');
    }, [setStatusBoth]),
  };
}
