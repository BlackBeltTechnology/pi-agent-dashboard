---
session: 1b99d96c
week: 2026/W14
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (15 user prompts)"
upgrade_status: pending
openspec_changes: [incremental-event-sync]
proposal_excerpt: "Every browser reconnect, session subscribe, and bridge reconnect triggers a full replay of ALL events from sequence 1. The protocol already supports incremental sync (`lastSeq` on subscribe, monotonic seq numbers, ran…"
---

# How we did it: From a "session died on tool timeout" bug to incremental event sync — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a screenshot and a hunch:

> *"Its interesting. Think ultrahard and anayze. The tool call when timed out the whole session become ended [image]"*

The literal ask was a **debugging investigation**: why does a bash tool call timing out
appear to *end the whole pi session*? But the real objective shifted twice under steering.
Root-causing the timeout led to a memory/OOM hypothesis, then to a broader question the
operator actually cared about: **the dashboard re-dumps the entire conversation on every
reconnect** — wasteful. The session's true deliverable became a full OpenSpec change,
`incremental-event-sync`, taking the sync protocol from "replay everything from seq 1" to
delta sync (client tracks `maxSeq`, server skips the event-wipe on bridge reconnect, lazy
per-session subscription). It shipped: 22/22 tasks, 33 tests, archived.

## 2. TL;DR playbook

1. **Investigate before touching code.** Ask the AI to trace the failing path through
   *both* the app source and pi's own `dist/` (`bash.js`, `shell.js`, `agent-session.js`)
   — the timeout bug lived in process-group semantics, not the dashboard.
2. **Kill the cheap hypothesis fast.** Reduce test peak memory (`--maxWorkers=1` in
   `vitest.config.ts`) and re-run *in the same session* to see if pi survives. It didn't
   fully — signal to keep digging, not to declare victory.
3. **Pivot to the real problem with a plan-only prompt:** *"Analyze how data is
   synchronized… minimize data transfer but guarantee sync. Do not modify things, just
   plan."* Add **"Do not use Agents"** if you want the main model to read the files itself.
4. **Turn the analysis into a proposal:** `create proposal for this`, then
   `/opsx:ff incremental-event-sync` to fast-forward all artifacts (proposal → design →
   specs → tasks).
5. **Force a clarification pass before applying:** ask *"Is there anything to clarify?"* —
   the AI surfaced a live-event-during-replay race and two design ambiguities. Answer them
   tersely (`1. Suppress while replay completes / 2. Check it… / 3. yes / 4. yes`).
6. **Implement TDD via `/opsx:apply`** — write the failing test, watch it fail, implement,
   mark the task. 7 task groups, server → bridge → client dependency order.
7. **Verify against artifacts** with `/opsx:verify`; when the implementation *improved on*
   the spec, update the spec to match reality (not the other way round).
8. **Archive** with `/opsx:archive` to sync delta specs into the main specs.

## 3. How the collaboration unfolded

**Phase 1 — Root-cause the timeout (Discovery).** The AI grepped for `ended` status,
signal handlers, and heartbeat/watchdog logic across `src/extension` and `src/server`,
then read pi's *own* compiled source to learn how the bash tool kills a timed-out child:
`detached: true` → own process group → `process.kill(-pid, SIGKILL)` on the group only.
Conclusion: the timeout *should not* kill pi. **Why it worked:** the AI didn't stop at the
dashboard boundary — it read the framework's `dist/` to prove the isolation, which
reframed the bug as *something else killing the process* (OOM).

**Phase 2 — Test the OOM hypothesis (Gather).** Steering #1 set `maxWorkers=1`; #2 asked to
retest live; #3 reported "still pi is exiting." The single-worker change reduced peak
memory but didn't fully fix it — an honest dead-end that the operator let the AI keep
probing by running test files in small batches.

**Phase 3 — Reframe to the sync problem (Design).** Steering #4/#5 (repeated, with
*"Do not use Agents"* added) asked for a **plan-only** analysis of the reconnect data flow.
The AI traced all three hops (bridge → server → browser) and found the waste: every bridge
reconnect wipes all stored events and re-replays the whole conversation. **Decision point:**
the human explicitly forbade code changes at this stage — analysis first.

**Phase 4 — Author the OpenSpec change (Generate).** `create proposal` then `/opsx:ff`
produced proposal + design + 4 spec files + tasks. Before applying, the AI's own
*"anything to clarify?"* pass caught the **live-events-during-replay race** and a question
about whether lazy subscribe breaks sidebar cards — it then *proved* sidebar data all comes
from `session_updated` metadata, not `SessionState`, so lazy subscribe was safe.

**Phase 5 — TDD implementation (Build).** `/opsx:apply` walked 22 tasks in dependency order:
`getMaxSeq` on the event store → stale-`lastSeq` detection → skip-wipe via `eventCount` →
bridge sends `entries.length` → per-WebSocket `replayingSessionIds` suppression + catch-up →
client `maxSeqMapRef` → lazy subscription. Each task: failing test first, then implementation.

**Phase 6 — Verify & archive (Land).** `/opsx:verify` flagged that skip-wipe compared
`lastEntryCount` (pi entries) instead of the spec's `getEvents().length` (dashboard events)
— an *improvement*, since those counts differ. The AI updated the spec/design/tasks to match
the correct implementation, then `/opsx:archive` synced 4 delta specs into main specs.

## 4. Prompts that worked

- **Goal prompt** — *"Think ultrahard and analyze. The tool call when timed out the whole
  session became ended [image]."* Effective because it paired a screenshot with a precise
  symptom and demanded analysis, not an immediate fix. Stronger version: add *"trace the
  failing path through pi's own source too, don't stop at our code."*
- **"Do not modify things, just plan"** — the single highest-leverage phrase. It forced a
  read-only analysis and produced a proposal-grade write-up instead of premature edits.
- **"Do not use Agents"** — appended on the retry to stop the model delegating the analysis
  to a subagent and instead read the files in the main context (better for a design the
  operator wanted to review inline).
- **"Is there anything to clarify?"** — a cheap prompt that unlocked a lot: it surfaced the
  replay race and design ambiguities *before* implementation, saving a rework loop.
- **Terse numbered answers** (`1. Suppress while replay completes / 2. Check it / 3. yes /
  4. yes`) — a compact way to resolve a batch of clarifying questions in one turn.
- **Slash commands** (`/opsx:ff`, `/opsx:apply`, `/opsx:verify`, `/opsx:archive`) — drove
  the whole OpenSpec lifecycle without re-explaining the workflow.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Anchor on the first plausible root cause (OOM) | "still pi is exiting" — keep digging | State up front: "confirm the fix by reproducing, don't declare victory on a hypothesis" |
| Jump toward editing code during analysis | "Do not modify things, just plan" | Put "plan-only, no edits" in the analysis prompt |
| Delegate the analysis to a subagent | Re-issue with "Do not use Agents" | Say "read the files yourself in this context" when you want to review the reasoning inline |
| Proceed straight from proposal to apply | "Is there anything to clarify?" | Make a clarification pass a standing step between `/opsx:ff` and `/opsx:apply` |
| Treat the written spec as ground truth | Accept the *better* implementation and update the spec | State: "if the code improves on the spec, fix the spec to match" |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — the OpenSpec slash-command workflow
(`/opsx:ff`, `/opsx:apply`, `/opsx:verify`, `/opsx:archive`) already encoded the repeatable
procedure. One subagent was spawned: **`Explore` ("Analyze data sync logic")** for the
read-only sync trace, though the operator preferred the main model to do this inline
(hence the "Do not use Agents" correction on the retry).

**Recommended memory to save:** *pi's bash tool timeout uses `detached: true` process groups
and `process.kill(-pid, SIGKILL)` — a tool timeout kills only the child group, never the pi
process; if a session "ends" on timeout, suspect OOM or the test harness, not the tool.*
This one fact reframed the entire first phase and is worth not re-deriving.

## 7. Pitfalls & dead ends

- **OOM was a partial fix, not the fix.** `--maxWorkers=1` lowered peak memory but pi still
  exited — if you set it and the symptom persists, isolate which test file kills pi by
  running server tests (the ones that spawn real servers) in small batches.
- **Live events can arrive mid-replay.** When adding delta subscribe, event 101 can broadcast
  while events 51–100 are still replaying → out-of-order client state. Fix: per-WebSocket
  `replayingSessionIds` suppression + a catch-up batch after `replay_complete`.
- **`eventCount` ≠ dashboard event count.** One pi conversation entry can produce several
  dashboard events. Compare *pi entry count* (`lastEntryCount`) to `msg.eventCount`, not
  `eventStore.getEvents().length` — the spec's original wording was wrong here.
- **Lazy subscribe looks risky for sidebar cards but isn't** — verify (as this session did)
  that every sidebar field comes from `session_updated` metadata, with `contextUsageMap`
  falling back to `session.contextTokens/contextWindow`, before removing auto-subscribe.
- **Two failed `find | xargs grep` commands** on pi's `dist/` — expect misses when probing a
  framework's compiled output; narrow the pattern rather than widening the search.

## 8. Reproduce it faster — checklist

- [ ] **Have ready:** the failing symptom (screenshot + exact behavior), a running dashboard
      with at least one live pi session to retest against, and the OpenSpec CLI (`openspec`).
- [ ] Ask for a **read-the-framework-too** root-cause trace; don't stop at app source.
- [ ] Test the cheap hypothesis (memory: `--maxWorkers=1`) and **reproduce** before believing it.
- [ ] Pivot with a **plan-only** analysis prompt (add "Do not use Agents" if you want it inline).
- [ ] `create proposal` → `/opsx:ff <change>` to scaffold all artifacts.
- [ ] Run an explicit **"anything to clarify?"** pass; answer with terse numbered replies.
- [ ] `/opsx:apply` in **TDD** order (server → bridge → client), one failing test per task.
- [ ] `/opsx:verify`; when code beats spec, **update the spec**. Then `/opsx:archive`.
- [ ] **Artifacts produced:** `openspec/changes/archive/2026-04-07-incremental-event-sync/`;
      edits across `memory-event-store.ts`, `subscription-handler.ts`, `event-wiring.ts`,
      `protocol.ts`, `session-sync.ts`, `bridge.ts`, `browser-gateway.ts`, `App.tsx`,
      `useMessageHandler.ts`; new tests `subscription-handler.test.ts`, `skip-wipe.test.ts`.

---

_Generated from session `1b99d96c` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-24. Source extract: facts sheet for "Incremental connection handling"._
