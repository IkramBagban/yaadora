# Second Brain v2 — Implementation Phases, Acceptance & Evals

> **Spec 3 of 3.** Spec 01 = vision and decisions. Spec 02 = architecture and data
> model (all §-references below point there). This file is the build sequence: what
> each phase contains, what "done" means, and the eval suite that keeps the
> anti-scenarios enforced forever.
>
> Phases ship in order; each is independently releasable and leaves the app better
> than before. Do not start a phase before the previous one's acceptance criteria
> pass. Lookup-grade before inference-grade is a product decision (Spec 01, D7),
> not a technical convenience — do not reorder.

---

## P0 — Foundations (schema + plumbing; no user-visible intelligence yet)

**Scope**
1. Migrations: `conversations`, `conversation_turns`, `rules`, `open_loops`,
   `surfacings`, `entity_edges`, `digests`, `push_tokens`; `users` additions
   (retention, quiet hours, budget) — Spec 02 §2.
2. Conversation persistence: new routes (§8), mobile switches from
   transcript-replay to `conversationId`; idle sweep → summary; retention cron.
3. Extraction additions (`standingRule`, `openLoops`, `resolvesLoop`) + pipeline
   upsert stages — §3.1. Conservative prompts; precision over recall.
4. `reprocess` backfill job + run it over existing data.
5. Consolidation additions: `entity_edges` materialization + digests — §3.2.
6. Context pack v1 (profile + digest + dated loops; no rules/nudges yet) — §4.
7. Rebuild-story CI test (§9) on a fixture user.

**Acceptance**
- Asking "what's coming up this week?" is answered from the pack without a search.
- Drop all derived tables on the fixture user → `reprocess` + consolidation
  reproduces them (CI green).
- Transcripts older than retention are gone; summaries and memories remain.
- p50 added latency from pack assembly < 150 ms.

---

## P1 — Standing rules (the founding fix)

**Scope:** rule matcher (§5.1) → pack injection; `rule_applied` ledger rows +
trace step; Rules screen in mobile (list, toggle, edit-as-correction, "applied N
times" transparency); extraction already emits rules from P0.

**Acceptance — the canonical regression test:** seed the user's real X-post rule;
send a generic draft + "I'm posting this on X, is it good?". The answer must (a)
apply the rule *visibly* (the four questions), (b) show the rule as a trace
step/receipt, (c) write a ledger row. Then ask an unrelated database question
mentioning "X" — the rule must NOT fire (matcher precision).

**Evals:** 8–10 rule-match cases (true fires: post drafting, "should I publish
this?"; true skips: platform mentioned incidentally, recall questions about
posting history). Target: 0 false fires, ≥8/10 true fires.

---

## P2 — Prospection (dates & foresight)

**Scope:** daily prospection job (§3.3); awareness pass v1 + gates 1–5 (§5.4) but
with only date/loop kinds enabled; nudge directive in pack + natural weaving;
receipts affordance + dismiss in mobile; Expo push + budget/quiet hours;
suggestion chips for unclaimed nudges.

**Acceptance:**
- Interview memory ("interview on the 24th, JavaScript, backend") mentioned once →
  T-3 days, first conversation of the day opens with a natural prep nudge with
  receipt; no conversation that day → one push, within budget, outside quiet hours.
- Anti-scenarios enforced *by test*: user mentioned the interview themselves this
  morning → silence (gate 2). Nudge dismissed → never again (gate 1). Mid-task
  turns (a pasted stack trace) → no nudge, candidate falls to conversation end
  (gate 3).

**Evals:** the birthday scenario, the "already known" case, the seam case, budget
exhaustion, quiet hours. Gates are pure functions — unit-test every rule in
`gates.ts` exhaustively; the LLM is only involved in seam judgment (eval that
separately with ~10 labeled conversations).

---

## P3 — Entity context (the graph pays off)

**Scope:** entity linker on turns; `assembleEntityContext` pre-fetch + tool (§5.2);
edge/loop nudge kinds enabled in awareness pass; Entity pages in mobile (profile,
current facts, open loops, edges, receipts; correction flow writes a correction
memory); edge review affordance ("is this right?") to catch linker merges/splits.

**Acceptance — scenario 1 end-to-end:** seeded Rahul history (co-founder fact,
equity loop open since March, job-hunting fact) + separate Aditya-is-hiring fact.
"Rahul's coming to Pune next week, thinking of meeting him" → response naturally
includes the unresolved equity loop and may connect the job hunt to Aditya, all
with receipts; second identical conversation a day later → equity nudge does NOT
repeat (ledger).

**Evals:** scenarios 1, 2 (single-mention Priya findable via search + entity
context), 3 (Rahul×Vikram edge visible in context), 7 (multi-entity decision
assembly); linker precision suite (two people named Urhan stay distinct).

---

## P4 — Held intentions (first inference-grade feature)

**Scope:** `commitment` loops get a contradiction check in the awareness pass:
current turn semantically conflicts with an open commitment → nudge candidate,
framed as a *question, never a judgment* ("Back in January you said X — has that
changed, or is this a runway thing?"). Tone constraints live in the weaving
directive; evidence = the commitment's source memory.

**Acceptance:** consulting scenario (January commitment vs. July offer) fires
once, as a question, with the January receipt; user says "it's deliberate" →
loop marked resolved → never fires again.

---

## P5 — Pattern surfacing

**Design refinement (2026-07-16, decided with the founder):** patterns surface
through **context + prompting**, not a forced gate-injected nudge. The priority
is that the agent brings a pattern up *naturally in its reply when it fits* —
that is a context-management + prompt-engineering problem, not a hardcoded
control-flow one. Suppression is preserved by making every "stay quiet" rule a
**filter on what enters context** rather than a gate on a forced directive.

**Scope (as built):**
- **Generation** — the whole-graph nightly pattern pass (§3.2.3) upgraded from a
  30-day episodic scan to serializing the user's entire graph (entities, edges,
  open loops, dated memory timeline) to the reasoning tier; insights stored as
  `origin='consolidation'` reflections with multi-provenance and an
  evidence-tied confidence (`min(modelConfidence, 0.5 + 0.1·receipts)` — a claim
  can't outrun its receipts). `packages/core/consolidation/index.ts`,
  `getGraphSnapshot` in `@repo/db`.
- **Selection** — `selectObservation` (`packages/core/retrieval/observations.ts`)
  picks **at most one** pattern to place in the context pack, only when ALL hold:
  insights toggle on; daily surfacing budget not spent; not dismissed-ever and
  not surfaced within the recent window (enforced in the SQL `NOT EXISTS` of
  `getSurfaceablePatternInsights`); ≥5 receipts AND confidence ≥0.8; and relevant
  to *this* turn by embedding distance. Returns null in the common case.
- **Surfacing** — a low-priority **Observations slot** in the context pack (first
  slot dropped under budget) with guidance: raise it only if it genuinely fits,
  as an observation + a question with receipts, never a verdict — otherwise stay
  silent. The agent decides (spec 01 D6: brain proposes context, voice decides).
- **Ledger bridge** — a non-terminal `note_observation(id)` agent tool writes the
  `pattern_nudge` surfacing row **iff the agent actually raises it** (the only
  reliable signal a naturally-woven pattern was shown). Biases to the safe
  direction: a forgotten call under-logs (→ over-suppress later), never the
  reverse. Dismissal flows through the existing `POST /surfacings/:id/reaction`
  receipt affordance (P2), which the SQL filter then honors forever.

**Acceptance:** five seeded stalled projects + a sixth starting → an eligible,
relevant, ≥5-receipt pattern is available and offered in context (agent surfaces
it with 5 receipts); four projects → silence (receipt threshold); dismissed →
never offered again; insights toggle off → silence. Covered by
`retrieval/observations.test.ts` (pure threshold/priority) and
`eval/observations.eval.test.ts` (DB-backed dismissal + recency + 5-vs-4 golden).

---

## P6 — Absence detection (last, deliberately)

**Scope:** consolidation computes per-entity mention baselines (frequency over
trailing year); flag entities whose mention rate dropped >90% for >6 months after
≥10 lifetime mentions; surfaced as the gentlest kind, max once ever per entity
unless re-engaged ("You haven't mentioned Ankit since November — everything okay
there?").

**Acceptance:** Ankit fixture fires once; dismissal is permanent; an entity with 3
lifetime mentions never fires regardless of gap.

---

## Cross-cutting: the eval suite

Lives in `packages/core/eval` (extends the existing harness). Two layers:

1. **Deterministic unit tests** — every gate rule, budget, cooldown, retention,
   rebuild story. These are cheap and run in CI on every PR.
2. **Golden scenarios** — each of the 9 scenarios and 7 anti-scenarios from Spec
   01 §3 becomes a fixture: seeded memories + a conversation script + assertions
   on behavior (fired / stayed silent / receipts present / ledger written).
   LLM-judged where prose quality matters (was the nudge *natural*?), assertion-
   judged for suppression (silence is checkable without a judge). Run nightly and
   before any prompt or model change. **A suppression regression blocks release;
   a missed-nudge regression files an issue.** That asymmetry is Spec 01 §2 as CI
   policy: quiet-and-right over helpful-and-wrong.

---

## Sequencing notes for coding agents

- work on main branch for the whole effort; no branch-per-agent (user preference).
- Each phase = one or more agent batches; agents commit code but never `.md`.
- Schema changes land as additive migrations; nothing drops or rewrites existing
  tables. `memories.raw_text` is untouchable — if a task seems to require editing
  it, the task is wrong; stop and flag.
- Prompts (extraction additions, awareness pass, matcher confirm) live beside the
  code they drive, with the eval cases that pin their behavior.
- When in doubt between surfacing and silence, ship silence and log the candidate
  to the ledger with a `suppressed_reason` — we would rather review what it
  *wanted* to say than apologize for what it said.
- never commit .mds, logs, .txt, .html

## Open questions (decide during the relevant phase, not now)

1. P2: exact seam heuristics beyond the LLM judgment (e.g., hard-block nudges when
   the turn contains a code block?). Start with LLM + code-block hard block; tune
   from ledger data.
2. P3: entity page editability scope — correct facts only, or also merge/split
   entities in-app? Start with corrections + "flag wrong link"; merge tooling when
   flags accumulate.
3. P5/P6: whether inference-grade nudges should be opt-in via a settings toggle at
   launch. Leaning yes ("Insights: on/off") — cheap trust insurance.
