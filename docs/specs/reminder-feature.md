# Spec — Reminders

_Design doc · 2026-07-04 · status: proposal_

> Prereq: `CONTEXT.md` + specs 01–03 + `02-conversational-and-episodic-memory.md`.
> This turns the reminder stub (schema `reminders.ts`, API 03 §1.3, the
> `TODO(reminders — later wave)` in `pipeline.ts`, and NEXT_FEATURES §5) into a
> real, first-class feature.

## Goal

A memory app that only answers questions is a filing cabinet. A second brain also
carries your *intentions* forward — it notices when you commit to something and
makes sure the commitment resurfaces at the right moment. Reminders are the
**prospective-memory** half of the system: the future-facing counterpart to the
episodic/semantic recall that already exists.

Two things must be true for this to feel like a brain and not a to-do app:

1. **Effortless creation.** You should almost never have to "file" a reminder. If
   you say "remind me to call the bank Friday" it just works; if you mention "I
   need to renew my passport soon" in passing, the app offers to remember it for
   you with one tap.
2. **Trustworthy, never nagging.** Suggestions are offered, never imposed. A
   dismissal is a signal the app learns from, so it stops suggesting things you
   keep waving away.

## Background: what already exists

- **`reminders` table** — `text`, `dueAt` (tz-aware), `status (pending|done|dismissed)`,
  `origin (manual|suggested)`, `sourceMemory` (provenance for AI-suggested), and a
  partial index on `(userId, dueAt) WHERE status='pending'`. This is the anchor.
- **`extraction.ts`** already emits an `intent { hasFutureAction, dueAt, text }`
  object, with `dueAt` **resolved to an absolute ISO** against the user's timezone.
  Reminders are meant to be suggested from this. Today it is thrown away
  (`pipeline.ts` §6 `TODO`).
- **Prospective episodes** (`02-conversational-and-episodic-memory.md` §B.3): "I'm
  flying to Tokyo next week" becomes a future-tense episode with a future
  `occurred_at`. That is a second, softer reminder signal.
- **BullMQ** (`packages/core/queues`) — the established async job pattern (ingestion +
  nightly consolidation), with retries, backoff, and repeatable cron jobs.
- **API contract** (03 §1.3) already sketches the reminder routes, including
  `POST /reminders/confirm` for one-tap acceptance and `POST /devices` for the Expo
  push token.

We reuse all of it. Nothing here is a parallel path.

## Core principle: the reminder is a *view*, not the source of truth

Per the schema comment and CONTEXT.md: the originating intent still lives as an
immutable `memory` + a `fact (factType='intent')`. A reminder is the **actionable
projection** of that intent — the scheduling/notification layer. This matters:

- `sourceMemory` (provenance) is **always set** for suggested reminders, and set for
  explicit ones too whenever the request arrives through capture (the raw text is
  still stored as a memory first). A manually-typed reminder with no memory behind
  it is the only case where `sourceMemory` is null.
- We never write back to `raw_text`. Editing a reminder's `text`/`dueAt` is editing
  the *view*, not the memory — fully allowed, exactly like `facts` are mutable while
  `memories` are not.

## Two creation paths (both first-class)

### Path A — Explicit ("remind me to …")

The user directly asks for a reminder, via the capture box or the `/ask` chat.

- Detected during extraction: `intent.hasFutureAction === true` **and** the raw text
  is imperative toward the assistant ("remind me…", "don't let me forget…"). The
  extraction prompt gains one field: `intent.explicitReminder: boolean`.
- Or via a direct `POST /reminders` (a dedicated "new reminder" UI affordance).
- Explicit reminders are created **confirmed** immediately (`status='scheduled'`) —
  the user already asked. No suggestion step.

### Path B — App-suggested / proactive

The app notices a latent commitment and *offers* a reminder. This is the feature
that makes it feel alive (NEXT_FEATURES §5).

**Detection signals** (all produced by the existing single extraction call, no extra
LLM cost):

- `intent.hasFutureAction === true` with a resolved `intent.dueAt` — the primary
  signal ("call mom this weekend", "renew passport soon").
- A **prospective episode**: `kind='event_future'` with a future `occurred_at` — "I'm
  flying to Tokyo next week" suggests a reminder *before* the trip.
- Soft-deadline language with **no** precise time ("soon", "next month") → suggest,
  but flag the time as approximate (see edge cases → ambiguous times).

**Suggestion UX:**

- The suggestion is **not** a persisted `pending` reminder. It's a lightweight,
  transient prompt attached to the capture/ask response: `reminderSuggestion { text,
  dueAt, dueAtIsApproximate, sourceMemory }` (already reserved on `/ask`'s `done`
  frame in 03 §1.2, and returned alongside `POST /memories`' response too).
- Rendered as a single dismissible chip: **"Set a reminder for this? · Fri 9am · [Set] [✕]"**.
- **Accept** → `POST /reminders/confirm { sourceMemory, text, dueAt }` → row created
  `status='scheduled'`, `origin='suggested'`. One tap.
- **Dismiss / ignore** → nothing is persisted as a reminder. But the dismissal *is*
  recorded (see below). Ignoring (never tapping) is treated as a soft dismissal after
  the suggestion scrolls out of view — we do not re-surface the same suggestion.

**Learning from dismissals (the anti-nag mechanism):**

- A dismissed suggestion writes a `reminder_suggestions` row: `{ userId, sourceMemory,
  factSignature, dismissedAt }`. `factSignature` is a normalized hash of the
  intent's predicate+object (e.g. `renew:passport`).
- Before surfacing any new suggestion, we check recent dismissals: if the user has
  dismissed a **similar** signature ≥ N times (default 2) in the trailing window,
  suppress the suggestion silently. Explicit "remind me…" always overrides — it's a
  request, not a guess.
- This is deliberately a per-signature suppression, not a global "stop suggesting"
  switch: the app learns *what kinds* of things you don't want reminded about, not
  that it should give up entirely.

## Data model — reconciling with `reminders.ts`

**Keep** the current columns (`id`, `userId`, `text`, `dueAt`, `status`, `origin`,
`sourceMemory`, `createdAt`, the partial due index). All changes below are
**additive + nullable** (zero migration risk, matching the episodic-memory doc's
discipline).

Proposed additive columns:

| column | type | purpose |
|---|---|---|
| `status` (widen values) | text | `suggested \| scheduled \| snoozed \| fired \| done \| dismissed` (was `pending\|done\|dismissed`; `pending`→`scheduled`, kept as alias in code) |
| `dueAtIsApproximate` | boolean, default false | soft deadline ("soon") — retrieval and delivery treat it gently (no hard fire) |
| `firedAt` | timestamptz, null | set when the notification is actually delivered (idempotency + audit) |
| `completedAt` | timestamptz, null | when marked done |
| `snoozedUntil` | timestamptz, null | next fire time while `status='snoozed'` |
| `recurrenceRule` | text, null | RFC-5545 RRULE subset (`FREQ=WEEKLY;BYDAY=FR`); null = one-shot |
| `recurrenceUntil` | timestamptz, null | optional end of a recurring series |
| `sourceFact` | uuid, null → facts.id | link to the `intent` fact, not just the memory (tighter provenance) |
| `jobId` | text, null | the BullMQ delayed-job id, for cancel/reschedule on edit |
| `timezone` | text, null | tz snapshot at creation, so a later user-tz change doesn't silently shift an absolute wall-clock intent |

Index change: the partial due index predicate becomes
`WHERE status IN ('scheduled','snoozed')` so the sweep/scan stays cheap. Add
`reminders_source_idx ON (userId, sourceMemory)` for dedup lookups.

New tiny table `reminder_suggestions` (the dismissal ledger described above) — never
holds a live reminder, only the learning signal.

## Lifecycle & states

```
                 (explicit)            ┌──── snooze ────┐
   intent ──► suggested ──accept──► scheduled ──fire──► fired ──► done
                  │  (Path B)            ▲   │             │
                  │                      └───┘ (recurring: │
              dismiss                    reschedule next)  └► done/dismissed
                  │
                  ▼
          reminder_suggestions (learning ledger; no reminder row)
```

- **suggested** — transient (Path B), lives only in the response payload + dismissal
  ledger. Not a durable reminder row unless accepted.
- **scheduled** — confirmed, a BullMQ delayed job (or sweep candidate) exists.
- **snoozed** — user pushed it out; `snoozedUntil` set, a new delayed job scheduled.
- **fired** — notification delivered (`firedAt` set). Awaits user action.
- **done** — completed (`completedAt` set). Recurring reminders spawn the **next**
  occurrence on completion/fire rather than terminating.
- **dismissed** — user killed it after firing (or declined a suggestion).

**Recurrence:** `recurrenceRule` drives it. When an occurrence fires, the worker
computes the next `dueAt` from the RRULE (respecting `timezone` + `recurrenceUntil`)
and schedules the next delayed job. The row is reused; we do not fan out a row per
occurrence (keeps history compact; the fired/done log lives in notification records
if we ever need per-occurrence audit).

**Snooze:** presets (10m / 1h / tonight / tomorrow-9am) + custom. Sets
`status='snoozed'`, `snoozedUntil`, cancels the old job, schedules a new one.

**Timezone:** `dueAt` is stored as an **absolute** `timestamptz` (extraction already
resolves it against the user's tz — same discipline as `occurred_at`). `timezone` is
snapshotted so recurring wall-clock intents ("every Friday 9am") stay anchored to the
user's local Friday-9am even across DST and tz changes; we recompute the next
absolute instant from RRULE + stored tz at each roll-forward.

## Scheduling / delivery mechanism

Reuse the BullMQ pattern. **Chosen approach: BullMQ delayed jobs, with a periodic
sweep as a safety net** (belt-and-suspenders, see Decisions).

- **New queue** `reminders` (name constant + connection via the existing
  `createRedisConnection()`).
- On `scheduled`/`snoozed`, enqueue a **delayed job** `{ reminderId }` with
  `delay = dueAt - now` (BullMQ caps very large delays; for far-future reminders the
  sweep handles them and we enqueue the delayed job only once inside the sweep
  horizon, e.g. < 30 days out). Store the returned `jobId` on the row so edits can
  cancel/replace it.
- **Sweep**: a repeatable job (like `scheduleNightlyConsolidation`) every ~1–5 min
  selects `status IN ('scheduled','snoozed') AND due_at <= now() AND fired_at IS NULL`
  and fires any the delayed job missed (Redis flush, clock skew, far-future rows now
  in range).
- **Firing** = (a) set `firedAt` in a **conditional UPDATE** (`WHERE fired_at IS NULL`)
  — this row-level guard is the **idempotency** key so the delayed job and the sweep
  can never double-notify; (b) send an **Expo push** to the user's registered device
  tokens (`POST /devices`), plus surface the reminder in-app; (c) if recurring,
  roll forward the next occurrence.
- **Retries**: standard exponential backoff (mirror `INGESTION_JOB_OPTS`). Push send
  failures retry; the conditional `firedAt` guard keeps retries idempotent.

## Retrieval / interaction

- **`GET /reminders?status=`** — the list surface (upcoming, grouped by day; overdue
  pinned on top). Uses the partial due index.
- **Conversational** — the reminder store is a retrieval source for `/ask`. "What do I
  have coming up?", "anything this week?", "remind me what I said about the passport"
  route to a reminders lookup (upcoming, ordered by `dueAt`) and the agent answers in
  natural language, citing the reminder + its `sourceMemory`. This slots into the
  existing `/ask` step trace as a new retrieval step kind (`reminders`), no new
  endpoint required.
- Creating/confirming/snoozing from within `/ask` reuses the same
  `POST /reminders/confirm` + `PATCH /reminders/:id` — the chat is just another client.

## Edge cases

- **Past-due at creation** — extraction resolved a `dueAt` already in the past ("call
  the bank yesterday"). Don't schedule silently; surface as an **immediate** overdue
  item and, for a suggestion, ask to clarify ("did you mean *next* Friday?").
- **Ambiguous / approximate time** — "renew passport soon", "next month". Set
  `dueAtIsApproximate=true`, pick a sensible default anchor (e.g. soon → +7d, this
  weekend → upcoming Saturday 10am), and make the suggestion chip show the guessed
  time so one tap can adjust it. In `/ask`, the agent may ask a clarifying question
  (reusing the existing clarify flow) before confirming.
- **Duplicate / dedup** — before creating a suggested reminder, check
  `reminders_source_idx` and fuzzy-match `(text, dueAt within N hours)` against live
  reminders for the user. A near-duplicate reinforces/updates the existing one rather
  than creating a second — mirroring fact reconciliation (dedup → reinforce).
- **Underlying task already completed** — if a later memory says "renewed my passport",
  extraction produces a superseding fact; a nightly pass (piggybacking on
  consolidation) can auto-resolve the matching open reminder to `done` and, if it
  hadn't fired yet, cancel its job. Conservative: only auto-complete on a high-confidence
  match, else leave it and let the fire prompt the user.
- **Deleted source memory** — `sourceMemory` FK. If a memory is deleted, keep the
  reminder (its `text`/`dueAt` are self-contained) but null the provenance link; the
  reminder is a view and outlives its source. Never cascade-delete a scheduled
  commitment out from under the user.
- **Redis / worker down at fire time** — the sweep catches missed fires on recovery;
  the `firedAt` guard prevents duplicate notifications once it comes back.

## Decisions & rationale

- **Suggestion is transient, not a `pending` row.** Persisting every detected intent as
  a live reminder would flood the list with things the user never asked for and make
  the app feel presumptuous. The durable reminder is created only on the one-tap
  accept. *Alternative rejected:* auto-create then auto-expire — noisier, and a stray
  push before expiry breaks trust.
- **Reminder = view over an immutable memory/fact.** Consistent with the whole app's
  episodic→semantic→actionable layering; keeps `raw_text` sacred and provenance
  intact. *Alternative rejected:* reminders as standalone source-of-truth rows — loses
  the audit trail and the "why did you remind me this?" explainability.
- **Delayed jobs + sweep, not sweep-only.** Delayed jobs give near-instant, precise
  firing; a pure minute-sweep adds latency and hammers the DB. But delays alone are
  fragile across Redis flushes and can't hold far-future reminders, so the sweep is
  the durable backstop. Both converge through the idempotent `firedAt` guard.
- **Learn from dismissals per-signature.** A global "stop suggesting" is too blunt; the
  value is a brain that learns *which* commitments you want tracked. *Alternative
  rejected:* ML ranking — overkill for v0; a dismissal-count threshold is legible and
  cheap.
- **Additive, nullable schema changes only.** Same zero-migration-risk discipline as
  the episodic-memory doc; no rewrite of the existing table.
- **Absolute `dueAt` + snapshotted `timezone`.** Reuses extraction's temporal
  resolution and survives DST / user-tz changes for recurring wall-clock intents.
- **No extra LLM cost for detection.** All signals come from the single existing
  extraction call — matches the app's "one cheap call per memory" cost discipline.

## Open questions / future work

- **Location / context reminders** ("remind me when I'm near the pharmacy") — out of
  scope for v0 (needs geofencing on device); the schema doesn't preclude a later
  `trigger` column.
- **Digest vs. per-item push.** Should many same-day reminders coalesce into a morning
  digest? Likely yes as volume grows; start per-item, add a digest window later.
- **Cross-reminder reasoning in consolidation** — "you set 3 reminders about the same
  trip" could merge. Defer to a later consolidation extension.
- **Notification channels beyond push** — email fallback if no device token; not v0.
- **Suppression window tuning** — the dismissal threshold (N=2) and window are guesses;
  instrument and tune once there's real usage.
