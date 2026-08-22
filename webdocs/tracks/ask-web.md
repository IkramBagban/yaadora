# Track: Ask on web (`A-*`)

Web chat over the memory system. Must consume the SAME SSE frames as mobile — read `apps/mobile/src/api/types.ts` and `apps/server/src/routes/ask.ts`, `conversations.ts`, plus existing client helpers in `apps/mobile/src/api/sse.ts`.

## Checklist

- [ ] **A-1** Conversation sidebar — AC: list conversations, new-conversation button, active highlight, rename/delete optional.
- [ ] **A-2** SSE thread parity — AC: stream replies consuming identical frame types as mobile; render partials/frames without flicker; reconnect on drop.
- [ ] **A-3** Citations drawer — AC: answers show citation chips; clicking opens drawer listing source memories; each links to memory detail.
- [ ] **A-4** Tool trace — AC: collapsible panel showing tool calls made during answering (names + args summary); hidden by default.
- [ ] **A-5** Nudge engage/dismiss — AC: proactive nudges appear inline in thread; engage/dismiss posts back and updates UI state.
- [ ] **A-6** Voice input — AC: MediaRecorder capture → upload to `/transcribe`; transcript fills composer; graceful fallback when mic denied.

## Learnings

(gotcha → fix → date)
