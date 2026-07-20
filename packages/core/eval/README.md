# Yaadora eval harness

Retrieval accuracy **is** the product (spec 02 §7), so it's tested like code. This
harness runs a golden set of memories + questions through the **real** HTTP
pipeline — ingestion, hybrid retrieval, rerank, grounded answer, refusal — and
reports whether accuracy held.

## What's here

| File | Purpose |
|---|---|
| `dataset.ts` | The golden life-history: ~30 first-person memories with stable `clientId`s and engineered traps (entity collisions, changing facts, reflections, intents). |
| `cases.ts` | Question → expected-`clientId` pairs across 10 categories, plus refusal cases with no valid answer. |
| `metrics.ts` | Pure `recall@k`, `MRR`, forbidden-hit helpers. |
| `runner.ts` | Seeds the dataset, waits for ingestion, runs every case through `POST /ask`, scores, reports, and exits non-zero if a gate fails. |
| `results/` | Timestamped JSON runs + `latest.json` for trend tracking (git-ignored). |

## Running it

The runner talks to a running stack over HTTP, so bring everything up first:

```sh
# 1. infra
docker compose up -d          # Postgres + Redis
# 2. app (separate terminals)
bun run --filter=server dev
bun run --filter=worker dev
# 3. eval (dev bootstrap — server must have AUTH_ALLOW_BOOTSTRAP=true)
AUTH_ALLOW_BOOTSTRAP=true AUTH_BOOTSTRAP_TOKEN=... bun run eval
```

Run a subset while iterating:

```sh
EVAL_ONLY=c-where-live,c-urhan-colleague AUTH_BOOTSTRAP_TOKEN=... bun run eval
```

> Product auth is Clerk. Eval uses the optional bootstrap bearer so the harness
> can seed/query without a real human session. Never enable bootstrap on a public VM.

## Config (env)

| Var | Default | Meaning |
|---|---|---|
| `YAADORA_SERVER_URL` | `http://localhost:3000` | Server base URL. |
| `AUTH_BOOTSTRAP_TOKEN` | — (**required**) | Bearer matching server bootstrap token (`AUTH_ALLOW_BOOTSTRAP=true`). |
| `EVAL_K` | `10` | Citation depth for recall@k / MRR. |
| `EVAL_INGEST_TIMEOUT` | `120` | Seconds to wait for async ingestion. |
| `EVAL_MIN_RECALL` | `0.8` | Gate: mean recall@k. |
| `EVAL_MIN_MRR` | `0.7` | Gate: mean reciprocal rank. |
| `EVAL_MIN_REFUSAL` | `0.9` | Gate: refusal accuracy. |
| `EVAL_ONLY` | — | Comma-separated case ids to run a subset. |

Exit code `0` = all gates passed, `1` = a gate failed, `2` = setup error
(server down, missing token). Wire it into CI so **no extraction/ranking/prompt
change merges without a green eval** (spec 02 §7).

## The traps, and why they matter

- **Two Urhans** (friend vs colleague) — guards entity linking against
  over-merging distinct people who share a name.
- **Mumbai→Pune, Northwind→Acme, sleep time** — supersession: a query for
  "now" must return the *current* fact and never the stale one (`forbid`).
- **Vue/Angular recruiter decoy** — a plausible-but-wrong neighbour the React
  decision must beat.
- **Refusal cases** (sister, car, savings) — the anti-hallucination guard: the
  only correct behaviour is "I don't have a memory about that."
- **Reflections** (no-fact entries) — should embed but yield zero atomic facts.

## Caveats

- **Temporal cases** (`c-last-tuesday`) are only fully trustworthy if the seed
  is *backdated*. Seeding all at once resolves "last Tuesday" against today.
  Treat temporal numbers as indicative until a backdated seed path exists (see
  the testing spec).
- The harness scores **citations**, i.e. what the app grounded its answer on.
  Answer-text quality (tone, completeness) is a separate, LLM-graded layer noted
  in the testing spec as future work.

See `docs/specs/testing-and-eval.md` for the full strategy.
