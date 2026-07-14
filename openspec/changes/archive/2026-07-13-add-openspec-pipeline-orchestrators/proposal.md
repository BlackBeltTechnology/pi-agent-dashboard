## Why

Landing an OpenSpec change today is a manual relay: draft artifacts, remember to
run `doubt-driven-review`, remember to run `scenario-design`, hand-fold its
catalog into `tasks.md`, `openspec-apply`, hand-run e2e, then `ship-change`. The
building blocks all exist as skills — but nothing chains them, and two steps
(doubt-review, scenario-fold) are routinely skipped because there is no trigger.

The pieces map 1:1 onto existing skills; what is missing is the **wiring** and
two small automations (category-routed test folding, harness-port consumption).
This change adds two project-owned orchestrator skills split at the natural
seam — the git-worktree boundary, which is also the interactive/headless line.

## What Changes

Two new orchestrator skills compose existing skills; they do **not** reimplement
them.

**`plan-proposal`** (runs on `develop`, planning phase, human present, interactive):
1. Ensures planning artifacts exist (`openspec-new-change` / `-ff` / `-continue`).
2. Runs `doubt-driven-review` on `proposal.md` + `design.md` (cross-model offer
   is legitimate here — human is present). Triggered when proposal/design is
   drafted or modified.
3. Runs `scenario-design`, then **auto-folds** each automatable scenario into
   `tasks.md` **routed by test category** (see below). Scenarios that cannot be
   automated are tagged `[manual-only]`.
4. Commits planning artifacts to `develop`; the worktree is spawned from that
   commit (existing worktree flow). `plan-proposal` STOPS at the boundary — the
   human confirms "plan looks good, build it."

**`ship-it`** (runs inside the worktree, implementation phase, can run headless):
1. `openspec status` first → **idempotent** entry point. Whether invoked fresh
   or after a partial `openspec-apply`, it does the minimum to reach "all real
   tasks done."
2. Runs `openspec-apply` if non-manual tasks remain (implements code + authors
   the test files the fold step tasked).
3. Runs the automated tests via the **docker harness** — `docker/test-up.sh`
   from inside the worktree auto-derives a free port pair per worktree
   (`lib-ports.sh`, hash-derived from `HOST_CWD`), recorded in
   `.pi-test-harness.json`. `ship-it` reads the port back, runs Playwright /
   the relevant suite against it, then `test-down.sh`. No hardcoded `:18000`.
4. Delegates to `ship-change` (kept **pure** — it ships, it does not implement).
   `ship-change` defers remaining `[manual-only]` tasks, archives, opens the PR,
   loops CI + CodeRabbit, squash-merges, cleans up the worktree.

**Category-routed folding** (the fold step in `plan-proposal`). Before tasking a
test, scan for an existing test of that type to extend; only flag new infra when
none exists:

| Scenario nature | Category / home | Check-first |
|---|---|---|
| pure logic / boundary | L1 unit → `packages/*/**/__tests__/*.test.ts` | sibling `*.test.ts` |
| process / install / multi-OS | L2 qa VM smoke → `qa/tests/*.sh\|*.ps1` | existing qa test for that OS |
| rendered UI / WS view | L3 e2e → `tests/e2e/*.spec.ts` (docker harness) | existing spec for that surface |
| Electron shell / packaging | `ci-electron.yml` / `_electron-build.yml` | existing electron job |
| CI platform / release wiring | `ci.yml` / workflow-level | existing workflow assertion |
| aesthetics / hardware / "feels right" | **no fold** → `[manual-only]` tag | — deferred by `ship-change` |

## Capabilities

### New Capabilities
- `plan-proposal-orchestrator`: develop-side planning orchestrator — chains
  artifact creation, `doubt-driven-review`, and category-routed `scenario-design`
  folding into `tasks.md`; stops at the worktree boundary.
- `ship-it-orchestrator`: worktree-side implementation orchestrator — idempotent
  `openspec-apply` → docker-harness test run (auto-derived port) → pure
  `ship-change`; runnable headless.

### Modified Capabilities
None at the OpenSpec capability level. `scenario-design` and `ship-change` are
**skills**, not spec-tracked capabilities, so their edits are captured as
requirements of the two new orchestrator capabilities above and as tasks:
- `scenario-design` skill: additive `manual-only` routing outcome + `disposition`
  column emitted into `test-plan.md` (the manifest); existing L1/L2/L3 logic
  unchanged.
- `ship-change` skill: manifest-aware defer (defer only `manual-only` manifest
  rows when a `test-plan.md` exists; keyword defer preserved for legacy changes
  with no manifest).

## Impact

- **New skills**: `.pi/skills/plan-proposal/SKILL.md`,
  `.pi/skills/ship-it/SKILL.md` (project scope).
- **Composed unchanged**: `scenario-design`, `doubt-driven-review`,
  `openspec-apply-change`, `ship-change`, `docker/test-up.sh` + `lib-ports.sh` +
  `test-down.sh` (parallel-worktree ports already solved by
  `fix-parallel-e2e-docker-collisions`).
- **`tasks.md` convention**: `tasks.md` stays **vanilla checkbox format** with no
  custom parser-visible token. The automated-vs-manual boundary is carried by the
  **manifest** (`test-plan.md` `disposition` column), not a `tasks.md` tag;
  `ship-change`'s defer rule reads the manifest (legacy keyword defer preserved
  when no manifest exists). (Earlier drafts used an inline tag — dropped in D2.)
- **No production code paths** touched — this is workflow/skill orchestration.
  No changes to the server, client, extension, or bridge.

## Discipline Skills

- `doubt-driven-review` — invoked BY `plan-proposal` as a pipeline step (and
  applies to this change's own boundary/handoff design decisions).
