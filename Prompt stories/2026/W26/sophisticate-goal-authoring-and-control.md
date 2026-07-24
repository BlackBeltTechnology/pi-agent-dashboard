---
session: 019ef265
week: 2026/W26
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [sophisticate-goal-authoring-and-control]
proposal_excerpt: "The `goal` plugin wraps `@ricoyudog/pi-goal-hermes` — a Pi port of Hermes's \"Ralph loop with a judge\". The judged loop has real knobs (judge model, turn budget, acceptance criteria, lifecycle), and the dashboard's `Go…"
---

# How we did it: Sophisticate goal authoring & control — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change sophisticate-goal-authoring-and-control
```

The real objective: take a fully-specified OpenSpec change and **implement all 16
tasks end-to-end** across four components of the dashboard monorepo — shared types,
the main server, the `goal-plugin` server, and the React client — then ship it. The
change "sophisticates" the goal plugin (a Pi port of Hermes's "Ralph loop with a
judge") by adding a real judge/verdict data model, a rich authoring form, loop-control
UI, verdict timelines, and dashboard-side budget enforcement. The second prompt, ~4h
later, turned "implemented" into "shipped": archive → PR → CI → CodeRabbit fixes →
merge → clean up worktree.

## 2. TL;DR playbook

1. **Open the skill from the main repo, not the worktree.** In a worktree, `.pi/skills`
   is a symlink — read the apply instructions from the resolved main-repo path.
2. **Read all context first** (`proposal.md`, `design.md`, specs, key impl files)
   before touching code. Build a complete mental model of the 16-task, 4-component map.
3. **Surface the design's open decisions and confirm them with ONE `ask_user`** before
   writing code — here, *where verdict accumulation lives* (main server vs plugin
   server). Getting placement wrong = large rework.
4. **Install workspace symlinks in the worktree** (`npm install`) — a fresh worktree
   has no `node_modules`, so cross-package `@blackbelt-technology/*` imports resolve to
   the *main* repo and your worktree type edits are invisible at runtime.
5. **TDD each task group**: write the test, run it red, implement, run green. Group by
   component (data model → server → loop coupling → client) and **commit per group**.
6. **Run tsc via the root solution-style references**, not per-package (`tsc -p
   packages/x` throws project-reference noise). Use ephemeral `HOME=$(mktemp -d)` for
   vitest to avoid touching real `~/.pi`.
7. **Delegate all `docs/` writes to a subagent** with the caveman-style rule verbatim
   (project convention).
8. **Ship on the second prompt**: `openspec change archive` (needs `echo Y |`), PR
   against **`develop`** (not `main`), watch CI + CodeRabbit, triage every review
   thread in a table, batch-fix the valid ones, re-push, merge squash, remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read before write).** The AI resolved the symlinked skill,
read the OpenSpec artifacts and the implementation files, then traced *where
`goal_status` snapshots get their `goalId`* server-side. This mapped the change into
"well-defined tasks I can TDD directly" vs "decisions the design left open." Effective
because it front-loaded the architectural risk instead of discovering it mid-edit.

**Phase 2 — Confirm the open decision (one question).** Before any code, the AI called
`ask_user` once to confirm the load-bearing choice: the plugin's `ServerPluginContext`
has **no `GoalStore` access**, so verdict accumulation must live in the **main server**
next to `applyGoalIdToSession`, not the plugin server. The human confirmed; the AI said
"All confirmed. Starting implementation." One decision point, cheaply resolved.

**Phase 3 — Generate, group by component, commit per group.** Four commits:
- *Data model* — `GoalJudge`, `GoalVerdict`, `GOAL_VERDICTS_CAP=50`, optional
  `judge?`/`verdicts?` on `GoalRecord` (additive → no schema bump, legacy records load
  unchanged).
- *Server* — `parseJudge` validation mirroring `parseBudget`; `goal-store.appendVerdict`
  (FIFO cap); a new `goal-verdict-accumulator` `goal_status` consumer wired into the
  main server.
- *Loop coupling* — `probe.ts` tier selection (`full` / `criteria-dashboard-budget` /
  `intent-only`) with a config-command upgrade seam; `goal-budget-guard.decideBudgetHalt`
  for dashboard-side cap enforcement.
- *Client* — `GoalForm`, `useJudgeModels` (from `/api/favorite-models`), enriched
  `GoalControl` chip, `GoalDetailClaim` loop-control bar + verdict timeline, delete
  affordances — each with new/updated tests.

**Phase 4 — Verify.** Full `npm test` surfaced one failure in `doctor-route.test.ts`
(3078ms vs 3000ms threshold). The AI re-ran it in isolation, confirmed a **timing
flake unrelated to goals**, and moved on. Docs (task 6.1) went through a subagent.
Reported 15/16 done — only the live manual UI walkthrough left for the human.

**Phase 5 — Ship (second prompt).** The human handed an 8-step pipeline. The AI
archived + synced specs, discovered the PR base is **`develop`** not `main`, opened
PR #153, waited out CI (~8m on ~800 test files) and CodeRabbit, then triaged **11
actionable review comments in a table** and batch-fixed all 11 (input validation, race
guards, command-injection sanitization, test hygiene, intent-only no-op). Re-push,
green, squash-merge, branch + worktree removed. Final: +1,592/−130 across 32 files.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change <name>`. Effective because the
  change was *already fully specified* in OpenSpec: proposal, design, tasks, specs. The
  skill gave the AI a 16-task contract to execute, not a vague ask. **Lesson: invest in
  the spec so the kickoff can be one line.**
- **High-leverage follow-up** — the ship pipeline as a numbered list:
  `1. tests manual later 2. archive/sync 3. create PR 4. monitor CI 5. fix coderabbit
  6. merge PR 7. delete branch 8. delete worktree`. Eight words per step, zero
  ambiguity, executed sequentially without further questions. **This is the model
  steering prompt: an explicit ordered checklist beats prose.**

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at "implemented" (15/16, manual UI left) | Handing an explicit 8-step ship checklist | Include the ship pipeline in the apply skill / state "implement AND ship" up front |
| Defer the manual UI task as a blocker | "tests manual later" (accept the deferral) | Mark manual-only tasks as human-deferred, don't block the pipeline on them |
| Assume PR base is `main` | (self-corrected) discover default branch is `develop` | State the base branch (`develop`) in the ship instruction |

The bulk of "correction" here was **self-correction**, not human redirection: PR base
`main→develop`, per-package tsc noise → root references, worktree missing
`node_modules` → `npm install`, timing flake → re-run in isolation. The human's only
steering was the ship checklist. A well-specified change plus a disciplined AI kept the
human turns to two.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — the work *consumed* existing
project infrastructure rather than producing reusable procedure:

- **`openspec-apply-change`** drove the whole implementation from a spec.
- **A `general-purpose` subagent** wrote the `docs/file-index` rows in caveman style
  (project convention: all `docs/` writes go through a subagent with the rule verbatim).
- **`ask_user`** was used exactly once, for the one load-bearing decision — the right
  frequency (confirm the irreversible, TDD the rest).

If anything deserves capture, it's the **worktree symlink gotcha** (below) — a
recurring cross-package trap worth a project memory.

## 7. Pitfalls & dead ends

- **Worktree has no `node_modules`.** Cross-package `@blackbelt-technology/*` imports
  resolve to the *main repo*, so worktree edits to shared types are invisible at
  runtime and tests read stale values (`GOAL_VERDICTS_CAP` resolved `undefined`).
  **Fix:** `npm install` in the worktree to create workspace symlinks, then re-run.
- **Per-package `tsc -p packages/x/tsconfig.json`** emits project-reference/config
  artifacts that look like errors. **Fix:** typecheck via the root solution-style
  references (`npx tsc --noEmit` at repo root).
- **`openspec archive` prompts interactively** and fails in a non-TTY. **Fix:**
  `echo "Y" | openspec archive <name>`.
- **PR against `main` fails** ("no commits between") — the repo's default is `develop`.
  **Fix:** `gh pr create --base develop`.
- **`doctor-route.test.ts` timing flake** (~3078ms vs 3000ms). **Fix:** re-run in
  isolation to confirm it's a flake, not a regression; don't chase it.
- **Fire-and-forget verdict appends need >1 tick to flush** in tests. **Fix:** use
  `waitFor` on the observable state, not a fixed `setTimeout`/single-tick flush.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- A fully-specified OpenSpec change (`proposal.md`, `design.md`, `tasks.md`, specs).
- The worktree already created; know the PR base branch is **`develop`**.
- `gh` authenticated; CodeRabbit enabled on the repo.

**Checklist:**
1. Read the skill from the **main repo** (symlink), not the worktree.
2. Read all context files + trace the load-bearing data flow before editing.
3. `ask_user` once to confirm any design-open architectural placement.
4. `npm install` in the worktree (workspace symlinks) — *do this before the first test*.
5. TDD per component group (data → server → coupling → client); **commit per group**.
6. Typecheck at repo root; run vitest with `HOME=$(mktemp -d)`.
7. Delegate `docs/` rows to a subagent (caveman style verbatim).
8. Ship: `echo Y | openspec archive` → sync → `gh pr create --base develop` → watch
   CI + CodeRabbit → triage every thread in a table → batch-fix → re-push → squash-merge
   → `git worktree remove`.

**Final artifacts produced:**
- `packages/shared/src/types.ts` (`GoalJudge`, `GoalVerdict`, `GOAL_VERDICTS_CAP`).
- `packages/server/src/goal-verdict-accumulator.ts`, `goal-budget-guard.ts` (+ tests).
- `packages/goal-plugin/src/server/probe.ts` (+ test).
- `packages/goal-plugin/src/client/GoalForm.tsx`, `useJudgeModels.ts`, enriched
  `GoalControl.tsx` / `GoalDetailClaim.tsx` / `GoalsBoardClaim.tsx` (+ tests).
- Archived spec `openspec/specs/goal-authoring/spec.md`; merged PR
  [#153](https://github.com/BlackBeltTechnology/pi-agent-dashboard/pull/153)
  (+1,592/−130, 32 files).

---

_Generated from session `019ef265` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-23. Source extract: deterministic facts sheet (mktemp)._
