---
session: a35f2696
week: 2026/W14
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (37 user prompts); large facts sheet (~15180 tok)"
upgrade_status: pending
openspec_changes: [subagent-integration]
---

# How we did it: Integrate @tintinweb/pi-subagents into the dashboard — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened obliquely — *"Is websearch available?"* — but the real objective
surfaced two prompts later: **"There is a pi extension called `@tintinweb/pi-subagents`.
Is it using TUI? Can it work without TUI? How can subagents' output / chatlog be
integrated into the dashboard?"** The operator wanted to surface a *third-party*
subagent extension's live activity (agent cards, status, results) in the pi-agent
dashboard — the same way the dashboard already surfaces `pi-flows`. By the end the
real objective had sharpened again: **build the integration, discover it can't be
tested from inside a harness session, then document it exhaustively and revert it**
because the fix path was unclear.

## 2. TL;DR playbook

1. **Confirm the tool surface first.** Ask what search/fetch tools exist (`web_search`,
   `fetch_content`, `code_search`) before researching — the session wasted two turns
   rediscovering this after a restart.
2. **Research by reading source, not guessing.** `fetch_content` the extension's GitHub
   repo + `grep` the *installed* `dist/` to learn how it spawns agents and what events
   it emits (`subagents:*`).
3. **Compare siblings to find the integration seam.** Diff `pi-flows` vs
   `@tintinweb/pi-subagents` vs `nicobailon/pi-subagents` — the winning insight: all
   emit on a **shared `pi.events` bus**, so the dashboard needs *zero dependency* on the
   package, just `pi.events.on("subagents:*", …)`.
4. **Mock the UI before coding.** Produce 3–4 screen plans (badge, card grid, detail,
   mobile) that *reuse* the existing `FlowDashboard`/`FlowActivityBadge` patterns with a
   distinct accent color (teal, vs blue flows / orange OpenSpec).
5. **Drive it through OpenSpec.** `openspec new` → write proposal → `/opsx:ff` for
   design+specs+tasks → `/opsx:apply` to implement task-by-task.
6. **Clone the pi-flows wiring exactly.** `subagent-event-wiring.ts` (bridge forward),
   reducer, server status-extraction sentinels, badge + dashboard components, tests.
7. **Try to test — and hit the wall.** The pi harness's `Agent` tool always runs
   **foreground** regardless of `run_in_background: true`, so `subagents:created` /
   `subagents:completed` never fire and cards stick in "running".
8. **When a feature can't be verified, document-then-revert.** Write a file-level
   revert + reimplement guide (`docs/plans/tintinweb-subagents.md`), then cleanly remove
   every added file, keep only the doc + one bugfix, and commit.

## 3. How the collaboration unfolded

**Phase 1 — Tool reconnaissance (prompts 1–2).** The operator asked whether web search
existed; a session restart forced a re-check. The AI confirmed `web_search`,
`fetch_content`, `code_search`. *Lesson baked into §2 step 1: nail down the tool surface
once, up front.*

**Phase 2 — Research the extension (prompts 3–9).** The AI `fetch_content`ed the GitHub
repos and grepped the installed `dist/` to answer: **Does it use TUI?** (Yes — `AgentWidget`
+ `ConversationViewer`, but the *core spawning logic in `agent-runner.ts` is
TUI-independent*.) It then compared three subagent systems and produced the pivotal
finding: **`pi-flows` does NOT use `@tintinweb/pi-subagents`** — both independently call
`createAgentSession()` from the pi SDK and emit their own event families
(`flow:*` vs `subagents:*`). The `nicobailon/pi-subagents` package is different again —
it **spawns child `pi` processes** rather than in-process sessions. The seam:
`pi.events` is one shared bus (`events: eventBus` passed to every `createExtensionAPI()`),
so the dashboard just listens.

**Phase 3 — Screen plans (prompt 4).** The operator chose "Option A — display screen
plans." The AI screenshotted the live dashboard, studied `FlowDashboard`/`SessionCard`,
and proposed 4 screens reusing those exact grid/badge patterns with a teal accent.

**Phase 4 — OpenSpec artifacts (prompts 10–13).** *"Implement it, but the code is only
available when the extension is installed."* The AI confirmed the no-dependency,
event-only approach (`if (!pi.events) return;` guard mirrors `flow-event-wiring.ts`),
created the `subagent-integration` change, wrote the proposal, ran `/opsx:ff` to
generate design+specs+tasks (4 capabilities, 18 tasks), then asked clarifying questions
and folded the answers (background-only, panels stack, keep until session end, skip
detail view → 16 tasks).

**Phase 5 — Implementation (prompts 14–18).** `/opsx:apply` walked the tasks: shared
types, `subagent-event-wiring.ts`, bridge wiring, server-side status-extraction
sentinels, client reducer, `SubagentActivityBadge`, `SubagentCard`, `SubagentDashboard`,
plus unit tests. Build passed; server restarted; sessions reloaded.

**Phase 6 — The verification wall (prompts 19–32).** The operator tried a live test
(`Agent({… run_in_background: true})`). The card appeared but **stuck in "running."**
Root-causing revealed a cascade: (a) the pi harness runs the `Agent` tool **foreground**
regardless of the flag; (b) foreground agents only emit `subagents:started` — never
`created` or `completed` (those are on the background-only code path,
`AgentManager` line ~194 `this.onComplete?.(record)` gated on `isBackground`); (c) the
reducer created ghost cards from `started` alone. Fix: **only update existing entries on
`started`, never create.** Then a second issue: **Stop doesn't kill a foreground
subagent** — `spawnAndWait` never forwards the abort `signal`, and the globally-exposed
manager (`Symbol.for("pi-subagents:manager")`) exposes only `hasRunning/getRecord/spawn/
waitForAll` — **not `abortAll`** — so no clean workaround existed.

**Phase 7 — Document, revert, commit (prompts 33–37).** Recognizing the fix path was
unclear and upstream, the operator asked for a **comprehensive file-level doc** of every
created/modified file plus exact revert + reimplement steps →
`docs/plans/tintinweb-subagents.md`. The AI cross-checked it against `git status`, then
reverted all subagent code, keeping only the plan doc + the incidental `FlowState` import
fix, and committed/pushed (that fix + doc, then a separate 33-file package-manager-ui
batch that was already staged).

## 4. Prompts that worked

- **The goal prompt (rewrite):** the actual mover was prompt 3. A stronger opener:
  *"Investigate `@tintinweb/pi-subagents`: does it need TUI, does it emit events on
  `pi.events`, and what's the minimal dashboard integration (compare to how we already
  surface pi-flows)?"* — front-loads the seam question and the pi-flows analogy.
- **"Is pi:flow using this subagent api?"** (prompt 5) — high-leverage: forced the AI to
  prove the two systems are independent, which *is* the whole integration rationale.
- **"the code is only available when the extension is installed"** (prompt 10) — a
  constraint that steered the design to zero-dependency, event-only listening.
- **"/opsx:ff subagent-integration"** then **"Is there anything to clarify?"** — the
  clarify prompt surfaced the 4 scope decisions that trimmed 18→16 tasks *before* coding.
- **"Make comprehensive, very detailed, file-level description… on
  docs/plans/tintinweb-subagents.md"** (prompt 33) — the model output was only as sharp
  as this prompt: it explicitly demanded created files, modified files, exact revert, and
  exact reimplement — so the doc was actually reusable.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Re-discover its own tools after a restart | "I restarted this session. Recheck" | Confirm tool surface in the first prompt |
| Assume pi-flows and pi-subagents might share code | "Is pi:flow using this subagent api?" / "Check pi-subagents too" | State up front "prove they're independent" |
| Declare the feature "working" from a card appearing | "the Card stays in running state" + screenshot | Define the *completion* signal, not just the start signal, as the test |
| Treat foreground vs background as a detail | "When agent is starting the prompt cannot send new commands. Why?" | Know that the harness `Agent` tool always runs foreground — you cannot trigger real background from a text prompt |
| Reach for `abortAll()` on the global manager | "I've pushed the stop, but nothing happened" | Check the exposed API surface first (`Symbol.for("pi-subagents:manager")` only exposes `hasRunning/getRecord/spawn/waitForAll`) |
| Leave a half-tested feature in the tree | "Revert subagent changes" after documenting | For unverifiable features: document-then-revert, don't ship |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created in this session — but the workflow is clearly repeatable
and a skill **should** exist:

- **Recommended skill: `integrate-pi-event-extension`.** Captures the reusable pattern:
  (1) confirm the extension emits on the shared `pi.events` bus; (2) clone the
  `flow-event-wiring.ts` forward + reducer + server sentinel + badge/dashboard component
  quartet; (3) guard with `if (!pi.events) return;` so it's inert when the extension is
  absent. This removes the whole "how do we integrate a third-party subagent/flow
  system" investigation each time.
- **Recommended memory (project):** *"The pi harness `Agent` tool always executes
  foreground regardless of `run_in_background: true`; `@tintinweb/pi-subagents` only
  emits `subagents:created`/`completed` on its background code path, so background
  activity cannot be triggered from a text prompt inside a harness session."* — this one
  fact would have saved ~2 hours of testing dead-ends (prompts 19–32).

## 7. Pitfalls & dead ends

- **Foreground-only harness (2h sink).** `Agent({run_in_background:true})` from inside a
  session still runs foreground; `subagents:created`/`completed` never fire → cards stick
  "running." Sending prompts to *other* sessions didn't help — the LLM there also chose
  foreground. **You cannot verify background subagent UI from within a harness session.**
- **Ghost cards from `subagents:started`.** The reducer created entries on `started`;
  foreground agents emit only `started`. Fix: update-only on `started`, create only on
  `created`. Mirror the same rule server-side (only increment `subagentRunning` when a
  prior count exists).
- **Stop doesn't kill foreground subagents.** Upstream bug: `spawnAndWait` never forwards
  the abort `signal`. The workaround (`abortAll()` via the global manager) fails because
  that method **isn't exposed** on `Symbol.for("pi-subagents:manager")`. No clean local
  fix — file upstream issues (signal forwarding + expose `abortAll`).
- **10 failed bash commands** were mostly `grep`/`fetch` probes hunting where `flow:*`
  events are emitted — searching installed `dist/` and `/tmp/pi-github-repos/…` clones is
  faster than guessing package internals.
- **Commit scope creep.** The final commits mixed the subagent revert with an unrelated
  33-file package-manager-ui batch that was already staged — separate your `git add`
  sets when reverting.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- The target extension's GitHub URL and its **installed** path (to grep `dist/`).
- A running dashboard (`http://localhost:8000`) to screenshot for UI grounding.
- Knowledge of the existing `pi-flows` quartet: `flow-event-wiring.ts`,
  `flow-reducer.ts`, server `event-status-extraction.ts` sentinels, `FlowDashboard`/
  `FlowActivityBadge`.

**Steps:**
1. Confirm tools (`web_search`/`fetch_content`) in prompt 1.
2. `fetch_content` the repo + grep installed `dist/` → confirm it emits on `pi.events`
   (`<ns>:*`), TUI-independent core.
3. Prove independence from sibling systems (the integration seam).
4. Screenshot the dashboard; plan screens reusing Flow patterns + a distinct accent.
5. `openspec new` → proposal → `/opsx:ff` → clarify scope → `/opsx:apply`.
6. Clone the flow quartet for the new event namespace; add `if (!pi.events) return;`.
7. Verify — but know that **background subagents can't be triggered from a harness
   session**; test with a real autonomous background spawn or accept limited verification.
8. If unverifiable: write `docs/plans/<name>.md` (created files, modified files, exact
   revert, exact reimplement), then revert and commit the doc + any incidental bugfix
   separately.

**Final artifacts produced (this session):**
- `docs/plans/tintinweb-subagents.md` — the revert + reimplement guide (kept).
- The `FlowState` import fix in `src/client/lib/event-reducer.ts` (kept).
- All subagent code (`subagent-event-wiring.ts`, `subagent-reducer.ts`,
  `SubagentActivityBadge.tsx`, `SubagentCard.tsx`, `SubagentDashboard.tsx`, tests, type
  additions) — **implemented then reverted.**
- OpenSpec change `subagent-integration` (proposal/design/specs/tasks).

---

_Generated from session `a35f2696-8ea8-4989-a0b4-560db2febd85` · `pi-agent-dashboard` · 2026-04-05. Source extract: `facts.rrghAmhkJx.md`._
