# Reminder recurrence — design spec

**Date:** 2026-07-15
**Status:** Approved, in implementation

## Goal

Make reminders support recurrence and give them a real manual scheduling UI.
Today a reminder is a single `dueAt` timestamp with 6 relative preset chips and no
way to pick an exact time or a repeating schedule. Users want:

- one-shot ("after an hour", "tomorrow 3pm"),
- daily at a time ("every day 4pm"),
- weekly on chosen days ("every Monday 8pm").

## Decisions (locked)

1. **Delivery: notifications, not alarms.** Keep the existing on-device local
   notifications (`expo-notifications`); no server push, no alarm entitlements.
2. **Recurrence scope: `once` + `daily` + `weekly`.** No monthly/interval/RRULE.
3. **Picker: native** (`@react-native-community/datetimepicker`), keeping the
   quick presets for the fast one-shot path.
4. **Rules live server-side.** The reminder row stores the recurrence rule;
   the client reads it to schedule repeating OS triggers.
5. **Agent recurrence deferred.** The agent keeps emitting one-shot suggestions.

## Data model / shared contract

Weekday numbers use JS `Date.getDay()` convention: **0 = Sunday … 6 = Saturday**.

```ts
type Recurrence = 'once' | 'daily' | 'weekly';

interface Reminder {
  id: string;
  text: string;
  // once: exact fire time. daily/weekly: next occurrence; its clock time
  // (hour:minute) is the recurring time-of-day.
  dueAt: string;
  recurrence: Recurrence;   // NEW — default 'once'
  weekdays: number[] | null; // NEW — 0..6, only for 'weekly'; null otherwise
  status: 'suggested' | 'pending' | 'done' | 'dismissed';
  origin: 'manual' | 'suggested';
  sourceMemory: string | null;
  createdAt: string;
}
```

`dueAt` does double duty (once = fire time; recurring = time-of-day carrier +
next occurrence). Rejected alternative: a separate `timeOfDay` column — it
duplicates what `dueAt` already carries.

### DB (`packages/db/schema/reminders.ts`)

Add, both backward-compatible (existing rows become plain one-shots):

- `recurrence text not null default 'once'`
- `weekdays integer[]` (nullable) — Drizzle `integer("weekdays").array()`.

Generate the migration with `cd packages/db && bun run generate` (drizzle-kit).

### API (`apps/server/src/routes/reminders.ts`)

- `ConfirmBody` and `UpdateBody` gain `recurrence: z.enum([...]).default('once')`
  and `weekdays: z.array(z.number().int().min(0).max(6)).optional()`.
- Validation: `weekly` requires a non-empty `weekdays`; `once`/`daily` store
  `weekdays = null`. On update to a non-weekly recurrence, clear `weekdays`.
- `reminderCols` returns `recurrence` and `weekdays`.
- The capture pipeline that inserts *suggested* reminders is unchanged — the DB
  default (`once`, null) applies.

## Client scheduling (`apps/mobile/src/lib/notifications.ts`)

`scheduleReminder` branches on `recurrence`, reading hour/minute from `dueAt` in
**device-local** time:

- `once`   → `DateTrigger` at `dueAt` (skip if past — current behavior).
- `daily`  → `DailyTrigger { hour, minute, repeats: true }`.
- `weekly` → one `WeeklyTrigger { weekday: wd + 1, hour, minute, repeats: true }`
  **per** weekday (Expo weekday is 1=Sun…7=Sat, so map `jsDay + 1`).

Because weekly produces multiple OS notifications per reminder, the persisted map
becomes `reminderId → notifId[]`. `cancelScheduled(id)` cancels all ids for the
reminder; `syncScheduled(items)` reconciles as today. **Public signatures of
`scheduleReminder` / `cancelScheduled` / `syncScheduled` stay the same** (they
take a full `Reminder` / id / `Reminder[]`), so callers don't change.

## Composer UI (`apps/mobile/src/components/ReminderComposer.tsx` + screen)

- Segmented control: **Once / Daily / Weekly**.
- **Once**: existing quick presets + a "Pick date & time" row → native picker.
- **Daily**: native time picker.
- **Weekly**: `S M T W T F S` multi-select chips + native time picker.
- Plain-English summary line: *"Every Mon & Thu at 8:00 PM."*
- `ComposerTarget` and `onCreate`/`onUpdate` carry `{ text, dueAt, recurrence,
  weekdays }`. `useReminders.create/update` pass them through to `api`.
- `ReminderCard` (in `reminders.tsx`) gains a small recurrence badge
  ("Daily", "Mon, Thu"). Add label helpers in `src/lib/time.ts`.

## Out of scope

Agent-inferred recurrence, monthly/yearly/interval, alarm delivery,
end-dates/occurrence caps, and the unbuilt server-side BullMQ firing.

## Work split (parallel)

- **Shared contract (done first):** `api/types.ts`, `api/client.ts`, this doc.
- **Agent A — server/DB:** `packages/db/schema/reminders.ts`, generated migration,
  `apps/server/src/routes/reminders.ts`.
- **Agent B — scheduling:** `apps/mobile/src/lib/notifications.ts`.
- **Agent C — mobile UI + hook:** `ReminderComposer.tsx`, `app/(tabs)/reminders.tsx`,
  `src/reminders/useReminders.ts`, `src/lib/time.ts`, `package.json` (add picker).

File sets are disjoint; agents interface only through the types above and the
stable `scheduleReminder/cancelScheduled/syncScheduled` signatures.
