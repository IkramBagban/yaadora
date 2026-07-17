# Spec — Testing & Evaluation

_Design doc · 2026-07-04 · status: in progress (harness v1 landed)_

> Prereq: `CONTEXT.md` + specs 01–03 + `02-ingestion-and-retrieval.md` §7 (Evaluation).
> This turns "evaluation from day one" from an aspiration into a runnable harness
> and a plan for the layers still missing.

## Why this exists

Yaadora's whole value rests on one principle (CONTEXT.md): **never invent a
memory; all structure is derived and rebuildable; every derived fact carries
provenance.** A memory app that hallucinates is dead on arrival. So testing here
is not "does the button work" — it is a continuous, measurable check that the
system stays *honest, grounded, and current* as the extraction prompts, ranking,
and models change underneath it.

Spec 02 §7 already mandates it: _"Every change to extraction, ranking, or prompts
must run the eval set before merge. No retrieval PR merges on vibes."_ Until now
there was no eval set and no runner. This spec defines both, and the layers we
still owe.

## The pyramid

Testing spans five layers, cheapest/fastest at the base:

| Layer | What it checks | Status |
|---|---|---|
| **1. Pipeline unit tests** | Deterministic sub-steps in isolation: temporal resolution, entity linking, supersession, provenance invariant. | _planned_ |
| **2. Golden retrieval eval** | End-to-end recall / grounding / refusal over an authored dataset. | **landed** (`@repo/core/eval`) |
| **3. Reasoning eval** | Decision-mode answers grounded in the user's own history. | partial (one case; LLM-graded layer planned) |
| **4. Reminder / prospective eval** | Explicit + suggested reminders, `dueAt` correctness, dismissal learning. | _planned_ |
| **5. Non-functional** | Sub-second capture, offline outbox exactly-once, consolidation idempotency. | _planned_ |

The rest of this doc details each layer. Layer 2 is real today; the others are
scoped here so they can be built in order.

## Layer 2 — the golden retrieval eval (landed)

Lives in `packages/core/eval`, run with `bun run eval`. It seeds an authored
life-history through the real `POST /memories` path, waits for async ingestion,
then runs each question through the real `POST /ask` SSE pipeline and scores the
citations. Testing over HTTP (not mocks) means the number reflects the actual
product, including the worker, Postgres, and the models.

### The dataset

A small, hand-verifiable, fictional single-user log (`dataset.ts`). Every entry
has a stable `clientId` the eval cases reference; the runner maps `clientId →`
the server-generated memory id after seeding. Entries are engineered around the
known failure modes:

- **Entity collision** — two different people named "Urhan" (a college friend and
  a work colleague). Guards linking against *over-merge*.
- **Supersession** — Mumbai→Pune, Northwind→Acme, sleep 11pm→past-midnight. A
  query about "now" must return the current fact and never the stale one.
- **Decoy** — a Vue/Angular recruiter mention the React decision must beat.
- **Reflection** — no-fact journal lines that must embed but yield zero atomic
  facts (the anti-fabrication case at ingestion).
- **Intent** — implicit and explicit future actions that feed reminders.

### The cases and categories

`cases.ts` holds `question → expected clientIds`, sliced into ten categories:
`recall`, `entity-completeness`, `entity-collision`, `supersession`, `factual`,
`preference`, `refusal`, `temporal`, `reasoning`, `reminder`. Two case shapes:

- **Retrieval** — `expect[]` must appear in the answer's citations; optional
  `forbid[]` (a stale fact or decoy) must *not*. A forbidden hit is a correctness
  failure even when recall looks fine — that's how supersession is enforced.
- **Refusal** — `expectRefusal: true`; the only correct behaviour is declining
  ("I don't have a memory about that"), asking back, or citing nothing. Anything
  else is a fabrication and fails.

### Metrics and gates

The runner reports, overall and per category:

| Metric | Meaning | Default gate |
|---|---|---|
| **recall@k** | fraction of expected memories cited in the top-k | `≥ 0.80` |
| **MRR** | mean reciprocal rank of the first expected memory | `≥ 0.70` |
| **refusal accuracy** | fraction of no-answer questions correctly declined | `≥ 0.90` |
| **forbidden hits** | stale/decoy memories that leaked into answers | `0` |

Exit code is `0` only when every gate passes, `1` on a gate miss, `2` on setup
error. That makes it a CI gate: wire `bun run eval` into the pipeline so a
retrieval-affecting PR cannot merge red. Each run also writes timestamped JSON to
`eval/results/` (plus `latest.json`) for trend tracking.

### Harvesting real failures

The authored set is the floor, not the ceiling. The `eval_cases` table (spec 01
§3.7, now implemented in `@repo/db`) is the durable harvest target: whenever a
real query retrieves the wrong thing, capture it as a row and it becomes a
permanent regression guard. The authored dataset catches designed-for failures;
harvested cases catch the ones reality invents.

## Layer 1 — pipeline unit tests (planned, highest priority next)

The golden eval proves the system end-to-end but is coarse: when it regresses,
you still have to bisect *which* stage broke. Unit tests over the deterministic
seams make failures legible and run in milliseconds without the full stack.

- **Temporal resolution** — "yesterday", "last Friday", "next week", "in 3 days"
  against a fixed `now` and several timezones incl. a DST boundary. Assert the
  resolved absolute `occurredAt`. This is where silent, timezone-shaped bugs live.
- **Entity linking** — feed known mentions and assert the *fragmentation* case
  (40 "Urhan" mentions → one node) and the *over-merge* case (two Urhans → two
  nodes) both resolve correctly. Mock only the embedding/LLM disambiguation call.
- **Supersession** — ingest "lives in Mumbai" then "moved to Pune"; assert the old
  fact gets `validTo` set, the new one is current, and nothing is deleted.
- **Provenance invariant** — a property test: after ingesting any memory, *every*
  derived fact has a non-null `sourceMemory`. This should hard-fail the build.

These need a test runner (`bun test`) and a seam to inject a deterministic model
(the AI-SDK provider layer already abstracts this — inject a stub provider).

## Layer 3 — reasoning eval (partial)

Decision mode ("should I take this job?") must weigh the user's *own* past, not
give generic advice. The golden set has one such case (`c-decision-job`) scored
on whether it grounds in the relevant job memories. The missing piece is
**answer-quality grading**: citation-scoring proves the app looked at the right
memories, but not that the prose is faithful and useful. Plan: an LLM-as-judge
rubric (faithfulness to sources, no unsupported claims, surfaces relevant
contradictions) run over the streamed answer text, reported alongside recall.

## Layer 4 — reminder / prospective-memory eval (planned)

Once the reminder feature (see `docs/specs/reminder-feature.md`) lands:

- **Explicit** ("remind me to call the bank Friday") → a reminder with a correct
  tz-aware `dueAt`.
- **Suggested** ("I need to renew my passport soon") → an *offered*, never
  auto-created, reminder with `sourceMemory` provenance set.
- **Never nag** — a dismissed suggestion is learned from and stops recurring.
- **dueAt correctness** across timezones and relative phrasings.

## Layer 5 — non-functional (planned)

- **Capture latency** — `POST /memories` returns in well under a second even when
  the LLM tier is slow or down; ingestion is async, so capture must never block.
- **Offline outbox** — write while offline, reconnect, assert exactly-once sync
  via `clientId` (no duplicate memories on retry). Tests the idempotency path.
- **Consolidation idempotency** — wipe the derived layer, re-run consolidation
  from the immutable raw log, and assert profiles/facts/entities rebuild
  consistently. This is the direct test of "all structure is rebuildable."

## Known caveats (v1)

- **Temporal cases** are only fully trustworthy with a *backdated* seed. Seeding
  all at once resolves "last Tuesday" against today. Adding a seed path that sets
  historical `occurredAt` (e.g. honouring `occurredHint` as an authoritative
  backdate in a test-only mode) is the fix.
- **Citations, not prose.** Layer 2 scores what the answer is grounded on, not
  how well it reads. Answer-quality grading is Layer 3's job.
- **Single user.** The harness runs against the bootstrapped user. Multi-user
  isolation (no cross-`user_id` leakage) deserves its own dedicated case set.

## Build order

1. **Layer 1 unit tests** — fast, deterministic, make regressions legible.
2. **Backdated seed** — unlocks trustworthy temporal scoring.
3. **Layer 3 answer-grading** — faithfulness rubric over reasoning answers.
4. **Layers 4–5** — as reminders and offline sync mature.
