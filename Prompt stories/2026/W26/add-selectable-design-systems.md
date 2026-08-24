---
session: 019ef6d6
week: 2026/W26
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [add-selectable-design-systems]
proposal_excerpt: "`@blackbelt-technology/frontend-mockup-loop` (`packages/mockup-loop/`) ships a generic ground→contract→mockup→test→fix→learn loop, but it is **design-system agnostic**: `init_ui_contract` emits a blank template and s…"
---

# How we did it: Add selectable design systems to the mockup-loop package — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single slash-command:

```
/skill:openspec-apply-change add-selectable-design-systems
```

That's the whole goal statement — "implement this already-planned OpenSpec change."
The *real* objective, once the change's 25 tasks were read, was: extend the generic,
design-system-agnostic `@blackbelt-technology/frontend-mockup-loop` package so an
operator can **select a named design system** (shadcn, MUI, Material 3, Fluent 2,
Apple HIG). That meant a preset registry, DTCG token contracts + rubrics per system,
a 4-layer validator pipeline (token-lint → a11y floor → named auditor → boolean
rubric), two new tools (`list_design_systems`, `validate_mockup`), a `system?`/`refresh?`
extension of `init_ui_contract`, tests, and docs — then ship it as a PR to `develop`.

## 2. TL;DR playbook

1. Kick off with the apply skill against the named change: `/skill:openspec-apply-change add-selectable-design-systems`. Let the model read the change's context files + all 25 tasks before writing a line.
2. **Probe the ground first.** Have it check whether optional deps (axe, playwright) are installed *before* planning — the answer shapes the architecture (graceful dynamic-import fallback vs hard require).
3. Build core modules in task order: `registry.ts` (preset type + 5 presets) → `contract.ts` (DTCG loader) → per-system `presets-data/*/contract.tokens.json` + `rubric.json` → `validators.ts` (the 4-layer pipeline) → wire tools into `extension.ts`.
4. Declare bundled deps in the package's own `package.json` `dependencies` + `files`; run `npm install` once at the repo root to hoist.
5. Write `vitest.config.ts` + tests (`presets.test.ts`, `extension.test.ts`), register the package in the **root** vitest config, run `npx tsc --noEmit` then `npx vitest run` until green.
6. Update `SKILL.md` + `README.md` inline; delegate any `docs/`-tree row (file-index) to a subagent (the docs-write rule).
7. When ready to land, say **"use ship-change skill"** — it runs the full-suite gate, archives + syncs specs, commits, opens the PR, watches CI, checks CodeRabbit, squash-merges, and cleans up the worktree.
8. Expect the gate to catch **architecture-lint** violations (no direct `child_process` / `process.platform`) — for a *standalone published* package, fix by removing the subprocess entirely, not by importing the internal `shared` helper.

## 3. How the collaboration unfolded

**Phase A — Discovery & grounding (Opus, ~2 min).** The AI loaded the apply skill,
ran `openspec status`/`instructions`, read all context files, and mapped the existing
`packages/mockup-loop/` tree. Crucially it then **checked dependency availability**
(`@axe-core/playwright` etc.) *before* designing — found none installed — and used
that to decide on dynamic-import optional tools so `tsc` and smoke tests never
hard-require them. *Why it worked:* grounding the architecture in the real dep state
avoided a build that only passes on a fully-provisioned machine.

**Phase B — Generate in task order (~10 min).** It created 17 files walking the
tasks.md numbering: preset registry + DTCG contract loader, five design-system data
folders (tokens + rubric, plus Apple HIG's rule-pack `rules.md`), the 4-layer
`validators.ts`, then extended `extension.ts` from 3 tools to 5. *Decision point:*
gates (token-lint L1, a11y L2) are hard; auditor L3 + rubric L4 are advisory, so
`validateMockup` returns `{ gates, advisory, pass }` with `pass` gate-only.

**Phase C — Verify locally (~4 min).** `npx tsc --noEmit` clean → wrote vitest config
+ two test files → registered the package in the root vitest config → 23 tests green.
Fixed a `child_process` deprecation warning in `isToolAvailable`, ran `npm install`
for the new deps, marked all 25 tasks `[x]`.

**Phase D — Human steering interlude.** The operator paused implementation to ask a
side question ("Is it possible to make an npm package in monorepo?"). The AI answered
using *this very repo* as the worked example (npm workspaces, `packages/*`, per-package
`publishConfig`, `npm publish -ws`). Then: **"use ship-change skill."**

**Phase E — Ship (~19 min).** The ship gate ran the full suite and surfaced 3
failures. The AI triaged: 2 were its own (architecture-lint), 1 was a flaky
doctor-route timing test (confirmed by re-running in isolation). It fixed the lint
violations, archived the change, synced the spec, committed, pushed, opened PR #162,
watched CI to green, found CodeRabbit couldn't review (org prepaid credits exhausted —
a hard billing block, treated as advisory/non-blocking), **asked for confirmation
before the irreversible merge**, then squash-merged (`b03e845e`) and cleaned up.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change add-selectable-design-systems`.
  Effective because all the design judgment already lived in the OpenSpec change's
  25 tasks; the operator delegated *implementation*, not *design*. Naming the change
  explicitly removed any ambiguity about which change to apply.
- **High-leverage follow-up** — `use ship-change skill`. Four words that triggered the
  entire land sequence (gate → archive → PR → CI → review → merge → cleanup). This is
  the pattern: let a skill own the multi-step ceremony instead of hand-driving `gh`.
- **The side question** — `Is it possible to make an npm package in monorepo?` — a
  good "teach me the mechanism I'm about to rely on" prompt; the AI grounded the answer
  in the current repo rather than generic docs.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Reach for the internal `shared/platform/exec.js` helper to satisfy the no-`child_process` lint | (self-corrected) recognizing `mockup-loop` is a **standalone published** package that must not depend on dashboard internals | State up front: "standalone published packages fix lint by removing the subprocess, not by importing `shared`." |
| Stop at "CI green + 0 CodeRabbit comments" as a clean pass | The AI itself flagged CodeRabbit **could not review** (credits exhausted) and **paused for confirmation** before the irreversible merge | Keep the guardrail: never treat a *missing* review as a *passing* review; confirm before irreversible steps. |
| Drive the multi-step land sequence manually | "use ship-change skill" | Reach for the skill by name the moment implementation is done. |

Notable good instinct: the AI **verified the flaky failure in isolation** rather than
assuming, and **distinguished its own failures from pre-existing flake** before
touching anything.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — it was a straight application of
existing ones. The reusable assets are the **skills that were invoked**:

- **`openspec-apply-change`** — turns a planned change's tasks.md into ordered
  implementation. Effective because it forces read-all-context-then-build and keeps
  task numbering as the build order.
- **`ship-change`** — the land ceremony. Removes ~15 manual `gh`/`openspec`/`git`
  steps and enforces the gate + irreversibility-confirmation discipline. Invoke it the
  moment code is done and tests are local-green.
- **Subagent (`general-purpose`)** — spawned once to add file-index rows for the new
  preset files, honoring the "delegate `docs/` writes" rule.

**Recommended memory to save:** *"Standalone published `packages/*` (e.g. mockup-loop)
must not import the dashboard-internal `shared` package; fix no-`child_process` lint by
removing the subprocess (PATH scan via `path.delimiter`), not by importing a helper."*
This exact confusion cost a triage cycle in the gate.

## 7. Pitfalls & dead ends

- **Architecture-lint on a standalone package.** `validators.ts` used
  `node:child_process` + a `process.platform` branch → the repo's
  `no-direct-child-process` / `no-direct-platform` tests failed. Fix: rewrite
  `isToolAvailable` as a pure `PATH` scan using `path.delimiter` — no subprocess, no
  platform branch, and safer. Do **not** reach for `shared/platform/exec.js` in a
  published package.
- **Flaky doctor-route timing test** (3869ms vs 3000ms budget) failed under parallel
  load. If a timing test fails in the full suite, re-run it *in isolation* before
  assuming your change broke it.
- **Vitest needs an ephemeral HOME** for the shared lint-test project: run with
  `HOME=$(mktemp -d) npx vitest run …` or it can pick up stray config.
- **Worktree-collision on merge.** `gh pr merge --squash --delete-branch` tried to
  update local `develop`, which is checked out in the parent repo → failed *after* the
  remote merge landed. Recover by: verify the merge on the remote, delete the remote
  branch explicitly, then prune the worktree **from the parent repo** (the shell CWD
  was the now-removed worktree, so several `git -C … worktree prune` attempts errored
  until run with an explicit valid cwd).
- **Squash-merge "not fully merged" branch warning** is expected — the squash tip isn't
  an ancestor; `git branch -D` (force) is safe once the remote shows merged.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a planned OpenSpec change with a complete tasks.md; the
target package (`packages/mockup-loop/`); `gh` authenticated; the `develop` base branch.

- [ ] `/skill:openspec-apply-change <change-name>` — read context + all tasks first.
- [ ] Check optional-dep availability before designing; use dynamic-import fallback for anything not bundled.
- [ ] Build in task order; keep gates hard / auditor+rubric advisory; return `{ gates, advisory, pass }`.
- [ ] For any shell-out in a **standalone published** package: prefer a subprocess-free approach (PATH scan) to satisfy architecture-lint.
- [ ] `npx tsc --noEmit` → register the package in the **root** vitest config → `npx vitest run` until green.
- [ ] Update `SKILL.md` + `README.md`; delegate `docs/` file-index rows to a subagent.
- [ ] `use ship-change skill` — full-suite gate, triage own-vs-flaky failures, archive + sync spec, PR to `develop`, watch CI, check CodeRabbit, **confirm before irreversible merge**, squash-merge, clean worktree from the parent repo.

**Artifacts produced:** 17 new files under `packages/mockup-loop/` (`src/presets/{registry,contract,validators}.ts`, five `presets-data/*/`, `vitest.config.ts`, two `__tests__/*.ts`); edits to `extension.ts`, `package.json`, `SKILL.md`, `README.md`, root `vitest.config.ts`; PR #162 squash-merged as `b03e845e`; change archived to `openspec/changes/archive/2026-06-24-add-selectable-design-systems/`, spec synced to `openspec/specs/mockup-loop-design-systems/spec.md`.

---

_Generated from session `019ef6d6` · `pi-agent-dashboard` · 2026-06-24. Source extract: deterministic facts sheet (session-to-guideline)._
