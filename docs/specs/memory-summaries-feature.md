# Spec — Memory Summaries (Daily / Weekly / Monthly Recaps)

_Design doc · 2026-07-04 · status: proposal_

> Prereq: `CONTEXT.md` + specs 01–03 + `02-conversational-and-episodic-memory.md`.
> This turns NEXT_FEATURES §4 ("Daily / weekly / monthly memory summaries") into a
> real feature. It reuses the nightly consolidation infra (02 §5), the BullMQ
> repeatable-job pattern, the Expo push channel (`POST /devices`, from the reminders
> spec), and the reasoning-tier model policy (CONTEXT §4).

## Goal

Capture and Ask cover *depositing* and *querying* memory. Summaries cover the third
human habit the app is missing: **reflection**. At the end of a day, a week, a month,
a person naturally looks back — "what was on my mind lately?" A summary is Yaadora
gently doing that for you: a short, warm recap of what you captured over a window,
written like someone who knows you picking out the highlights — **not a report, not a
dump of every entry.**

Three things must be true for this to feel like a second brain and not a notification
spammer:

1. **It's a pull, not a push — by default off.** Per NEXT_FEATURES §4, the user
   decides when they want to look back. Summaries are always available on demand, and
   *never* delivered on a schedule unless the user explicitly turns that on.
2. **When scheduled delivery is on, the user is fully in control.** They choose the
   window(s) — daily, weekly, monthly — and the exact time of day each arrives. They
   can change or turn it off any time, in one place.
3. **It must never feel like noise.** The UI is quiet, accessible, and skippable; the
   tone is gentle and human; an empty or thin period produces nothing (or a soft
   note), never a hollow "you have 0 memories" card. If a recap would be annoying to
   receive, we don't send it.

## Scope decision: pull-first, scheduled delivery is opt-in

NEXT_FEATURES §4 says summaries are a **pull** ("rather than it being pushed on them
automatically… by default it would be off"). The founder also wants an **opt-in
schedule** — enable it, pick the window, pick the time. These reconcile cleanly into
one model:

- **On-demand recap (always available, no setting).** Anywhere the user can ask for a
  look-back — a "Recap" affordance and the natural-language route in `/ask` ("what did
  I get up to this week?") — generates a summary for the chosen window, right then.
  This is the default experience and needs no configuration.
- **Scheduled recap (off by default, opt-in).** In Settings the user can turn on one
  or more standing recaps, each with a window (day / week / month) and a delivery time.
  When on, the same summary is generated and delivered as a quiet notification / inbox
  card at that time. Turning every schedule off returns the app to pure pull — which is
  the shipped default.

So: **pull is the product; push is a preference.** Nothing is ever pushed until the
user opts in.

## What a summary *is* (and is not)

- **Is:** a short reflective narrative (a few sentences to a short paragraph, window-
  dependent) that surfaces the *highlights* — the notable events, recurring themes,
  people who came up, decisions or intentions, and the overall shape/mood of the
  period. It reads like a friend recapping, e.g. _"A busier week than usual — a lot of
  it was the apartment search and two long calls with Sara. You also finally started
  the Spanish lessons you'd mentioned wanting to."_
- **Is not:** an exhaustive list of every entry, a metrics dashboard ("12 memories, 4
  people"), or anything the user has to *read past* to get value. Counts and lists are
  available on tap-through, never the headline.
- **Grounded, always.** Same rule as every Yaadora surface (CONTEXT §5): the summary is
  built **only** from the user's real memories in the window, and **cites** them
  (tap a highlight → the source memory). It must **never invent** an event. A thin
  period yields a short, honest recap, not a padded one.

## Generation mechanism

Reuse the consolidation pattern; do **not** invent a parallel job system.

- **Model tier.** The narrative is written by the **reasoning tier** (Claude
  Opus/Sonnet-class, per CONTEXT §4) — this is prose the user reads, quality matters —
  but it runs over a **compact, pre-retrieved context**, not the raw memory table, so
  cost stays bounded.
- **Input assembly (cheap, deterministic, no LLM).** For a window `[from, to)` scoped
  by `user_id`, pull: the window's `memories` (episodic), the `facts` derived from them
  (already extracted — themes, intents, entities), the entities that recur, and any
  `consolidation`-origin pattern insights whose provenance falls in the window. This is
  hard SQL over existing indexes (time + `user_id` predicates, per CONTEXT §5.4), not a
  vector sweep.
- **One summarization call** turns that structured context into the narrative + a small
  set of **highlight references** (each pointing at a `memory` id for provenance). The
  prompt's job is *selection and warmth*, not retrieval — retrieval already happened.
- **On-demand path:** generated synchronously on request (with a lightweight loading
  state); cache the result (see data model) so re-opening the same window is instant
  and free.
- **Scheduled path:** a **BullMQ repeatable job** per active schedule (mirroring
  `scheduleNightlyConsolidation`) enqueues generation ahead of the user's chosen
  delivery time, then delivers. Generation and delivery are separate steps so a
  delivery retry never regenerates.
- **Never blocks capture.** Same discipline as everywhere else — summarization is a
  read-side/worker concern; the write path is untouched.

## Data model (additive, nullable — zero migration risk)

Matches the episodic-memory doc's discipline: new tables + additive columns only,
nothing rewritten.

**New table `summaries`** — a *cache/view* over the immutable log, fully rebuildable
(like entity profiles). Never a source of truth.

| column | type | purpose |
|---|---|---|
| `id` | uuid pk | |
| `userId` | uuid, not null | scope (every row scoped by user, CONTEXT §5.4) |
| `period` | text | `day \| week \| month` |
| `windowStart` | timestamptz | inclusive start (in the user's tz at generation) |
| `windowEnd` | timestamptz | exclusive end |
| `narrative` | text | the generated recap prose |
| `highlights` | jsonb, null | ordered `[{ text, sourceMemory }]` for tap-through + citations |
| `sourceMemoryIds` | uuid[], null | provenance: every memory the recap drew on |
| `memoryCount` | int | entries in the window (for the "thin period" logic, not shown as a headline) |
| `model` | text, null | which model/tier wrote it (audit + regenerate-on-change) |
| `origin` | text | `on_demand \| scheduled` |
| `timezone` | text | tz snapshot at generation (window boundaries are wall-clock) |
| `createdAt` | timestamptz default now() | |

Unique-ish cache key: `(userId, period, windowStart)` — one canonical summary per
window; regeneration replaces it. Index `summaries_user_period_idx (userId, period,
windowStart desc)` for the history list.

**New table `summary_schedules`** — the opt-in preferences (the "settings" the founder
asked for). Empty = the default off state.

| column | type | purpose |
|---|---|---|
| `id` | uuid pk | |
| `userId` | uuid, not null | |
| `period` | text | `day \| week \| month` |
| `enabled` | boolean, default false | **off by default** |
| `deliverAtLocal` | text | wall-clock time, e.g. `"08:00"` (user-chosen) |
| `deliverDow` | int, null | weekly: day-of-week (0–6); null otherwise |
| `deliverDom` | int, null | monthly: day-of-month (1–28, clamped); null otherwise |
| `channel` | text, default `push` | `push \| inapp` (email later) |
| `timezone` | text | tz the wall-clock time is anchored to |
| `jobId` | text, null | the BullMQ repeatable-job id, for reschedule/cancel on edit |
| `updatedAt` | timestamptz | |

A user can have at most one schedule row per `period` (unique `(userId, period)`).
Changing a schedule cancels its old repeatable job and registers a new one, keyed off
`jobId` — same edit discipline as reminders.

No changes to `memories` / `facts` / `entities`. Summaries only read them.

## Settings & UX (the part that must not feel ugly or annoying)

The founder's hard requirements: **accessible, not ugly, never shown in a way the user
resents.** Concretely:

**Where the controls live.** One "Memory summaries" section in Settings. Off by
default — the very first thing the user sees is a single explanatory line and a master
toggle, not a wall of options. Turning it on progressively reveals the per-window
choices (daily / weekly / monthly), each with its own on/off and a native time picker
("Deliver at ___"). Weekly adds a day picker; monthly a date picker. Nothing is
pre-checked. This is the whole surface — no sub-menus, no jargon.

**The on-demand entry point.** A quiet "Recap" affordance (e.g. on the timeline /
memories screen) with a day / week / month selector. It is *there when wanted, silent
when not* — no badge, no unread count, no dot demanding attention. Reflection is
invited, never nagged.

**How a scheduled recap arrives.** As a single, gentle notification and a matching
inbox/timeline card — **one per delivery, never a burst.** If several windows land on
the same morning (daily + weekly on a Monday), they **coalesce into one** card, not
three notifications. The notification copy is soft ("A look back at your week"), never
alarm-like.

**Reading a recap.** A calm, generous-whitespace card: the narrative in comfortable
reading type, highlights as subtle tappable lines (tap → source memory, closing the
provenance loop), and a de-emphasized "based on N memories" footnote. No charts, no
dense stats up top. The user can dismiss it in one action, and dismissing is
frictionless and remembered (it won't re-surface).

**Accessibility (non-negotiable, WCAG-minded):**

- Full **screen-reader** support: the card is a labeled region; the narrative reads as
  a single coherent passage; each highlight is a labeled link stating its destination
  ("Highlight: started Spanish lessons, opens source memory"). The Settings toggles and
  time pickers use native accessible controls with clear labels and state.
- **Contrast & type:** text meets AA contrast; respects the OS **Dynamic Type / font
  scaling** — the card reflows, never truncates the recap. Never rely on color alone to
  convey meaning.
- **Motion & focus:** honor **reduce-motion**; any entrance animation degrades to a
  fade. Logical focus order; time pickers are keyboard/switch-control operable.
- **Reduced clutter:** because the surface is deliberately minimal, there's little to
  get lost in — which is itself an accessibility win.

**The anti-annoyance rules (make it never "hated to see"):**

- **Off by default.** No recap is ever delivered until the user opts in.
- **Empty/thin windows produce nothing on a schedule.** If the window has zero
  memories, no notification is sent (silence beats an empty card). A very thin window
  (below a small threshold) delivers a short, honest one-liner only if the user opted
  in, otherwise nothing.
- **One delivery, coalesced.** Never multiple notifications for overlapping windows.
- **Frictionless off-ramp.** Every scheduled recap's card has an inline "Adjust /
  turn off" shortcut straight to its setting — the user is always one tap from making
  it stop.
- **Quiet hours respected.** Delivery honors the OS's Do-Not-Disturb / quiet hours; a
  recap scheduled inside DND surfaces as a silent inbox card, not a buzz.

## Edge cases

- **Empty window** — no memories in range. On-demand: a warm empty state ("Nothing
  captured this week — nothing to look back on yet."). Scheduled: send **nothing**.
- **Thin window** — 1–2 memories. Don't pad into false narrative; produce a single
  honest sentence, and for scheduled delivery only send if the user opted in
  (otherwise skip, per anti-annoyance rules).
- **Timezone / travel** — window boundaries are **wall-clock in the snapshotted tz**
  ("this week" = the user's local week). Store `timezone`; if the user changes tz, new
  summaries use the new tz, past cached ones keep theirs. A day spent across a DST
  boundary uses local calendar days, not fixed 24h blocks.
- **Month length / clamped day-of-month** — `deliverDom` clamps to 28 to guarantee a
  valid delivery every month; "end of month" is a future nicety, not v0.
- **Memory deleted after summary generation** — the summary is a cached view. A
  highlight whose `sourceMemory` was deleted drops its tap-through link (null the
  provenance) but the narrative text stands; never cascade-delete. Regeneration will
  simply omit it.
- **Regeneration / staleness** — if a memory in the window is added or edited after a
  cached summary exists (rare for past windows; common for "today" mid-day), mark the
  cache stale and regenerate on next view. The current/open window is never treated as
  final until it closes.
- **Duplicate scheduled fire** — the repeatable job could fire twice (worker restart).
  Delivery is guarded by a `(userId, period, windowStart, delivered)` idempotency check
  — the same window is delivered at most once, mirroring the reminders `firedAt` guard.
- **Model/quality drift** — because summaries are rebuildable from the immutable log
  (CONTEXT §1 core principle), a prompt or model change can re-generate any window; the
  `model` column records what wrote each cached recap.

## Retrieval / interaction surface (API)

- **`GET /summaries?period=&window=`** — return the cached summary for a window, or
  generate-then-cache on miss. Powers the on-demand Recap surface.
- **`GET /summaries?period=&limit=`** — the history list (past recaps), newest first,
  off `summaries_user_period_idx`.
- **`GET /summary-schedules` / `PUT /summary-schedules`** — read and update the opt-in
  preferences; a `PUT` (re)registers or cancels the BullMQ repeatable job.
- **Conversational** — "what did I do this week?", "recap my month" route through `/ask`
  to summary generation as a retrieval step kind (`summary`), and the agent answers in
  natural language citing the source memories. No separate endpoint; the chat is just
  another client, same as reminders.

## Decisions & rationale

- **Pull-first, push opt-in.** Honors NEXT_FEATURES §4 (pull, default off) while
  satisfying the founder's schedule-and-time controls as a *preference*, not a default.
  *Alternative rejected:* on by default with a morning digest — presumptuous, and the
  fastest way to make a reflective feature feel like spam.
- **Narrative over dashboard.** The value is *reflection*, not analytics. A warm
  paragraph beats a stats card; counts live on tap-through. *Alternative rejected:*
  metrics-forward summary — cold, and against the app's "intelligence is the product,
  not the UI" stance.
- **Reasoning tier over compact pre-retrieved context.** User-facing prose deserves the
  good model, but running it over structured, already-extracted facts (not raw rows)
  keeps cost bounded and quality high — reusing extraction/consolidation output rather
  than re-deriving it.
- **Summary = rebuildable cache/view.** Consistent with entity profiles and the whole
  episodic→semantic→derived layering; `raw_text` stays sacred, provenance intact,
  regen-on-change is trivial. *Alternative rejected:* summaries as durable source rows —
  loses rebuildability and the "why is this in my recap?" explainability.
- **Coalesced, quiet, DND-respecting delivery.** One gentle notification per delivery,
  merged across overlapping windows, silent in quiet hours — the difference between a
  feature users keep on and one they immediately disable.
- **Additive, nullable schema only.** Same zero-migration-risk discipline as the
  episodic-memory and reminder docs.

## Open questions / future work

- **Email / digest channel** beyond push — deferred (mirrors the reminders spec).
- **"On this day" / long-range recall** ("a year ago you…") — a natural sibling once
  there's a year of data; the `summaries` shape doesn't preclude it.
- **Mood/theme trends across periods** — "you mentioned feeling stretched three weeks
  running" — powerful but should piggyback on consolidation pattern-mining (02 §5), not
  the per-window summarizer; defer.
- **Personalized cadence learning** — if a user always reads the weekly but never the
  daily, quietly suggest turning the daily off. Instrument first, tune later.
- **Length/voice controls** — let power users pick "short vs. fuller" or a tone. Not
  v0; default to short-and-warm.
