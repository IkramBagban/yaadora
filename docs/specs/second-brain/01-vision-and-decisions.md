# Second Brain v2 — Vision & Decisions

> **Spec 1 of 3.** Read this first. It explains *what* we are building and *why every
> decision was made*. Spec 02 covers the architecture and data model. Spec 03 covers
> the implementation phases, acceptance criteria, and evals.
>
> Audience: the founder, and any coding agent implementing Spec 03. After reading
> all three files you should be able to build, extend, or debate any part of this
> system without needing the original conversation.

---

## 1. The failure that started this

The user saved a standing rule into Yaadora, via the Add screen:

> *"Write good, long posts and post on social media. Don't take too much help from
> AI. Spend even 1–2 hours writing a post to include feelings and realness. Before
> posting anything, ask yourself: Will it help anybody? Will it make people engage
> with it? Will it create a positive impression of me for someone looking for great
> engineers and founders? Will people like it?"*

Days later they pasted a generic draft into Ask and said *"I'm posting this on X —
is it good?"* The agent gave generic writing feedback. It never looked at the rule.

This failed at **three independent layers** — fixing any one alone would not have
saved it:

1. **The search policy is recall-shaped.** The Ask system prompt tells the model to
   search only when "answering requires recalling something specific from the
   user's past." *"Is this post good?"* is a task, not a recall question, so by the
   prompt's own rules the agent correctly didn't search. Nothing anywhere asks
   *"does the user have standing rules about the thing they're currently doing?"*
2. **Search wouldn't have reliably found it anyway.** Retrieval ranks candidates by
   relevance to the question text; the reranker scores for *answering the
   question*, not for *governing behavior on this task*. A rule's trigger
   ("posting on X") is only incidentally similar to a "review this draft" query.
3. **There is no memory class for rules.** Extraction can tag a memory as
   `preference`, but a preference-fact ("user prefers long posts") and a standing
   rule ("*when I'm about to post, hold me to these four questions*") were stored
   and treated identically. A rule is **procedural memory**: its contract is
   "inject me into the agent's *instructions* whenever the task matches my
   condition" — a different trigger, and a different placement (system prompt, not
   tool results).

**The generalized diagnosis:** Yaadora does not have a retrieval-quality problem.
It has a *"memory only speaks when spoken to"* problem. The only path into the
model's context is a search triggered by a recall-shaped question. Everything in
this spec exists to add the missing doorways.

---

## 2. Product thesis

Yaadora stays deliberately small: **Capture, Ask, Remind.** This redesign adds no
fourth feature. It deepens the three until they compound into a second brain that:

- remembers everything you deliberately give it (already true),
- understands your life — people, projects, goals, commitments, dates — well
  enough to reason over it (partially true),
- and **speaks up on its own when it should, and only when it should** (new).

The nine scenarios in the product brief (Rahul/equity, finding Priya, the
Vikram connection, held intentions, week-three pattern, the missing Ankit,
Bangalore decision, the X-post rules, interview prep) are *examples* of capability
classes — there are thousands of possible scenarios. We therefore build
**doorways, not scenario hacks** (§4). Any future scenario is a combination of the
four doorways.

**The anti-scenarios are the product.** "Quiet and right over helpful and wrong."
One wrong confident inference about someone's own life destroys trust permanently.
So the engineering bar for proactivity is **precision with receipts**: every
proactive statement is traceable to tappable source memories, suppression rules
are enforced by *code and state* (not prompt vibes), and the system is biased to
silence whenever support is thin. Depth of understanding compounds from years of
being right, not from being ambitious in week one.

---

## 3. Scenario classes → what handles them

| Scenario (from the brief) | Class | Handled by |
|---|---|---|
| 8 — X-post standing rules | Task-matched policy | **Rules doorway** (P1) |
| 9 — Interview prep, 3 days out | Date-matched foresight | **Time doorway / prospection** (P2) |
| Birthday nudge mid-conversation | Date-matched + seam | Prospection + awareness pass (P2) |
| 1 — Rahul visit: equity loop + Aditya hiring | Entity-matched assembly | **Graph doorway** (P3) |
| 2 — Finding Priya (mentioned once, 3 years ago) | Entity-matched recall | Graph doorway + existing hybrid search (P3) |
| 3 — Rahul×Vikram connection user hasn't made | 1-hop edge traversal | Graph doorway (P3) |
| 7 — Bangalore decision: partner, Aditya, 2023 regret | Multi-entity assembly for reasoning | Graph doorway + open loops (P3) |
| 4 — "Done with consulting" vs. 3-month gig | Commitment vs. current statement | **Open loops (commitment kind)** + awareness pass (P4) |
| 5 — Projects die in week three | Mined pattern, surfaced | **Pattern doorway** (P5) |
| 6 — Ankit gone quiet for 8 months | Absence signal | Absence detection (P6) |

| Anti-scenario | Enforced by |
|---|---|
| "Nothing to say — just answer" | Awareness pass returns null; context pack is bounded and silent by default |
| "Wrong moment (mid-debugging)" | Seam check gate; held nudges fall through to the reminder channel |
| "Already known (user mentioned it today)" | Already-known gate (recent-mention check) |
| "Already said (raised last week, ignored) — never again" | **Surfacing ledger** + ledger gate (a WHERE clause, not a hope) |
| "Not its business" | Awareness pass scope: only attaches to what the user's turn touches; inference-grade kinds need higher thresholds |
| "Inference too thin (2 data points ≠ pattern)" | Evidence-count thresholds per kind (patterns need ≥5 receipts) |
| "Passing mention ≠ request" | Already built: suggested-vs-explicit reminder tiers (unchanged) |

---

## 4. The four doorways

Today the agent's context has one door: `search_memories`, opened by a
recall-shaped question. We add four, each with its own trigger and placement:

1. **Rules doorway (task-matched).** Standing rules are matched against *what the
   user is doing this turn* and injected into the agent's **instructions**. The
   rule shapes the answer itself (the X-post critique *is* the answer).
2. **Graph doorway (entity-matched).** When a known person/project enters the
   turn, an entity-context assembler provides profile + open loops + current facts
   + 1-hop edges, with provenance.
3. **Time doorway (date-matched).** Open loops and events with dates in the near
   window are present in context *before* being asked about, and flow to
   notifications when no conversation is active.
4. **Pattern doorway (mined).** Nightly consolidation mines cross-memory patterns;
   they may only surface through the strictest gates.

---

## 5. Decision log

Every decision below was debated; the "why" is the part to preserve.

### D1 — No Neo4j. The graph lives in Postgres.

**Decision:** Model the graph as derived Postgres tables (`facts` already encode
subject→predicate→object edges; we add a materialized `entity_edges` table and an
`open_loops` table). No second datastore.

**For Neo4j (acknowledged):** native deep traversal (4+ hops), the graph
algorithms library (community detection, centrality, link prediction), first-class
relationship properties.

**Against, and decisive for us:**
- **A second source of truth breaks the core principle.** Everything must stay
  derived and rebuildable from the immutable memory log through *one* rebuild
  path. Dual writes across two databases create silent consistency bugs — the
  worst class of bug.
- **Scale is three orders of magnitude away.** A decade of heavy personal use is
  ~50k memories, a few thousand entities, tens of thousands of edges. Postgres
  recursive CTEs handle 1–3 hop queries in single-digit milliseconds at this size.
  Neo4j earns its complexity at millions of nodes with routine deep traversals.
- **Retrieval would split across stores.** Hybrid search wins *because* vector +
  lexical + graph + temporal predicates run in one SQL query. Splitting adds an
  application-layer join that is slower and buggier.
- **"Deep reasoning" is the LLM's job, not the database's.** The database
  *assembles candidate context*; the reasoning model does the connecting. And the
  entire personal graph serializes to well under one model context window — the
  nightly pattern pass can hand the **whole graph** to a reasoning model, which is
  strictly more powerful than topology algorithms because it understands meaning.
  A graph database's analytical superpower exists for graphs too big to look at
  whole; ours never will be.

**Revisit rule:** reconsider only if a concrete, measured traversal query exceeds
~100 ms at real data sizes, or 4+ hop queries become routine. Because the graph
layer is derived, migrating later is a rebuild job, not a data migration.

### D2 — Server stays RAM-stateless; conversations become durable rows.

Two things were being conflated and are now separated:
- **No state in server memory (RAM/process)** — kept forever. Any request can hit
  any instance; everything durable lives in Postgres.
- **Conversations, and the record of what was proactively surfaced, become
  Postgres rows.** "Never raise the Ankit thing twice" is impossible unless *the
  fact that we raised it and the user ignored it* is written down. The distilled
  conversation-capture gate keeps what was *said*; nothing kept what was *raised*.

**Privacy posture (updated 2026-07-16):** raw transcripts are **kept indefinitely
by default**. A planned conversation-history feature will let the user browse and
resume past conversations, which requires the verbatim turns — so we do not prune
by default. The retention machinery still exists for users who want it
(`transcript_retention_days`: null = keep forever — the default; 0 = delete raw
turns as soon as the summary exists; N = prune after N days), and derived
summaries, extracted memories, and the surfacing ledger always persist regardless.
Deletion stays user-controlled and designed-in, just opt-in rather than default.

### D3 — A third memory class: procedural (standing rules).

Episodic (what happened) and semantic (what's true) exist. Rules are procedural —
*when situation X, apply behavior Y*. They get: their own derived table with
trigger-matching fields, a per-turn matcher, injection into the system prompt, a
visible trace step ("applying your posting rules"), and UI management. A rule
still *arrives* as a raw memory (immutable, provenance kept) — extraction
recognizes it, so the class is fully rebuildable.

### D4 — Open loops as a first-class primitive.

Unresolved things attached to entities and dates: the equity dispute (open,
unresolved-conflict), Rahul's job hunt (open, goal), the interview on the 24th
(open, upcoming-event), January's "done with consulting" (open, commitment).
Scenarios 1, 3, 4, 7, 9 all pivot on one. Facts state what's true; loops track
what's *unfinished* — a lifecycle (`open → resolved | expired`), not a truth value.
Created by extraction and consolidation; resolved by later memories or expiry.

### D5 — Suppression is code + state, not prompt behavior.

The **surfacing ledger** records every proactive act: what, when, through which
channel, with which evidence, and the user's reaction (engaged / dismissed /
ignored). Deterministic **gates** read the ledger before anything surfaces:
cooldowns, already-known checks, seam checks, per-kind evidence thresholds, and
budgets (max 1 nudge per conversation, ≤3 surfacings/day across all channels,
quiet hours). A model proposes; code disposes.

### D6 — Proactivity = B's brain, A's voice, C's reach.

Three architectures were considered: (A) one smart agent with everything in the
prompt deciding inline when to nudge — simplest, but suppression becomes prompt
vibes; (B) an awareness sidecar + deterministic gates — testable control, but a
separate "card" presentation felt bolted-on; (C) background-only — safest, but
kills in-the-moment scenarios like Rahul/equity.

**Chosen synthesis:** the **sidecar + gates decide** whether something may surface
(B). When approved, the main agent **weaves it into its natural reply** — no
separate card, the agent just talks like a friend who remembers (A). When no
conversation is active, the same gated items reach the user via notifications and
suggestion chips (C). A nudge that finds no conversational seam degrades into a
reminder — exactly the birthday anti-scenario's ending.

### D7 — Precision-first build order (P0 → P6).

P1–P3 (rules, prospection, entity context) are **lookup-grade**: they only repeat
things the user explicitly said, so they can be right essentially always. P4–P6
(held intentions, patterns, absence) are **inference-grade**: they make claims
*about* the user. The ledger accumulated during P1–P3 records how the user reacts
to nudges for months — that record earns and calibrates the right to attempt
P4–P6. Absence detection (scenario 6) is deliberately last: the signal is a memory
that *doesn't exist*, the precision/creepiness ratio is the worst of the list.

### D8 — The context pack: always-present working memory.

Every Ask turn starts with a small, bounded (~1.5–2k token) pack assembled fresh:
profile summary, 7-day digest, matched rules, near-dated open loops, and any
approved nudge directive. Search becomes the tool for *depth*, not the only door
into memory. Assembly is one SQL round-trip plus one fast-tier call; the summaries
are precomputed nightly, which is what keeps it cheap and instant.

### D9 — Everything new is derived and rebuildable. A replay job makes it real.

Rules, loops, edges, digests, profiles: all derived from the immutable log and
conversation turns. The previously-noted TODO becomes a requirement: a
**re-ingestion / backfill job** that replays extraction over existing memories, so
(a) the new derived layers populate from day one of the migration, and (b) future
extraction improvements can heal history.

### D10 — Push notifications are introduced, tightly budgeted.

Today reminders fire as on-device local notifications only. Agent-initiated
surfacing while the app is closed requires server-initiated push (Expo Push).
Budgets are strict: default ≤1 proactive push/day, user-configured quiet hours,
and every push writes a ledger row like any other surfacing.

---

## 6. What the finished system can and cannot do

**Can:** apply your standing rules to the task in front of you; know your week
before you ask; brief you on a person the moment they enter the conversation —
including the unresolved thing and the connection you haven't made; find the
person you met once, three years ago; hold your January commitment up beside your
July temptation, as a question, not a judgment; tell you what pattern your last
five projects share, with five receipts; and notice who has gone quiet — each of
these exactly once, at a seam, with sources you can tap and correct.

**Cannot, by design:** surface anything it cannot cite; raise a dismissed subject
again; interrupt mid-task; act on two data points as if they were a pattern; use
outside knowledge as if it were your memory; or send your data anywhere — the
graph, the reasoning, and the ledger are yours.

**Honest limits:** extraction quality still bounds everything above it (one cheap
model's judgment per memory — mitigated by replay); entity linking can still
merge/split people as the graph grows (edge review UI in P3 mitigates); seam
detection is a judgment call that will sometimes be wrong; and inference-grade
features will occasionally be silent when they could have helped — that is the
side we chose to err on.
