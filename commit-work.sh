#!/usr/bin/env bash
#
# One-off: clean the index and commit the current work in focused commits.
#
# Why this exists: a `git stash` I ran left a stale .git/index.lock AND staged
# 69 files into the index — including a 102MB APK, docs/, and logs/ containing
# real memory text. The sandbox couldn't delete the lock, so this runs on your
# machine instead. Read it before running; it makes commits but never pushes.
#
#   chmod +x commit-work.sh && ./commit-work.sh
#
set -euo pipefail
cd "$(dirname "$0")"

echo "==> 1. Clearing the stale index lock"
rm -f .git/index.lock

echo "==> 2. Unstaging everything (working tree untouched)"
# Nothing junk is in HEAD yet, so this drops the APK/logs/docs back to untracked,
# where the updated .gitignore keeps them out.
git reset -q

echo "==> 3. Sanity check — these must NOT appear below:"
git status --porcelain | grep -E '\.apk$|\.log$|^.. docs/|\.md$' && {
  echo "!! Junk still visible. Stop and check .gitignore before continuing."
  exit 1
} || echo "    clean."

echo
echo "==> 4. Committing"

# --- 1/5: gitignore first, so nothing below can pick up junk ----------------
git add .gitignore
git commit -q -m "chore: ignore logs, build artifacts, docs and scratch files

Runtime logs under logs/ contain raw memory text and auth traces, so they must
never be committed. Also excludes build outputs (*.apk), local scratch scripts,
and docs/ per CLAUDE.md."
echo "    [1/5] chore: gitignore"

# --- 2/5: speech-to-text ----------------------------------------------------
git add \
  packages/core/transcription/ \
  packages/core/index.ts \
  apps/server/src/routes/transcribe.ts \
  apps/server/src/index.ts \
  apps/mobile/src/voice/ \
  apps/mobile/src/components/VoiceInput.tsx \
  apps/mobile/src/api/client.ts \
  apps/mobile/src/capture/outbox.ts \
  "apps/mobile/app/(tabs)/index.tsx" \
  "apps/mobile/app/(tabs)/ask.tsx" \
  apps/mobile/app.json \
  apps/mobile/package.json \
  apps/mobile/tsconfig.json \
  .env.example
git commit -q -m "feat(voice): speech-to-text capture in Add and Ask

Voice is an input method for the existing text box, not a new memory type:
audio is transcribed, discarded, and the text lands in the composer for the
user to proofread before saving. No audio is ever stored, so that edit step is
the only correction mechanism.

- Groq whisper-large-v3-turbo via a stateless POST /transcribe. Nothing is
  written to the DB or disk; the transcript is never logged.
- GROQ_API_KEY accepts a comma-separated pool. Keys rotate on 429/401/403 and
  the cursor sticks to whichever worked, so a throttled key is not retried
  first on every request. A 400 fails immediately rather than burning the pool.
- When every key is spent the server returns 503, which the client reads as
  'fall back to on-device' rather than an error, with a 5-minute cooldown.
- Offline or post-503 uses expo-speech-recognition on-device with live interim
  text; the engine is chosen before recording starts so we can never hold audio
  with no way to transcribe it.
- Whisper is biased with the user's top entity names, which is what stops a
  misheard proper noun silently breaking recall for that person.
- Transcripts append rather than replace, so typed text is never eaten."
echo "    [2/5] feat(voice)"

# --- 3/5: reminders read + CRUD --------------------------------------------
git add \
  packages/db/queries.ts \
  packages/db/index.ts \
  packages/core/retrieval/reminder-dedupe.ts \
  packages/core/retrieval/reminder-dedupe.test.ts \
  packages/core/retrieval/context-pack.ts \
  packages/core/retrieval/context-pack.test.ts \
  packages/core/retrieval/agent.ts \
  packages/core/retrieval/index.ts
git commit -q -m "feat(reminders): give the Ask agent read access and full CRUD

The agent could create reminders but could not see them: search_memories covers
memories and facts, and the context pack carried open_loops (LLM-inferred) but
never the reminders table (user-scheduled, with accept/dismiss state). So it
could not answer 'what's on my plate', could not tell a dismissed reminder from
a missed one, and set_reminder inserted unconditionally — asking twice produced
two rows firing at the same time.

- Context pack now carries pending reminders due within the horizon, ranked
  above open loops: a reminder is something the user committed to, a loop is
  inferred, so if only one fits, keep the one they actually asked for. Overdue
  items are flagged so the agent cannot call a missed reminder upcoming.
- search_reminders for lookups beyond the pack window and for done/dismissed.
- set_reminder supports once/daily/weekly with weekdays, mirroring the API's
  validation so agent-created rows match UI-created ones.
- update_reminder and delete_reminder, with done and dismissed kept distinct.
- Read-before-write dedupe guard. Deliberately conservative (0.7 word overlap
  within 12h): a false positive silently swallows a reminder the user asked
  for, which is worse than a duplicate they can delete.
- All writes are owner-scoped, so a hallucinated id cannot touch another
  user's row."
echo "    [3/5] feat(reminders)"

# --- 4/5: rerank opt-in -----------------------------------------------------
git add \
  packages/core/retrieval/rerank.ts \
  packages/core/retrieval/rerank.test.ts \
  packages/core/retrieval/search.ts
git commit -q -m "perf(retrieval): make the LLM rerank opt-in, default off

The rerank was a second fastModel round-trip on every search_memories call, and
the agent may search up to MAX_STEPS times per turn, so it multiplied. Set
RERANK_ENABLED=true to restore it.

Disabled, results fall back to the fused hybrid retrieval score. Worth knowing
what that costs: fuse() normalises each channel to [0,1] independently, so the
top hit of a channel that found nothing useful still scores ~1.0. The fused
order is a recall merge, not a relevance judgment — this trades precision for
latency, and an eval ablation is the honest way to price it.

Also: skip the model call when the pool already fits in topK (it cannot change
which items are kept), and degrade to retrieval order on rerank failure instead
of failing the whole answer.

Note topRelevance -> confidence is no longer calibrated when disabled. It is
currently sent to the client but never rendered, so nothing breaks — but do not
build a refusal threshold on it without re-enabling rerank."
echo "    [4/5] perf(retrieval)"

# --- 5/5: your own in-flight work, if any -----------------------------------
# These were already modified before I started; grouped separately so you can
# amend the message or split further. Skipped automatically if unchanged.
PRE_EXISTING=(
  packages/core/ai/models.ts
  packages/core/ingestion/extraction.ts
  packages/core/ingestion/linking.ts
  packages/core/queues/index.ts
  packages/core/eval/runner.ts
  apps/worker/src/index.ts
  apps/mobile/src/api/config.ts
  apps/mobile/.env.example
  scripts/
  bun.lock
)
TO_ADD=()
for f in "${PRE_EXISTING[@]}"; do
  [ -e "$f" ] && ! git diff --quiet HEAD -- "$f" 2>/dev/null && TO_ADD+=("$f")
done
if [ ${#TO_ADD[@]} -gt 0 ]; then
  git add "${TO_ADD[@]}"
  git commit -q -m "chore: in-flight changes to ingestion, worker and eval harness

Pre-existing local work, committed as one batch. Reword or split as needed."
  echo "    [5/5] chore: pre-existing work"
else
  echo "    [5/5] nothing pre-existing to commit"
fi

echo
echo "==> Done. Last 5 commits:"
git --no-pager log --oneline -5
echo
echo "==> Still uncommitted (expected: docs, logs, apk, scratch):"
git status --short | head -20
echo
echo "If this all looks right, drop the leftover stash:  git stash drop stash@{0}"
echo "(Do NOT touch stash@{1} — that one predates this work.)"
