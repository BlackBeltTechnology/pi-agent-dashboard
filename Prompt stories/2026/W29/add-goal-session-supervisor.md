---
session: 019f596f
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); large facts sheet (~10732 tok)"
upgrade_status: pending
openspec_changes: [add-goal-session-supervisor, persist-goal-status-and-progress]
proposal_excerpt: "Today the `goal` feature *attaches* to a session but does not *own* it. The continuation loop lives inside the `@ricoyudog/pi-goal-hermes` extension, which runs **inside** the driver session. When that session dies (c…"
---

# How we did it: Add a goal session supervisor — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a single slash command:

```
/skill:openspec-apply-change add-goal-session-supervisor
```

The real objective behind it: implement a **47-task, high-risk OpenSpec change** that
moves the goal-continuation loop *out* of the driver pi session and into a
**main-server supervisor**. Today the goal feature *attaches* to a session but does
not *own* it — the continuation loop lives inside the `@ricoyudog/pi-goal-hermes`
extension running **inside** the driver session, so when that session dies the goal
stops advancing. The change makes the server own the loop: it detects driver death,
respawns a continuation session (real token/money spend when unattended), correlates
the new session back to the goal, and guards against runaway respawns (circuit
breaker + poison-pill backoff + cumulative-turn budget). A second prompt later —
`ship-change` — took the finished implementation all the way to a merged PR.

## 2. TL;DR playbook

1. **Load the apply skill from the main repo, not the worktree.** OpenSpec skills
   resolve from the parent repo root by project convention — the worktree's
   `.pi/skills` won't have them.
2. **Read *all* context before touching code.** Pull `openspec status` +
   `openspec instructions apply`, then read the full `proposal.md`, `design.md`,
   `tasks.md`, and every referenced source file in **batched reads**.
3. **Reconcile correction cycles first.** In a tasks.md with `9.x`/`10.x` correction
   blocks, those **supersede** the linear `1–8` tasks wherever they conflict.
   Implement the corrected behavior; mark superseded linear tasks `[~]`.
4. **`npm install` the worktree before typechecking.** A fresh `.worktrees/` checkout
   has **no `node_modules`** — cross-package imports resolve UP to the main repo, so
   your edits are invisible to `tsc`/`vitest` until you install worktree-local
   symlinks. (Save this as a memory — see §6.)
5. **Implement in TDD phases**, verifying `tsc --noEmit` + the focused suite after
   each: shared types → store → mechanical rename → correlation → supervisor →
   budget → client surfaces.
6. **Run the full suite once** before shipping (`npm test | tee /tmp/log`) to catch
   regressions from the rename + event-wiring edits.
7. **Ship with `ship-change`:** gate (build + tests) → `openspec archive` (syncs
   specs) → commit → push → PR against `develop` → watch CI → CodeRabbit fix loop →
   squash-merge → delete branch → remove worktree.
8. **Re-run CI on a known flake, don't chase it.** A jsdom `window`-teardown
   `ReferenceError` in an untouched file is a pre-existing flake; re-run the job.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & grounding (05:06–05:11).** The AI loaded the apply-change
skill (from the parent repo), pulled `openspec status`/`instructions apply`, and read
the proposal, design, tasks, and key source files in batches. It immediately flagged
two structural facts: (a) a **P0 prerequisite** (`persist-goal-status-and-progress`)
that had been *archived earlier the same day* and already delivered the durable
status/progress layer (`goal-status-projector.ts` + `GoalRecord.lastKnownTurnsUsed`
etc.), and (b) that the tasks.md carried **two doubt-review correction cycles
(9.x/10.x)** that override parts of the linear plan. *Why it worked:* the model
refused to write code until it had a complete mental model and had resolved which
version of each conflicting task to build.

**Phase 2 — Plan presentation (05:08).** Before editing, the AI presented an
assessment: foundation-in-place, genuinely high-risk, and an explicit rule — "I'll
implement the corrected (9.x/10.x) behavior wherever they conflict." It quantified
the mechanical rename surface (`abortAutomationRun → abortSpawnedRun`, 8 files) up
front. *Decision point:* it identified a **scope gap** — no `GoalPluginSettings` type
existed — and decided to add `autoRespawnDefault` via the established plugin-config
pattern rather than treat it as a blocker.

**Phase 3 — The worktree `node_modules` gotcha (05:16–05:20).** After the first store
edits, `tsc` didn't see the changes. The AI diagnosed that the worktree was never
`npm install`ed, so imports resolved to the **main repo's** packages. It ran
`npm install` to create worktree-local workspace symlinks, re-typechecked clean, and
**saved the gotcha to project memory** before continuing.

**Phase 4 — TDD implementation, 7 phases (05:15–06:00).** Shared types → store methods
→ the mechanical rename → correlation (stamping `goalId` on the headless-pid registry
keyed to the spawn token, making `getGoalId` the primary link and retiring the racy
cwd-FIFO) → the `goal-supervisor.ts` module → cumulative-turn budget → client status
surfaces. Each phase ended with `tsc --noEmit` + the focused vitest run. Two subtle
**threshold interactions** surfaced during supervisor tests (backoff index is
1-based because the current death is already recorded; the circuit breaker's rolling
window trips before poison-pill counting) — the AI recognized these as *correct
behavior* and fixed the naive tests, not the code.

**Phase 5 — Docs & task closure (05:54–06:00).** Per project Rule 6, it edited
`packages/**` `AGENTS.md` rows directly in caveman style and **delegated the
`docs/architecture.md` note to a general-purpose subagent**. Final state: 47/47 tasks
resolved (39 `[x]`, 5 superseded `[~]`, 0 open), full suite **9880 passed / 0 failed**.

**Phase 6 — Ship (09:18–10:31).** `ship-change`: build gate → `openspec archive`
(synced 11 requirements to `openspec/specs/goal-supervisor/spec.md`) → commit → PR
**#296** → CI. CI failed once on the jsdom flake; the AI recognized it as unrelated
and re-ran → green. Then a **3-round CodeRabbit loop**: 18 initial comments (posted in
the review body because inline-post hit a GitHub limit) triaged to real code issues
(per-goal lock, reason-resolved-at-classification, resume→fresh downgrade when the
session file is gone, explicit `headlessAvailable`, dispose on stop) → round-2 2
outside-diff nits → round-3 clean. Squash-merged (`67749c84`), branch + worktree
removed.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change add-goal-session-supervisor`.
  Effective because the *entire* specification already lived in the OpenSpec change
  (proposal + design + a 47-task tasks.md with correction cycles). The one-line
  invocation works precisely *because* the upstream planning was thorough — the ask
  is "execute this fully-specified plan," not "figure out what to build."
- **High-leverage follow-up** — `ship-change`. A single word that triggered the whole
  archive → PR → CI → review → merge → cleanup pipeline. Effective because the
  ship-change skill encodes every step, so the human only had to signal "it's ready."

*Rewrite for next time:* both prompts were already optimal. The leverage came from
**front-loading the spec** (so `apply-change` has everything) and **trusting the
skills** (so `ship-change` needs no babysitting). If your change is under-specified,
spend the planning turns first — don't expect `apply-change` to invent design.

## 5. Steering & corrections (what to watch for)

The human sent only two prompts, so the "steering" was almost entirely
**self-correction the AI performed against project rules** — which is exactly what a
future operator should bake in up front.

| The AI tended to… | The steer / rule that caught it | Bake this in next time by… |
|-------------------|----------------------------------|----------------------------|
| Look for the apply skill in the worktree's `.pi/skills` | Convention: OpenSpec skills resolve from the **main repo root** | State it in the kickoff or rely on the project doctrine — don't search the worktree |
| Treat linear tasks `1–8` as authoritative | tasks.md `9.x`/`10.x` **correction cycles supersede** conflicting linear tasks | Read the whole tasks.md and diff correction blocks *before* coding; mark superseded tasks `[~]` |
| Typecheck a worktree with no `node_modules` (edits invisible to tsc) | `npm install` the worktree to create workspace symlinks | Save it as a memory (done) and `npm install` immediately after `cd` into any `.worktrees/` checkout |
| Write naive threshold tests, then "fix the code" | The thresholds were **correct**; the tests were wrong (1-based backoff, breaker-before-poison window) | When a test fails on a boundary, re-derive the invariant before editing production code |
| Edit `docs/` prose directly | Rule 6: `docs/` writes go through a **subagent** in caveman style | Delegate every `docs/` prose write; edit only `packages/**` `AGENTS.md` rows directly |
| Chase a red CI run | The failure was a known jsdom `window`-teardown flake in an **untouched** file | Diagnose *which* test failed; if it's unrelated + timing-dependent, **re-run the job** |

Scope calls the operator should expect to make: (1) a **missing `GoalPluginSettings`
type** — resolved via the plugin-config pattern, not treated as a blocker; (2)
choosing the **corrected** spawn mechanism (`spawnPiSession` continue-mode over
`--resume`) and the **corrected** death hook (`sessionManager.onUnregister` via
`dispatchPluginSessionEnded`, not a plugin-side `ctx.onSessionEnded`).

## 6. Skills, tools & memory created — and why they're effective

- **Memory saved (project scope):** *"Worktrees under `.worktrees/` start with NO
  `node_modules` — cross-package imports (`@blackbelt-technology/pi-dashboard-shared`
  etc.) resolve UP to the main repo's `node_modules` symlinks, so worktree edits the
  local `tsc`/`vitest` won't see until you `npm install` the worktree."* This removes
  a 4-minute dead end (edits silently invisible to the typechecker) from every future
  worktree session. **Invoke:** automatically recalled whenever you start work in a
  `.worktrees/` checkout.
- **Subagent used:** a `general-purpose` agent for the `docs/architecture.md`
  goal-supervisor note — enforcing the Rule-6 caveman-style docs delegation without
  the main agent context-switching into prose mode.

*Skill that should exist:* a **`worktree-first-touch`** procedure — "on entering any
`.worktrees/` checkout: `npm install`, confirm the workspace symlinks resolve, then
typecheck" — would make step 4 of the playbook automatic rather than a
learned-the-hard-way diagnosis.

## 7. Pitfalls & dead ends

- **`tsc` sees the main repo, not your worktree edits.** Symptom: you edit
  `packages/shared/src/types.ts`, `tsc --noEmit` still errors on the old shape. Fix:
  `npm install` inside the worktree to create local workspace symlinks.
- **Server `tsconfig.json` has pre-existing test errors + rootDir constraints.** It's
  *not* the repo's real typecheck path. Fix: use the root `npx tsc --noEmit` (workspace
  project references), not the per-package server tsconfig.
- **`biome --changed` finds nothing** for uncommitted-vs-base diffs. Fix: lint the
  explicit changed-file list instead of relying on `--changed`.
- **Event ordering trap:** the goal-link arm in `onSessionRegistered` fires *before*
  `onEvent`'s `linkByToken`, so `getGoalId(sessionId)` isn't resolvable there. Fix:
  move the goal-link into the `onEvent` `session_register` branch, right after
  `linkByToken`.
- **CI red on a jsdom `window` flake** in `useActiveChatSelection.test.tsx` (React's
  scheduler firing a microtask after the env tore down `window`). Untouched by this
  change → re-run the job, don't debug it.
- **`gh pr merge --delete-branch` fails on a worktree collision** when the session runs
  *inside* the worktree being merged. Fix: merge succeeds server-side; delete the
  remote branch and remove the worktree manually from the parent afterward.
- **CodeRabbit's inline comments "failed to post"** (GitHub inline limit) — the 18
  findings were in the **review body**, not inline threads. Fix: fetch and parse the
  review body, don't assume "no inline comments" means "clean."

## 8. Reproduce it faster — checklist

**Inputs to have ready**
- A fully-specified OpenSpec change (`proposal.md` + `design.md` + `tasks.md`), ideally
  with any doubt-review correction cycles already folded in.
- A git worktree for the change branch (`.worktrees/os-<change>`).
- `gh` authenticated; CI + CodeRabbit configured on the repo.

**Checklist**
1. `cd` into the worktree → **`npm install`** (creates workspace symlinks).
2. Load `openspec-apply-change` **from the main repo root**; pull `status` +
   `instructions apply`.
3. Batch-read proposal/design/tasks + all referenced source; **reconcile `9.x`/`10.x`
   corrections** over linear tasks.
4. TDD phase-by-phase (types → store → rename → correlation → supervisor → budget →
   client), verifying `npx tsc --noEmit` + focused `vitest` after each.
5. Run the **full suite** once (`npm test | tee /tmp/log`); confirm 0 failures.
6. Update `packages/**` `AGENTS.md` rows directly; **delegate `docs/` prose to a
   subagent** (caveman style).
7. Mark tasks (`[x]` done, `[~]` superseded); confirm 0 open non-QA tasks.
8. `ship-change`: build gate → `openspec archive` → commit → PR vs `develop` → CI
   (re-run known flakes) → CodeRabbit loop (read the review **body**) → squash-merge →
   delete branch → remove worktree.

**Artifacts produced**
- New: `packages/server/src/goal-supervisor.ts` (+ tests),
  `packages/goal-plugin/src/client/goal-settings.ts`,
  `packages/server/src/__tests__/headless-pid-registry-goal-id.test.ts`,
  `packages/goal-plugin/src/__tests__/status-meta.test.ts`.
- Edited: shared `types.ts`, `goal-store.ts`, `goal-routes.ts`, `event-wiring.ts`,
  `server.ts`, `headless-pid-registry.ts`, `goal-session-primer.ts`, the goal-plugin
  client surfaces, and 5 `AGENTS.md` rows.
- Spec: `openspec/specs/goal-supervisor/spec.md` (11 requirements synced on archive).
- **PR #296 — merged** (squash `67749c84`) on `develop`.

---

_Generated from session `019f596f-b0a4-7464-96f0-9d8a07517ca2` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-13. Source extract: `/tmp/facts-32066.md`._
