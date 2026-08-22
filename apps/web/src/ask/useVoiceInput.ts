import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL } from '../lib/env'
import { ApiError, authHeaders } from '../api/client'
import type { TranscribeResponse } from '../api/types'

export type VoiceState = 'idle' | 'starting' | 'recording' | 'uploading' | 'denied'

/** Server drops anything shorter than this (transcribe.ts MIN_AUDIO_BYTES). */
const MIN_AUDIO_BYTES = 512

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
] as const

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime))
}

function extensionFor(mime: string | undefined): string {
  if (mime?.includes('mp4')) return 'm4a'
  return 'webm'
}

interface VoiceInputOptions {
  /** transcript lands in the (editable) composer draft */
  onTranscript: (text: string) => void
  onError: (message: string) => void
}

/**
 * Push-to-talk voice input: MediaRecorder captures a clip, POST /transcribe
 * turns it into text. Mic denial degrades to a disabled button (the keyboard
 * still works); nothing is stored server-side by /transcribe.
 */
export function useVoiceInput({ onTranscript, onError }: VoiceInputOptions) {
  const [state, setState] = useState<VoiceState>('idle')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const supported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'

  useEffect(() => {
    const recorder = recorderRef.current
    const stream = streamRef.current
    return () => {
      if (recorder?.state === 'recording') recorder.stop()
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const upload = useCallback(
    async (blob: Blob, mime: string | undefined) => {
      // A tap shorter than the server's floor — nothing was said.
      if (blob.size < MIN_AUDIO_BYTES) {
        setState('idle')
        return
      }
      setState('uploading')
      try {
        const form = new FormData()
        form.append('audio', blob, `voice-note.${extensionFor(mime)}`)
        const auth = await authHeaders()
        const res = await fetch(`${API_URL}/transcribe`, {
          method: 'POST',
          headers: auth,
          body: form,
        })
        if (!res.ok) {
          throw new ApiError(
            res.status === 503
              ? 'Speech-to-text is unavailable right now.'
              : 'Could not transcribe that recording.',
            'transcribe_failed',
            res.status,
          )
        }
        const data = (await res.json()) as TranscribeResponse
        if (data.text) onTranscript(data.text)
      } catch {
        onError('Voice input failed. Try again or type instead.')
      } finally {
        setState('idle')
      }
    },
    [onError, onTranscript],
  )

  const start = useCallback(async () => {
    if (!supported || state !== 'idle') return
    setState('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = pickMime()
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        void upload(new Blob(chunks, { type: recorder.mimeType || mime }), recorder.mimeType || mime)
      }
      recorderRef.current = recorder
      recorder.start()
      setState('recording')
    } catch {
      // NotAllowedError (or no mic): degrade quietly, the composer still types.
      setState('denied')
      onError('Microphone access was denied.')
    }
  }, [onError, state, supported, upload])

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  const toggle = useCallback(() => {
    if (state === 'recording') stop()
    else void start()
  }, [start, state, stop])

  return { state, supported, toggle }
}
