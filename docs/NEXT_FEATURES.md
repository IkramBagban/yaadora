# Yaadora — Next Features

This describes what should be built next, on top of what already exists (capture, ingestion, single-shot Ask with citations, memory detail screen, timeline).

---

## 1. Conversational Ask

Right now Ask is one-shot: user asks something, gets one answer, done. That needs to become a real conversation.

The user should be able to ask a question, get an answer, then send another message or ask a follow-up that naturally depends on the previous exchange — "what about last month instead?", "who else was there?", "did I mention anything else about that?" — and the system should understand these follow-ups in the context of what was just discussed, not treat each message as a cold, standalone query.

The AI should not always try to answer immediately. If a question is ambiguous or there isn't enough in memory to answer confidently, it should ask the user something back to narrow it down — e.g. if the user asks "when did I meet him" and there are multiple people it could refer to, the AI should ask which person if not obvious, instead of guessing or picking. This makes it feel less like a search box and more like an assistant that's actually thinking with the user.

This is meant to feel like a second brain — something that remembers everything the user has ever told it and can reason across it, not just retrieve the one or two most similar snippets. So for harder questions, the AI should be willing to look things up more than once — check one angle, realize it needs another piece of information, go look that up too, and then answer — rather than always doing a single retrieval pass and answering off whatever it finds. When it does this kind of extra digging, that should be visible to the user (this connects to the "reasoning" point below).

The conversation should be a fresh session each time the user opens the Ask tab for now — no persistent history of past conversations to revisit yet. That may change later, so it's worth keeping in mind, but it's not needed for this pass — don't over-invest in making old sessions browsable.


also memory could also be extracted from conversation. 

## 2. Reasoning / thinking visibility

When the AI does something more than a simple single lookup — multiple retrieval passes, checking something before answering, deciding a question is ambiguous — that process should be visible to the user in some lightweight way.  state while it works, and afterward a small indicator that it reasoned through somethin. The goal is for the user to trust that the answer wasn't just a shallow keyword match — that the AI actually worked out the answer.

## 4. Daily / weekly / monthly memory summaries

The user should be able to get a short recap of what they captured over a period of time — today, this week, this month — written more like a gentle "here's what was on your mind" summary than a dry list. The point is to help the user remember and reflect, not to be exhaustive; it should read like someone who knows them summarizing the highlights, not a report.

The user should be able to choose when they want to see this and for which window (day/week/month), rather than it being pushed on them automatically or on a fixed schedule. It's a pull, not a push, at least for now. by default it would be off. 

## 5. Auto-suggested reminders

Right now reminders can only be added manually. The system should also be able to notice, on its own, when something the user wrote sounds like it should become a reminder — "I need to renew my passport soon," "call mom this weekend," things with an implied action or deadline. When it notices this, it shouldn't silently create a reminder — it should surface a lightweight suggestion, something like "set a reminder for this?" with a single tap to confirm. If the user ignores or dismisses it, nothing happens. This should feel helpful and unobtrusive, not like the app is nagging or making decisions on the user's behalf without asking. 

## 7. Memory browsing at scale

The current "Memories" list and per-memory detail screen already look and work fine for a small number of entries. The thing to keep in mind going forward is that this list will keep growing — potentially into the thousands of entries over time — and the user mostly won't need to browse it manually, because Ask is meant to be the primary way they find things. So this screen doesn't need heavy investment right now; it just needs to not break or become painfully slow as the number of memories grows. It's a "make sure it still works," not a "redesign this," item for this pass.

---

## Suggested build order

1. Conversational Ask (the follow-up understanding + AI-asks-back behavior) — this is the core of the "second brain" feeling and everything else hangs off it.
2. Reasoning visibility + inline clickable references — these are natural extensions of the same Ask flow, best done right after or alongside it.
3. Auto-suggested reminders — self-contained, plugs into the existing capture/ingestion flow.
4. Daily/weekly/monthly summaries — self-contained, can be built independently at any point.
5. Swipe navigation — smallest, do whenever, doesn't block anything else.