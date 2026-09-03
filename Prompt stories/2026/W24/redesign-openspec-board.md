---
session: 019ec387
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "yes — created 0 skill(s) / 1 memory(ies); heavy steering (6 user prompts); large facts sheet (~10669 tok)"
upgrade_status: pending
openspec_changes: [redesign-openspec-board, new-spec-spawn]
proposal_excerpt: "The folder-level OpenSpec section (`FolderOpenSpecSection`) is an inline collapsible accordion inside the folder card. With 66 changes it is cramped, hard to scan, and mixes group management, proposals, and linked ses…"
---

# How we did it: Redesign the OpenSpec board into a full-page kanban — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation: `/skill:openspec-apply-change redesign-openspec-board`.
There was no prose brief — the *ask* lived entirely in the OpenSpec change's proposal and
39-task spec. The real objective: **replace the cramped inline `FolderOpenSpecSection`
accordion (66+ changes crammed into a folder card) with a dedicated full-page kanban board**
at `/folder/:encodedCwd/openspec` — group columns, draggable proposal cards, lifecycle
steppers, per-session rows, a filter bar, and a new-proposal dialog — plus the backend
persistence (`changeOrder`) needed to remember per-change ordering. Then take it all the
way to shipped: apply → archive → PR → green CI → merge → clean up the worktree.

## 2. TL;DR playbook

1. Kick off with the skill against an existing well-specced change: `/skill:openspec-apply-change redesign-openspec-board`.
2. **Gather before building** — read the delta specs, then delegate deep code harvesting to an `Explore` subagent to keep the main context lean.
3. **Fix the worktree first**: a fresh `.worktrees/` checkout has NO `node_modules`; run `npm install` inside it so workspace symlinks resolve edits to the worktree, not the main checkout.
4. Build **foundation-first**: shared types (`changeOrder` + `OPENSPEC_UNGROUPED_KEY`) → rest-api request type → WS broadcast message → server store `setChangeOrder()` → route → client API helper. Typecheck the backend before touching UI.
5. Build the UI bottom-up: pure helpers (`openspec-board-order.ts`, `openspec-board-worktree.ts`) first (testable), then `OpenSpecBoardView.tsx`, then wire the route.
6. **Wire the route in ALL overlay render sites** — App.tsx has three (desktop + two mobile/responsive). Extract the board element to one `const` and reference it everywhere (DRY + avoids the "blank page" bug).
7. TDD each layer: rewrite tests that covered removed inline behavior; add unit tests for pure helpers + a server store test + a board component test. Isolate flaky server tests with `HOME=$(mktemp -d)`.
8. Verify visually in an **isolated** instance on an alt port (`:8055`) — never restart the live `:8000` daemon. Tear it down and confirm no worktree paths linger in `~/.pi/agent/settings.json`.
9. Archive (`/skill:openspec-archive-change`) → sync delta specs via subagent → commit surgically (revert unrelated `.pi/settings.json` env mutation) → PR against `develop`.
10. Monitor CI; if it never dispatches, suspect a **merge conflict blocking the merge ref** — rebase onto `develop`, resolve, force-push, watch green, then squash-merge + delete branch + remove worktree.

## 3. How the collaboration unfolded

**Discovery & Gather.** The AI opened with "This is a large change (39 tasks)" and read
the delta specs, App.tsx routing, the mockup, and reusable components — much of it *in
parallel* — then delegated the deepest harvest to an `Explore` subagent ("Harvest OpenSpec
board impl details"). *Why it worked:* front-loading a full mental model before the first
edit prevented mid-build thrash on a 12-group, 39-task feature; the subagent kept the main
context from bloating.

**Foundation (backend/shared).** It threaded `changeOrder` through the whole stack —
shared types → rest-api → WS protocol → server store → route → client helper — then
typechecked shared+server *before* any UI. *Decision point:* build the persistence
primitive first because "everything else builds on it."

**Worktree unblock.** First `tsc` surfaced that cross-package imports resolved to the
**main** checkout, not the worktree edits — because the fresh worktree had no
`node_modules`. The AI ran `npm install` in the worktree so symlinks pointed locally. This
became the one memory saved.

**UI build.** Pure helpers first (testable), then the ~640-line `OpenSpecBoardView.tsx`,
then route wiring. A `attached={null}` tweak decoupled explore/archive stepper states for
board cards.

**Verify.** Visual QA in an isolated `:8055` instance exposed a **blank board** — the route
matched but rendered nothing. Root cause: App.tsx had **three** overlay render sites and
only one got the board branch. The AI extracted the board to a single `const` and
referenced it in all three, rebuilt, and confirmed the board rendered against live data
(71 changes). It then tore down the preview and verified global settings were clean.

**Ship (steering-driven).** Human prompts drove the tail: `/skill:openspec-archive-change`
→ `commit and create PR` → `monitor CI` → `merge pr, delete branch, delete worktree`. CI
never dispatched at first because the PR was `CONFLICTING`; the AI diagnosed that GitHub
can't build the merge ref while conflicting, rebased onto `develop`, resolved two
append-only docs-index conflicts, force-pushed, watched CI go green, then squash-merged and
removed the worktree.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change redesign-openspec-board`.** Effective
  because the *spec did the talking*: a well-formed OpenSpec change with 39 concrete tasks
  meant the one-line invocation carried a full brief. **Lesson: invest in the proposal/spec
  so the kickoff can be a single skill call.**
- **`go on`** — a minimal continuation that let the AI keep executing the task list without
  micro-management. High-leverage precisely because the plan was already sound.
- **`commit and create PR`** / **`monitor CI`** / **`merge pr, delete branch, delete
  worktree`** — terse, high-trust ship commands. Each unlocked a whole phase because the AI
  already had the context to execute end-to-end.

Weak-prompt rewrite: instead of a bare `monitor CI`, a stronger version is *"monitor CI;
if it doesn't dispatch within a few minutes, check whether the PR is conflicting and rebase
onto develop"* — which pre-empts the exact dead end that occurred.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Pause after implementation, unsure whether to keep going | `go on` | State up front "run the full task list, then stop for archive" |
| Treat "done implementing" as the finish line | `/skill:openspec-archive-change`, `commit and create PR` | Chain apply→archive→PR in the initial ask |
| Wait passively on CI | `monitor CI` | Ask it to actively poll + diagnose non-dispatch (conflict → rebase) |
| Leave the worktree after merge | `merge pr, delete branch, delete worktree` | Include cleanup in the ship instruction |

Non-prompt guardrails the AI imposed on itself (repeat these): never restart the live
`:8000` server for QA — spin an isolated instance on an alt port; keep the commit surgical
by reverting the unrelated `.pi/settings.json` env mutation; confirm no worktree paths
linger in global settings after teardown.

## 6. Skills, tools & memory created — and why they're effective

- **Memory saved (project):** *"Git worktrees under `.worktrees/` start with NO
  `node_modules` — npm workspace symlinks resolve cross-package imports
  (`@blackbelt-technology/pi-dashboard-*`) to the MAIN checkout, so edits to other packages
  won't be picked up until you `npm install` in the worktree."* **Why effective:** this is
  the single most confusing failure mode of the whole session (edits silently ignored,
  imports resolving to the wrong tree). Capturing it turns a 10-minute head-scratch into a
  one-line reflex next time.
- **Subagents used:** `Explore` (harvest board impl details), two `general-purpose`
  (docs update + delta-spec sync). Delegating the docs write and spec sync respected the
  project's docs protocol and kept the main context lean.
- **Skill that *should* exist:** an "isolated-ui-verification" procedure — start a worktree
  build on an alt port, browser-verify, tear down, restore global settings. (This repo does
  in fact carry such a skill; invoke it rather than re-deriving the steps.)

## 7. Pitfalls & dead ends

- **Blank board despite a matching route.** App.tsx has **three** overlay render sites
  (desktop + two responsive). Editing one leaves the others rendering the landing fallback.
  *Fix:* extract the overlay element to a single `const` and reference it in all three.
- **Edits silently ignored / imports resolving to main checkout.** Fresh worktree has no
  `node_modules`. *Fix:* `npm install` inside the worktree before typechecking.
- **CI never dispatches.** The PR was `CONFLICTING` with `develop`; GitHub can't build the
  merge ref while conflicting, so `pull_request` checks are silently skipped. *Fix:* rebase
  onto `origin/develop`, resolve conflicts, force-push — CI then dispatches.
- **Flaky server tests ("Test timed out in 5000ms").** Environmental, from spawning real
  servers under heavy parallel load; they pass in isolation. *Fix:* run isolated with
  `HOME=$(mktemp -d) npx vitest run <files>` to confirm they're not real regressions.
- **Unrelated `.pi/settings.json` mutation** (`".."` → absolute path) crept into the diff
  from running the dashboard. *Fix:* revert it before commit to keep the change surgical.

## 8. Reproduce it faster — checklist

Inputs to have ready:
- A well-specced OpenSpec change (proposal + tasks) — the kickoff quality depends on it.
- The worktree at `.worktrees/<name>` and permission to `npm install` inside it.
- An alt port free for isolated QA (e.g. `:8055`); do NOT touch the live `:8000` daemon.

Checklist:
1. `/skill:openspec-apply-change <change>`.
2. Read delta specs; delegate deep harvest to `Explore`.
3. `npm install` in the worktree (fixes symlink resolution).
4. Build backend/shared foundation → typecheck before UI.
5. Pure helpers → board component → wire route in **all three** App overlay sites (via one `const`).
6. TDD: rewrite removed-behavior tests, add helper + store + component tests; isolate flaky server tests with `HOME=$(mktemp -d)`.
7. Isolated visual QA on alt port; tear down; verify clean global settings.
8. `/skill:openspec-archive-change` → sync specs via subagent → surgical commit → PR to `develop`.
9. Monitor CI; on non-dispatch, rebase to resolve conflicts, force-push, watch green.
10. Squash-merge → delete remote+local branch → remove worktree from the main repo.

Final artifacts produced:
- New: `packages/client/src/components/OpenSpecBoardView.tsx`, `FolderOpenSpecSection.tsx`; `packages/client/src/lib/openspec-board-order.ts`, `openspec-board-worktree.ts`; plus 5 test files.
- Edited: shared `types.ts`/`rest-api.ts`/`browser-protocol.ts`; server store + routes + `server.ts`; client `App.tsx`, `SessionList.tsx`, `useMessageHandler.ts`, `route-builders.ts`, `index.css`.
- Shipped: PR #112 squash-merged to `develop`; change archived to `openspec/changes/archive/2026-06-14-redesign-openspec-board/` with synced specs.

---

_Generated from session `019ec387-eeb4-78e5-b293-0a9bc319a02c` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-14. Source extract: `/var/folders/qb/m1_q3v6d5bnfzbpmc0dkkqx40000gn/T/facts-XXXXXX.nR0kNE9Jvi`._
