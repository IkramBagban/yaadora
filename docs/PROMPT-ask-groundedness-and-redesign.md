# Ask Screen — Fixes for Opus

Yaadora is a personal memory app: Bun server, Expo mobile. The Ask agent lives in
`packages/core/retrieval/agent.ts` (`systemPrompt()`), and the conversation UI is
`apps/mobile/app/(tabs)/ask.tsx` + `apps/mobile/src/components/AskExchange.tsx`. Three problems,
treat as separate changes.

**1. Agent fabricates familiarity, then contradicts itself.** When the agent skips memory search
for casual chat (correct — e.g. "I'm bored"), it still phrases suggestions as if it knows the user
personally: "that hobby you've been putting off," "the story you've been meaning to read" —
despite never having searched anything. When the user then asks "what hobby?", the agent runs
`search_memories`, finds nothing, and flatly replies with the canned refusal — contradicting its
own previous message. Fix the prompt so that when it hasn't searched, suggestions stay genuinely
generic instead of implying specific personal knowledge, and so that a follow-up asking it to
clarify its *own* wording ("what hobby do you mean?") gets answered conversationally from context
instead of being run through a memory search and a refusal.

**2. Stop the hardcoded refusal line — it makes the agent sound like a bot.** The prompt currently
forces the model to output one exact canned sentence, verbatim, every time a real search comes up
empty ("I don't have a memory about that."), which is why it reads so robotic and repetitive. Let
the model say "I don't have anything on that in your memory" in its own natural words each time,
varying phrasing like a person would, while keeping the same honest meaning — never invent, never
guess. Keep the literal `REFUSAL_TEXT` constant (`packages/core/retrieval/answer.ts`) in the code
only as a last-resort fallback for the rare case the model streams back nothing at all — not as
text it's told to recite.

**3. Redesign the Ask conversation screen.** Right now every turn — plain chat, grounded answer,
refusal — renders identically, so there's no way to tell which is which at a glance, and the
user's question vs. the agent's answer are distinguished only by typography (serif italic vs.
sans), both left-aligned. Redesign so you can immediately tell who's speaking and what kind of
answer you got (sourced/grounded, plain conversational, or "found nothing"), while keeping the
app's existing "ink & paper" editorial identity — warm neutral palette, serif italic for the
user's words, no colored chat bubbles or avatars (`apps/mobile/src/theme/tokens.ts`). Suggestion:
keep the current typography but right-align the user's question and left-align the agent's answer
for a clear structural cue, rather than full bubble-style chat — but use your judgment if
something else reads better. Keep streaming, retry, clarify quick-replies, and citation
tap-through all working as they do now.
