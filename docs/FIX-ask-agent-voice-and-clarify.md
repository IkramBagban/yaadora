# Fix: Ask agent voice & over-eager clarify

_Date: 2026-07-04 · File touched: `packages/core/retrieval/agent.ts` (`systemPrompt`)_

## Problem

Reading a real `/ask` session in `logs/server.log`, Yaadora answered correctly but
**sounded like a records system, not a second brain.** Three concrete symptoms:

1. **Narrated its own machinery.** Nearly every answer ended with a meta-closer:
   _"that's the gist of the memories I've found"_, _"that's the information I have on
   file for you."_ A friend never says "here's what I have on file" — they just tell you.

2. **Formatted recall like a resume.** "What do you know about me?" returned a block of
   **bold field labels** (`Name:`, `Location & DOB:`, `Profession:`) and bullets. Reads
   like a CRM export, not someone who knows you.

3. **Clarified when it should have inferred.** "Any about travelling?" — an obvious
   topic follow-up to the previous question — triggered `clarify` mode ("What would you
   like to know more about?") instead of just searching travel memories. The user had to
   re-ask to get an answer.

Underlying cause: the system prompt said "warm, concise, second person" but never
**forbade** the anti-patterns above, and its clarify rule was permissive.

## Fix

Rewrote two sections of `systemPrompt()`:

- **"Answering — talk like a friend who remembers, not a database":** surface the memory,
  hide the plumbing; no meta-closers; default to conversational prose, not bulleted/bold
  "resume" recall unless the user asks for a list; match the user's energy and length;
  reference the memory layer **only** in the negative (found-nothing) case.
- **"Asking back (rare — prefer to infer)":** resolve follow-ups from context first; a
  plain topic follow-up ("any about travelling?") is **not** ambiguous — search and answer.
  Only `clarify` on genuine ambiguity (distinct people/things, un-inferable timeframe).
  Included the exact travelling example so the model can't miss it.

## Decisions & rationale

- **Prompt change, not code change.** The behavior is generative/stylistic; the retrieval,
  grounding, and citations were already correct. A prompt is the right lever — no need to
  post-process or restructure the agent.
- **Ban anti-patterns explicitly, with examples.** "Be warm and concise" clearly wasn't
  enough — the model still resume-dumped. Naming the exact phrases and formats to avoid
  (and the travelling case) is what actually moves behavior.
- **Keep the honest-negative behavior.** Only the meta-narration on _hits_ was the problem.
  Saying "nothing saved about that yet" on a _miss_ is good and was kept.
- **Left `answer.ts` untouched.** Its `streamGroundedAnswer` is exported but **not** wired
  into the `/ask` route (server uses `answerQuestion` in `agent.ts`), so editing it would
  change nothing live and risk drift. Revisit only if it re-enters the flow.
- **No few-shot examples added.** They'd bloat every request's tokens and risk the model
  parroting them. Principle-based rules generalize better here.

## Verifying

Restart `bun dev`, then in `/ask`:
- "What do you know about me?" → flowing prose, no bold labels, no "on file" closer.
- "any about travelling?" as a follow-up → searches + answers directly (no clarify).
