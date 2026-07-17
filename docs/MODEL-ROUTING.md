# Model Routing — which model for which task

> For the **coding agents** building Yaadora. Not the app's runtime LLMs (those are in spec 02).

## Cost & power (high → low)

| Model | Power | Cost | Use for |
|---|---|---|---|
| **Fable 5** (`claude-fable-5`) | highest | highest | only the hardest, ambiguous, high-blast-radius work |
| **Opus 4.8** (`claude-opus-4-8`) | high | mid | default for real eng work — accuracy-critical, multi-file |
| **Gemini 3.1 Pro** | good | lowest | routine, well-specified, high-volume grunt work |

**Rule of thumb:** default **Opus**. Drop to **Gemini** when the task is fully specced + low-risk.
Escalate to **Fable** only when Opus is genuinely stuck or the decision is expensive to get wrong.

## By task type

| Task | Model | Why |
|---|---|---|
| Ingestion extraction prompt + zod schema | **Fable** | Core of the product; subtle; accuracy = everything |
| Entity linking / disambiguation logic | **Fable / Opus** | Ambiguous, correctness-critical |
| Hybrid retrieval SQL + reranking | **Opus** | Hard but well-defined once spec'd |
| Groundedness guard, decision-mode loop | **Opus** | Reasoning-heavy, must not hallucinate |
| Consolidation + pattern mining | **Opus** | Non-trivial logic, rebuildable so lower blast radius |
| Eval harness | **Opus** | Gets it right once, reused everywhere |
| Architecture / spec / tricky debugging | **Fable / Opus** | Judgment calls, wide context |
| Drizzle table boilerplate (from spec 01) | **Gemini** | Fully spec'd, mechanical |
| `Bun.serve` router + zod validation | **Gemini** | Standard CRUD plumbing |
| Reminders CRUD, API client, offline queue | **Gemini** | Routine, low-risk |
| Mobile Add/Ask screens, styling | **Gemini** | Well-defined UI from spec 03 |
| `docker-compose.yml`, Expo push wiring, config | **Gemini** | Boilerplate |
| Tests for the above | **Gemini** | Mechanical once behavior is defined |

## Escalate to Fable when

- Opus loops/fails twice on the same problem.
- Task is under-specified + high blast radius (schema/retrieval design changes).
- A wrong answer is expensive to undo (data model, migrations touching prod).

## Keep on Gemini when

- The spec fully defines inputs/outputs; agent just types it out.
- Isolated, easily reverted, cheap to re-run.
- Give it `CONTEXT.md` + the exact spec section as its brief.
