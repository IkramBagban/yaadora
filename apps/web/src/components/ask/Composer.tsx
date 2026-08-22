import { useEffect, useRef } from 'react'
import { ArrowUp, Mic, MicOff, Square } from 'lucide-react'
import { useVoiceInput } from '../../ask/useVoiceInput'
import { cn } from '../../lib/cn'
import { Spinner } from '../ui/Spinner'

/** Server cap on a turn (apps/server/src/routes/conversations.ts). */
const MAX_TURN_CHARS = 4000

interface ComposerProps {
  streaming: boolean
  draft: string
  onDraftChange: (text: string) => void
  onSend: (text: string) => void
  onStop: () => void
  /** transient notices (voice errors) surfaced as toasts by the page */
  onNotice: (message: string) => void
}

/**
 * Ask composer: Enter sends, Shift+Enter breaks a line. While a turn streams
 * the send action becomes Stop (abort keeps any partial answer). The mic
 * records via MediaRecorder and POSTs /transcribe; the transcript lands in
 * this same editable draft.
 */
export function Composer({
  streaming,
  draft,
  onDraftChange,
  onSend,
  onStop,
  onNotice,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  /** latest draft for the async voice-transcript callback */
  const draftRef = useRef(draft)

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  const voice = useVoiceInput({
    onTranscript: (text) => {
      const current = draftRef.current
      onDraftChange(current.trim().length > 0 ? `${current.trimEnd()} ${text}` : text)
      textareaRef.current?.focus()
    },
    onError: onNotice,
  })

  // Grow with content, capped so long drafts scroll inside the box.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [draft])

  const canSend = !streaming && draft.trim().length > 0

  const submit = () => {
    if (!canSend) return
    onSend(draft)
    onDraftChange('')
  }

  const micBusy = voice.state === 'starting' || voice.state === 'uploading'
  const micDenied = voice.state === 'denied' || !voice.supported

  return (
    <div className="rounded-lg border border-hairline bg-surface p-sm shadow-xs">
      <div className="flex items-end gap-sm">
        {micDenied ? (
          <button
            type="button"
            disabled
            title="Microphone unavailable"
            aria-label="Voice input unavailable"
            className="flex size-10 shrink-0 items-center justify-center rounded-md text-ink3 opacity-50"
          >
            <MicOff size={18} />
          </button>
        ) : (
          <button
            type="button"
            onClick={voice.toggle}
            disabled={micBusy}
            aria-label={voice.state === 'recording' ? 'Stop recording' : 'Record voice input'}
            aria-pressed={voice.state === 'recording'}
            title={voice.state === 'recording' ? 'Stop recording' : 'Dictate your question'}
            className={cn(
              'relative flex size-10 shrink-0 items-center justify-center rounded-md transition-colors',
              voice.state === 'recording'
                ? 'bg-accent-soft text-accent'
                : 'text-ink2 hover:bg-surface-alt hover:text-ink',
            )}
          >
            {micBusy ? <Spinner size={16} /> : <Mic size={18} />}
            {voice.state === 'recording' && (
              <span className="absolute -right-1 -top-1 size-2.5 animate-pulse rounded-full bg-danger" />
            )}
          </button>
        )}

        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          rows={1}
          maxLength={MAX_TURN_CHARS}
          placeholder={
            voice.state === 'recording' ? 'Listening…' : 'Ask anything you’ve told me…'
          }
          aria-label="Your question"
          className="max-h-[200px] min-h-10 flex-1 resize-none bg-transparent px-xs py-sm text-body text-ink placeholder:text-ink3 focus:outline-none"
        />

        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-alt text-ink transition-colors hover:bg-accent-soft hover:text-accent"
          >
            <Square size={14} className="fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="Send question"
            className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent text-on-accent transition-all hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>

      <div className="flex h-5 items-center justify-between px-sm">
        <span className="text-micro text-ink3">
          {voice.state === 'recording'
            ? 'Recording — tap the mic to stop'
            : voice.state === 'uploading'
              ? 'Transcribing…'
              : ''}
        </span>
        {draft.length > MAX_TURN_CHARS - 500 && (
          <span className="ml-auto text-micro text-ink3">
            {draft.length}/{MAX_TURN_CHARS}
          </span>
        )}
      </div>
    </div>
  )
}
