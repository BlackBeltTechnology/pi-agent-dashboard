---
session: 019de8e6
week: 2026/W18
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-jj-workspace-root-probe, add-jj-workspace-plugin, relax-tasks-parser-id-optional]
---

# How we did it: Land the last phase of add-jj-workspace-plugin, spin off a follow-up proposal, and archive — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was the standard `/opsx:apply` prompt — *"Implement tasks from an OpenSpec change."* No change name was supplied, so the AI had to infer the target from context and pick up the only active one: **`add-jj-workspace-plugin`**.

The *real* objective, once the two steering turns landed, was three-fold:
1. Finish the **last actionable slice** of a mostly-done change (Phase 4c — workspace-aware session grouping), TDD-style.
2. **Spin off** the loose ends that didn't belong in this change into a *new proposal* (`fix-jj-workspace-root-probe`) rather than smuggling them in.
3. **Archive** the completed change and **commit only the relevant files** — leaving a messy working tree of unrelated proposals untouched.

In short: *close out one change cleanly, hand the debt forward as a first-class proposal, and cut a surgical commit.*

## 2. TL;DR playbook

1. Run `/opsx:apply` with no name → let the AI announce **"Using change: add-jj-workspace-plugin"** after `openspec status --json` confirms it's the only active change.
2. Have the AI read `tasks.md` + `design.md` and report progress precisely: **62/69, 3 actionable + 4 deferred**. Scope to *just the actionable* tasks.
3. **TDD the slice:** write `session-grouping.test.ts` first (5 cases: collapse, pin-overrides-collapse, cluster ordering, no-`jjState` regression guard, `workspaceRoot === cwd` edge), then implement `resolveSessionGroupPath` + `clusterByWorkspaceName` in `session-grouping.ts`.
4. Run tests with a **clean HOME**: `HOME=$(mktemp -d) npx vitest run <file>` — isolates localStorage/env-polluted neighbours so you can tell *your* failures from pre-existing ones.
5. Update `AGENTS.md`, mark tasks 62–64 `[x]`, and **stop** — announce "Implementation Paused" with the deferred tasks called out.
6. On "create new proposal with remaining task and archive": discover the CLI verb (`openspec new change --help`), scaffold `fix-jj-workspace-root-probe`, write proposal/design/spec-delta/tasks, then `openspec validate <name>`.
7. `openspec archive add-jj-workspace-plugin --yes` → it promotes the delta into a new main spec at `openspec/specs/jj-workspace-plugin/spec.md`.
8. On "commit": `git status` first, then **explicitly `git add` only your files** (Phase 4c code + new proposal + archive), write a descriptive Conventional-Commit message, and list the unrelated items you deliberately left behind.

## 3. How the collaboration unfolded

**Phase A — Orient & scope (`status` → `instructions apply`).**
The AI ran `openspec status --change ... --json` and `openspec instructions apply --json`, parsed the schema (`spec-driven`), and reported **62/69 complete: 3 actionable + 4 deferred to release time**. *Why it worked:* it refused to treat "remaining" as one bucket — separating actionable from deferred is what let it finish cleanly without touching release-time smoke tests.

**Phase B — TDD the last slice (Phase 4c).**
It grepped the design doc for *Decision 15* and the relevant types (`JjState`, `workspaceRoot`, `session-grouping`), **wrote the test file first**, then implemented `resolveSessionGroupPath` (precedence **pin > `jjState.workspaceRoot` > `cwd`**) and a private `clusterByWorkspaceName` stable-sort. *Why it worked:* tests-first pinned the precedence contract before a single line of grouping logic existed.

**Phase C — Isolate the test signal.**
First `vitest` run showed failures. Rather than chase them, the AI re-ran with `HOME=$(mktemp -d)` and correctly attributed the noise to **pre-existing `draft-storage.test.ts` localStorage failures**, unrelated to the change. Its own 5 tests + the neighbouring path-drift/search/ended-sort tests passed. *Decision point:* don't fix what you didn't break — just prove it.

**Phase D — Pause, then spin off the debt (steering #1).**
The human said *"create new proposal with remaining task and archive."* The AI didn't know the exact CLI verb, so it probed `openspec new change --help`, scaffolded **`fix-jj-workspace-root-probe`**, and wrote all four artifacts. The crux it captured: `gatherJjInfo` calls `jj workspace root` (the *current workspace's* cwd) but Decision 15 expects `JjState.workspaceRoot` to be the *parent repo root* — a real probe-vs-spec mismatch, now a first-class proposal instead of a hidden hack. `openspec validate` passed.

**Phase E — Archive & surgical commit (steering #2).**
`openspec archive add-jj-workspace-plugin --yes` promoted the spec delta into a new main spec. On *"commit"*, the AI ran `git status`, saw **several unrelated working-tree changes**, and **explicitly `git add`-ed only its own files**, then committed `1f6ae0c` (14 files, 857+/10−) with a message that named the deferred items and the untouched unrelated ones.

## 4. Prompts that worked

- **The goal prompt** (`/opsx:apply`, no name): effective *because the skill already encodes the disambiguation ladder* — infer → auto-select single active → ask if ambiguous. A future operator can lean on it, but naming the change (`/opsx:apply add-jj-workspace-plugin`) skips a `status` round-trip.
- **High-leverage follow-up #1** — *"create new proposal wirth remaining task and archive"* (typo and all): one short sentence that forced the right *architecture* decision — hand debt forward as a proposal, don't inline it. Stronger rewrite: *"Move the remaining/unfit tasks into a new OpenSpec proposal, validate it, then archive this change."*
- **High-leverage follow-up #2** — *"commit"*: trusted the AI to scope the commit. It worked because the AI defaulted to `git status` + explicit `git add` rather than `git add -A`. Stronger rewrite: *"Commit only this change's files; leave the other working-tree proposals untouched."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after finishing the actionable tasks (correctly "paused") | "create new proposal with remaining task and archive" | State up front: *finish the slice, then spin remaining/unfit work into a new proposal and archive.* |
| Risk carrying a probe-vs-spec mismatch as an undocumented gap | (implicit via "remaining task") — AI self-flagged it | Encode the rule: *any spec/impl mismatch discovered mid-apply becomes a follow-up proposal, never a silent fix.* |
| Potentially `git add -A` in a dirty tree | "commit" (AI self-corrected to explicit adds) | Say *"commit only my files"* — or rely on the discipline of `git status` → explicit `git add`. |

The standout quality bar the human's terse prompts *implicitly* enforced: **surgical scope**. Every step — actionable-only tasks, isolated test HOME, explicit `git add`, deferred-task callouts — kept the blast radius minimal in a repo full of parallel in-flight proposals.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — it was a straight application of existing OpenSpec skills (`openspec-apply-change`, `openspec-new-change`, `openspec-archive-change`).

**Recommended skill to create** (the workflow is clearly repeatable): a **"finish-and-fork" OpenSpec closeout** procedure —
- *What it captures:* the pattern of *finish actionable tasks → fork remaining/unfit work into a new validated proposal → archive → surgical commit*, with the `HOME=$(mktemp -d) vitest` isolation trick and the explicit-`git add` discipline baked in.
- *Why it's effective:* removes three recurring judgement calls (what counts as "done", where deferred work goes, what to commit in a dirty tree) and makes them mechanical.
- *When to invoke:* any `/opsx:apply` where progress is near-complete and the tree has unrelated in-flight changes.

## 7. Pitfalls & dead ends

- **Test noise from neighbours.** `vitest` failures in `draft-storage.test.ts` were **pre-existing localStorage/env issues**, not yours. *If you hit red tests, re-run with `HOME=$(mktemp -d)` and diff against the untouched files before debugging.*
- **Unknown CLI verb.** The AI burned a few calls probing `openspec new --help` / `openspec new change --help` to find the scaffold command. *If unsure, go straight to `openspec new change --help`.*
- **One failed command:** an `ls openspec/changes/.../specs/ && ls openspec/specs/ | grep -i jj` combo errored (spec dir shape wasn't as assumed) — recovered by listing the two locations separately. *Don't chain `ls` on paths you haven't confirmed exist.*
- **Dirty working tree trap.** The repo held `adapt-windows-integration-pr9/`, `add-openspec-jj-bridge/`, `auto-scroll-selected-session-card/`, an `npm-trusted-publishing` archive move, and a `.shadow/` jj workspace dir. *A blind `git add -A` would have swept all of these into your commit — always `git status` first and add explicitly.*

## 8. Reproduce it faster — checklist

- [ ] `openspec status --change <name> --json` → confirm it's the target; separate **actionable vs deferred** tasks.
- [ ] Read `tasks.md` + relevant `design.md` decision(s); scope to actionable only.
- [ ] **Write the test file first** (cover happy path, precedence override, ordering, regression guard, boundary edge).
- [ ] Implement to green: `HOME=$(mktemp -d) npx vitest run <test-file>` — isolate env noise.
- [ ] Update `AGENTS.md` / docs; mark completed task IDs `[x]`; announce a **pause** with deferred tasks listed.
- [ ] For leftover/unfit work: `openspec new change <name> --description ...`, write proposal/design/spec-delta/tasks, `openspec validate <name>`.
- [ ] `openspec archive <original> --yes` (promotes delta → main spec).
- [ ] `git status` → **explicit `git add`** of your files only → Conventional-Commit message naming deferred + deliberately-untouched items.

**Key inputs to have ready:** an active OpenSpec change with a clear tasks.md; a repo where `jj`/`openspec` CLIs are installed; awareness of which working-tree changes are *not* yours.

**Final artifacts produced:** `packages/client/src/lib/session-grouping.ts` (edited) + `__tests__/session-grouping.test.ts` (new, 5 tests); `openspec/changes/fix-jj-workspace-root-probe/` (new proposal, 4 artifacts, validates); `add-jj-workspace-plugin` archived → `openspec/specs/jj-workspace-plugin/spec.md`; commit `1f6ae0c` (14 files, 857+/10−).

---

_Generated from session `019de8e6-0071-72a4-8cd0-2b37e3eed01a` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-02. Source extract: session facts sheet (deterministic extract)._
