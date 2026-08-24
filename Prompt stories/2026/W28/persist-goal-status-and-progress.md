---
session: 019f5877
week: 2026/W29
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [persist-goal-status-and-progress]
proposal_excerpt: "The durable `GoalRecord` does not reflect the live loop. `goal-verdict-accumulator.ts` consumes the `goal_status` snapshot stream but only **appends verdicts** — it never writes `GoalRecord.status` back, and it never…"
---

# How we did it: Persist goal status & progress into the durable GoalRecord — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single command:

```
/skill:openspec-apply-change persist-goal-status-and-progress
```

The *real* objective, spelled out in the change proposal: the durable `GoalRecord`
did not reflect the live goal loop. `goal-verdict-accumulator.ts` consumed the
`goal_status` snapshot stream but only **appended verdicts** — it never wrote
`GoalRecord.status` back and never persisted turn/progress accounting. So a restart
lost the live status. The task was to add a **projector** that maps live status →
durable status, accumulate turn counts durably (restart-safe), stamp progress time,
verify with tests, and ship the whole thing through the OpenSpec archive → PR →
merge pipeline. One 1h43m session, zero code review rounds, merged on first CI pass.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change>` — kick off apply against the change's `tasks.md`.
2. Read the OpenSpec context (`openspec instructions apply --json`) + every touched source file **before** writing a line.
3. Implement in dependency order: **types first** (`shared/types.ts`), then the **store method** (`applyStatus` under the write mutex), then the **projector** (new peer consumer beside the accumulator), then **wire into `server.ts`**.
4. Write projector + store tests; run the goal-only suite in isolation: `HOME=$(mktemp -d) npx vitest run …/goal-*.test.ts` — the `HOME=$(mktemp -d)` avoids polluting real `~/.pi`.
5. Run the discipline checkpoints named in `tasks.md` (here: **doubt-driven-review** on turn accounting, **observability-instrumentation** on restart-durability) and reason them through against the code, in prose.
6. Fix Biome by isolating your **new** files vs pre-existing debt: `npx biome check --error-on-warnings <new files>` — count diagnostics on HEAD vs now to prove you introduced zero.
7. If `tsc` can't see your new shared types in a worktree → the worktree has no local `node_modules`, so resolution walks up to the stale main repo copy. Run `npm install` in the worktree, then **`git checkout package-lock.json`** to keep the diff surgical.
8. `ship-change`: verify gate (full test + client build), archive + sync specs (delegate spec sync to a subagent), commit via a file (`-F /tmp/msg`), push, open PR against `develop`, watch CI, confirm 0 actionable CodeRabbit threads, squash-merge, remove worktree from the **parent** repo.

## 3. How the collaboration unfolded

**Phase 1 — Locate the skill (steered).** The first apply attempt failed because the
OpenSpec skills weren't resolvable inside the worktree. `ls ~/.pi/skills/ .pi/skills/`
+ a filesystem-wide `find` came back empty. The human steered: *"maybe the opsx
skills are not presented in worktree. in this case use worktree parent folder's
skill"*. That unlocked everything — the apply/archive skills live at the **main repo
root**, not the checkout.

**Phase 2 — Discovery.** The AI read `tasks.md`, ran `openspec instructions apply
--json`, then grepped for every goal symbol (`GoalRecord`, `GoalVerdict`,
`createGoalVerdictAccumulator`, the `GOAL_STATUS_MESSAGE` handler in `server.ts`) and
read the store + accumulator + existing tests. *Why it worked:* full context before
the first edit — the model could place the new projector as a faithful peer of the
existing accumulator instead of guessing.

**Phase 3 — Implement in dependency order.** Types → store `applyStatus` (durable
increment under the write mutex) → new `goal-status-projector.ts` → server wiring.
The projector maps `active→pursuing`, `paused→paused`, `done→achieved`,
`cleared→cleared`, idempotent (writes only on status change), with per-driver turn
accounting `delta = max(0, turnsUsed − prevForDriver)`.

**Phase 4 — Verify.** 26 goal tests green. Then the two **discipline checkpoints
from `tasks.md`** were reasoned through in prose: doubt-driven-review proved the turn
accounting had no double-count / no missed-zero / no negative bug and named the one
residual (post-server-restart re-count, explicitly deferred to a future supervisor
change); observability confirmed the fields survive restart via the atomic store write.

**Phase 5 — Ship (steered).** The human said *"I will test later, ship-change"*,
deferring the one manual restart-QA task (6.3) and launching the pipeline: verify
gate → archive + spec sync (delegated to a `general-purpose` subagent) → commit →
PR **#292** → CI green (10m22s) → CodeRabbit 0 actionable → squash-merge → worktree
removal. Merged first pass.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change persist-goal-status-and-progress`.
  Effective because the change already had a complete `tasks.md`; the skill turns a
  vetted plan into a checkbox-driven implementation. *Stronger next time:* prepend
  "resolve OpenSpec skills from the main repo root, this is a worktree" to pre-empt
  Phase 1's dead end.
- **High-leverage steer #1** — *"use worktree parent folder's skill"*. One sentence
  that unblocked the entire session; it's really a standing convention, not a one-off.
- **High-leverage steer #2** — *"I will test later, ship-change"*. Short, decisive:
  authorizes deferring the manual QA task and hands off to the ship pipeline in one go.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Look for OpenSpec skills inside the worktree (empty) | "use worktree parent folder's skill" | State up front: in a worktree, resolve OpenSpec skills from the main repo root (already an AGENTS.md convention) |
| Treat the full-suite flakes as blockers | (implicit) — user pre-authorized shipping | Run the goal-only suite first; confirm unrelated failures are pre-existing on base before treating them as blockers |
| Wait on the manual restart-QA task (6.3) | "I will test later, ship-change" | Mark manual/QA-only tasks as deferred and proceed when the user signals |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session ran entirely on existing skills
(`openspec-apply-change`, `ship-change`) and existing discipline checkpoints
(`doubt-driven-review`, `observability-instrumentation`). That's the point: a
well-formed `tasks.md` plus the discipline-checkpoint table made the work almost
mechanical.

*What should be captured* (and likely already is, in project memory): the two
worktree quirks that cost the most time — (a) OpenSpec skills resolve from the main
repo root, and (b) `tsc` in a fresh worktree resolves shared packages to the stale
main copy until `npm install` runs locally, after which `package-lock.json` must be
restored to keep the diff surgical. Those are the reusable, high-value lessons.

## 7. Pitfalls & dead ends

- **OpenSpec skill not found in worktree** → resolve from the parent/main repo root.
- **New shared types invisible to `tsc`** → the worktree has no local `node_modules`;
  module resolution walks up to the main repo's stale `packages/shared`. Fix: run
  `npm install` in the worktree.
- **`npm install` mutated `package-lock.json`** (pruned macOS-only optional
  electron-forge deps) → `git checkout package-lock.json` to keep the diff surgical;
  `node_modules` stays installed.
- **`biome --changed` found 0 files** → it diffs committed work vs `develop`; your
  work is uncommitted in a worktree. Run the gate components explicitly on the changed
  files and compare diagnostic counts HEAD-vs-now to prove zero introduced.
- **Full-suite failures (server-spawn timeouts, image/event-wiring)** → load-dependent
  and/or pre-existing on base. Confirm by stashing your change and re-running on the
  base branch; don't treat as your regression.
- **`--delete-branch` hit a worktree/`develop` collision** → the remote merge still
  succeeded; delete the remote branch and remove the worktree from the **parent** repo.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a complete `openspec/changes/<name>/tasks.md`; the worktree
checked out; `gh` authed; awareness that OpenSpec skills live at the main repo root.

- [ ] `/skill:openspec-apply-change <name>` (skills from main repo root if in a worktree).
- [ ] Read apply instructions + all touched source before editing.
- [ ] Implement types → store → projector → server wiring.
- [ ] Tests via `HOME=$(mktemp -d) npx vitest run …/goal-*.test.ts`.
- [ ] Reason through the discipline checkpoints named in `tasks.md`, in prose.
- [ ] Biome: check new files in isolation; prove 0 new diagnostics vs HEAD.
- [ ] `tsc` fails on shared types? → `npm install` in worktree, then `git checkout package-lock.json`.
- [ ] `ship-change`: verify → archive + sync (subagent) → commit `-F` → PR → CI → CodeRabbit → squash-merge → remove worktree from parent.

**Artifacts produced:**
- `packages/server/src/goal-status-projector.ts` (new)
- `packages/server/src/__tests__/goal-status-projector.test.ts` (new)
- edits: `packages/shared/src/types.ts`, `packages/server/src/goal-store.ts`,
  `packages/server/src/server.ts`, goal-store test, `server/src/AGENTS.md`
- new capability spec `openspec/specs/goal-status-persistence/`, change archived
- PR **#292** — squash-merged into `develop` (SHA `0867c599`), CI green, 0 review rounds

---

_Generated from session `019f5877-43db-72fe-a258-d97b88535310` · `pi-agent-dashboard` · 2026-07-13. Source extract: `/tmp/facts-25140-1784848316.md`._
