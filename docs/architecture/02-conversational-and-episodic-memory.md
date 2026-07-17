# Architecture: Conversational capture & first-class episodic memory

_Design doc · 2026-07-04 · status: proposal_

## Goal

Two related upgrades to Yaadora's memory:

1. **Capture from conversation.** Today memories are only created by explicit
   `POST /memories` (`source: manual | voice | import`). The `/ask` chat flow is
   read-only. But people reveal the most valuable things in passing ("I'm flying
   to Tokyo next week," "my manager is Priya now," "I hate early meetings"). Those
   should become memories without the user stopping to file them.
2. **Make episodic memory first-class**, not just a side effect of fact extraction.

The hard part of (1) is **not saving everything** — a brain doesn't. Most of what
is said is transient. The system must filter noise and keep only what's worth
remembering.

## Background: what already exists

The bones are good and we reuse them.

- **`memories`** — immutable, verbatim `raw_text` + resolved `occurred_at`. This is
  already the **episodic ground truth** store.
- **`facts`** — mutable, bitemporal (`valid_from`/`valid_to`), with supersession,
  conflict flags, and provenance back to the source memory. This is the **semantic**
  layer distilled from episodes.
- **`extraction.ts`** already classifies `types: [episodic, semantic, preference,
  intent, reflection]`, resolves `occurredAt`, extracts entities, and decomposes
  into atomic facts — in one cheap LLM call.
- **Ingestion pipeline** (worker): `extract → temporal resolve → entity link →
  reconcile/insert facts → embed → processed`, with dedup & supersession.

So we do **not** build a parallel path. We add a front-door (conversation capture +
noise gate) and enrich the episodic representation.

## Episodic vs. semantic — the model we commit to

- **Episodic memory** = a specific event tied to *when / where / who / what*, kept as
  a narrative unit and re-experienceable ("had dinner with Priya in Tokyo, talked Q3").
  It can be **past** ("I went…"), **future/prospective** ("I'm going…"), or
  **recurring** ("every Friday standup").
- **Semantic memory** = decontextualized durable facts distilled from episodes
  ("user's manager = Priya", "user dislikes early meetings").

Episodes are the *source of record*; facts are *distilled* from them. One episode
produces **both**: we keep the event intact **and** write the facts it implies. This
mirrors both cognitive science and current agent-memory practice (episodic = raw
records with temporal flow; semantic = generalized facts extracted from them).

**Why keep the episode, not just the facts:** atomizing "dinner with Priya in Tokyo,
discussed Q3" into facts loses the gestalt. Episodic recall ("what did I do last
weekend?") needs the narrative and its when/where/who — which the atomized facts can't
reconstruct.

## Part A — Capturing from conversation (with a noise filter)

Flow, run **asynchronously after the ask response streams** so recall is never slowed:

```
user turn (in /ask)
   │
   ▼
[1] SALIENCE GATE  (cheap, fast model, ~1 boolean call)   ── drop ──►  (nothing saved)
   │  keep?
   ▼
[2] enqueue conversation-memory  (raw_text = user's words, source="conversation", provisional)
   │
   ▼
[3] EXISTING INGESTION WORKER
      extract (episodic/semantic + tense + occurredAt + entities + facts + intent)
      → write episodic memory row (event kept intact)
      → distil + reconcile semantic facts (dedup / supersession / provenance)
   │
   ▼
[4] SURFACE TO USER  ("noted you're headed to Tokyo") + one-tap undo
```

### [1] The noise filter — "like the brain does it"

The brain holds everything in working memory briefly and only **consolidates** the
salient, novel, emotional, or repeated into long-term store. We model that with a
**cheap-first, two-stage** gate so the expensive extraction never runs on chatter:

- **Gate (per user turn, fast model, cheap):** "Does this turn contain anything worth
  remembering long-term?" → boolean + reason.
  - **Reject:** questions to the assistant, small talk, acknowledgements, meta
    ("what do you know about me"), transient states ("I'm bored right now"),
    hypotheticals, and pure commands.
  - **Keep:** durable facts, preferences, relationships, decisions, and events
    (past **or** future), plans, commitments.
- **Salience signals** the gate leans on: novelty (not already known — a quick
  retrieval dedup), first-person reference ("I/my"), specificity, named
  entities/times, emotional weight, and future commitment. Only turns above threshold
  proceed to full extraction.
- **Only user turns.** Never extract from the assistant's replies, and never re-ingest
  a fact the agent just *recalled* — otherwise memory feeds on its own output (a
  feedback loop that re-saves what it just retrieved).

This keeps cost near-zero on the 90% of turns that are noise, matching the existing
"one cheap call per memory" discipline.

## Part B — Making episodic memory best-in-class

Enhancements, all **additive** (no rewrite of the immutable store):

1. **Episode kept as a unit.** The conversational episode's `raw_text` stays sacred and
   verbatim — that *is* the episodic record. Facts are distilled alongside, linked by
   provenance, exactly as today.
2. **Episode metadata (new, nullable columns on `memories`):**
   - `tense` / `kind`: `event_past | event_future | recurring | state | note` — lets
     retrieval and reminders treat "happened" vs "will happen" vs "recurs" differently.
   - `title`: a short recall handle ("Tokyo trip") for scannable episodic results.
   - participants & place come from existing **entity links** (person / place); we can
     promote a `location_entity_id` later if needed.
3. **Prospective (future) episodes.** "I'm going to Tokyo next week" resolves to a
   **future** `occurred_at` + `intent.dueAt` + a reminder suggestion. It's retrievable
   ("when am I going to Tokyo?") and, once the date passes, it's simply a past episode —
   no data mutation, because `occurred_at` is absolute and retrieval interprets it
   relative to *now*.
4. **Episodic-aware retrieval.** `understanding.ts` already classifies queries as
   `episodic | temporal | …`. Episodic/temporal queries should **bias toward the
   `memories` store** (event narratives ordered by `occurred_at`) rather than atomized
   facts. "What did I do last weekend" → return events, not fact fragments.
5. **Reflection in nightly consolidation.** The consolidation queue already exists.
   Extend it to synthesize higher-order semantic insight from clusters of episodes
   ("you meet Priya about roadmap most Fridays") — episodic → semantic distillation over
   time, the way memories generalize.

## Key decisions & rationale

- **Reuse the ingestion pipeline via `source: "conversation"`, not a parallel path.**
  Dedup, supersession, provenance, and embeddings are already solved. We only add the
  gate + the hook in the ask route.
- **Two-stage gate (cheap boolean before expensive extraction).** Cost discipline, and
  it mirrors the brain's transient→consolidate model. A single expensive extraction on
  every chat turn would be wasteful and noisy.
- **Async, after the response streams.** Memory capture must never add latency to recall.
- **Keep `raw_text` sacred; distil facts from it.** Matches the episodic→semantic split
  in both cognitive science and agent-memory literature, and preserves an audit trail.
- **Preserve episodes as units, don't only atomize.** Episodic recall needs
  what/where/when/who as a narrative; atomized facts can't rebuild it.
- **Additive schema (nullable columns + new `source`/`tense` values).** Zero migration
  risk to the immutable episodic store.
- **Lower default confidence for conversation-sourced facts** than for deliberately
  captured ones — inference from chat is weaker evidence than an explicit note.
- **Surface + undo.** Silent capture erodes trust the moment it saves something wrong;
  a light "noted …" with undo keeps the user in control.

## Open questions / tradeoffs

- **Per-turn gate vs. end-of-session summarize.** Per-turn is timely (enables reminders,
  immediate "noted") but can fragment multi-turn episodes; end-of-session gives cleaner
  episode boundaries and is cheaper. **Recommendation:** per-turn gate for capture, then
  let nightly consolidation *stitch* related turns into a single episode.
- **Location as entity vs. explicit field.** Start with the place entity link; promote to
  a column only if episodic "where" queries demand it.
- **Correction turns.** "No, it's Wednesday not Tuesday" should *supersede* via the
  existing fact reconciliation, not create a new contradictory episode — the gate should
  route corrections into the supersession path.

## Sources

- [Semantic vs Episodic vs Procedural Memory in AI Agents (Medium)](https://medium.com/womenintechnology/semantic-vs-episodic-vs-procedural-memory-in-ai-agents-and-why-you-need-all-three-8479cd1c7ba6)
- [Types of AI Agent Memory: Episodic, Semantic, Procedural (Atlan)](https://atlan.com/know/types-of-ai-agent-memory/)
- [Architecture and Orchestration of Memory Systems in AI Agents (Analytics Vidhya)](https://www.analyticsvidhya.com/blog/2026/04/memory-systems-in-ai-agents/)
- [AriGraph: Knowledge Graph World Models with Episodic Memory for LLM Agents (arXiv)](https://arxiv.org/pdf/2407.04363)
