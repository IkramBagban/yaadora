# Yaadora eval harness

Retrieval accuracy **and** honest ingestion are the product. This harness
measures both against a golden life-history, over the **real** HTTP stack
(server + worker + models + Postgres). No mocks.

## Commands

| Command | What it tests |
|---------|----------------|
| `bun run eval:ingest` | **Add / capture pipeline** — seed memories, wait for worker, assert facts, entities, open loops, reminders, standing rules, supersession, entity collision |
| `bun run eval:retrieve` | **Ask / retrieval pipeline** — citation recall/MRR, refusal, answer-text quality, multi-hop, reminder/open-loop questions |
| `bun run eval` / `eval:all` | **Full pipeline** — ingest first, then retrieve on the same seeded state |

Always run retrieve **after** ingest when you care about end-to-end health.
Retrieve alone reuses `packages/core/eval/results/eval-state.json` from the last
ingest (or re-seeds if you set `EVAL_RETRIEVE_RESEED=1`).

## Prerequisites

```sh
# 1. infra
docker compose up -d

# 2. app (separate terminals)
AUTH_ALLOW_BOOTSTRAP=true AUTH_BOOTSTRAP_TOKEN=dev-token \
  bun run --filter=server dev
bun run --filter=worker dev

# 3. eval
AUTH_BOOTSTRAP_TOKEN=dev-token bun run eval
# or separately:
AUTH_BOOTSTRAP_TOKEN=dev-token bun run eval:ingest
AUTH_BOOTSTRAP_TOKEN=dev-token bun run eval:retrieve
```

Product auth is Clerk. Eval uses bootstrap bearer — never enable bootstrap on a
public VM.

## What each stage covers

### Ingest (`eval:ingest`)

1. `POST /memories` for every row in `dataset.ts` (stable `clientId`s)
2. Wait until status is `processed` / `failed`
3. `GET /memories/:id` → facts, entities, openLoops, reminders, rules
4. Score per-memory expectations (`ingest-expectations.ts`)
5. Score global graph checks (two Urhans, supersession Acme/Pune, bank reminder, standing rule)
6. Write `results/eval-state.json` + JSON report

Categories: `processed`, `facts`, `entities`, `reflection`, `open-loop`,
`reminder`, `rule`, `supersession`, `entity-collision`, `graph`.

### Retrieve (`eval:retrieve`)

1. Load clientId → memoryId map from state
2. `POST /ask` (SSE) for every case in `retrieve-cases.ts`
3. Score:
   - **recall@k / MRR** on citations
   - **forbid** (stale/decoy must not be cited)
   - **refusal** honesty
   - **answerMustMatch / answerMustNotMatch** (answer quality without LLM-judge)
4. Write JSON report

Categories: `recall`, `entity-completeness`, `entity-collision`, `supersession`,
`factual`, `preference`, `refusal`, `temporal`, `reasoning`, `reminder`,
`open-loop`, `multi-hop`, `answer-quality`.

## Config (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `YAADORA_SERVER_URL` | `http://localhost:3000` | Server base |
| `AUTH_BOOTSTRAP_TOKEN` | — **required** | Bootstrap bearer |
| `EVAL_K` | `10` | Citation depth for recall@k / MRR |
| `EVAL_INGEST_TIMEOUT` | `180` | Seconds to wait for processing |
| `EVAL_ONLY` | — | Comma-separated case / clientId / global id subset |
| `EVAL_MIN_INGEST_PASS` | `0.85` | Ingest pass-rate gate |
| `EVAL_REQUIRE_ALL_PROCESSED` | `1` | Fail if any memory failed ingestion |
| `EVAL_MIN_RECALL` | `0.8` | Mean recall@k |
| `EVAL_MIN_MRR` | `0.7` | Mean reciprocal rank |
| `EVAL_MIN_REFUSAL` | `0.9` | Refusal accuracy |
| `EVAL_MIN_ANSWER_QUALITY` | `0.75` | Fraction of cases with answer patterns ok |
| `EVAL_MIN_RETRIEVE_PASS` | `0.8` | Overall retrieve case pass-rate |
| `EVAL_RETRIEVE_RESEED` | `0` | If `1`, retrieve seeds dataset when state missing |

Exit codes: `0` = gates passed, `1` = gate failed, `2` = setup error.

## Results

Written under `packages/core/eval/results/` (gitignored recommended):

- `eval-state.json` — clientId map for retrieve-after-ingest
- `eval-ingest-*.json` / `latest-ingest.json`
- `eval-retrieve-*.json` / `latest-retrieve.json`
- `eval-all-*.json` / `latest.json`

## Layout

```
eval/
  dataset.ts                 # golden memories
  ingest-expectations.ts     # ingestion asserts
  retrieve-cases.ts          # ask cases (+ cases.ts re-export)
  run-ingest.ts
  run-retrieve.ts
  run-all.ts
  runner.ts                  # → run-all (compat)
  lib/                       # http, state, report, config
  metrics.ts
  *.eval.test.ts             # focused unit/DB evals (bun test)
```

## Focused unit/DB evals

Still run via `bun test` in `@repo/core` (rules, prospection, follow-ups, seams,
entity-context, etc.). Those are fast subsystem tests; the HTTP runners above are
the product-level scorecard.

## Caveats

- **Temporal** cases need backdated `occurredAt` for full trust (seed-at-once
  resolves “last Tuesday” against today).
- **Answer quality** uses regex patterns, not an LLM judge — catches groundedness
  and decoys; not full prose style.
- **Single bootstrap user** — multi-user isolation is not in this harness yet.
- Grow the set by harvesting real failures, not bulk-generating cases.

See `docs/specs/testing-and-eval.md` for the long-term pyramid.
