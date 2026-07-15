## Why

`ship-change` opens the PR (step 5) from wherever the worktree branch sits, with
**no `develop`-integration step first**. When `develop` moved since the worktree
branched, the PR ships a tree the local gates never validated:

- CI runs `HEAD` merged against latest `develop`, but the local verify gate
  (`ship-change` step 2 — vitest + build) only ran `HEAD` in isolation.
- Under `ship-it`, the **strong** gate is the docker e2e harness (`ship-it`
  step 3), which runs **before** `ship-change` is invoked — so it validates the
  **pre-merge** tree. A semantic conflict introduced by integrating `develop`
  that only surfaces in e2e ships unguarded.

The workflow already knows this happens: `ship-change`'s pitfalls list
`mergeStateStatus=DIRTY won't start CI → merge develop` as a **reactive**
recovery. This change makes integration **proactive** — merge before the
strongest gate that runs, so the gate validates the tree that actually ships.

**Not a rebase.** Step 9 is `gh pr merge --squash`; the branch collapses to one
commit regardless, so rebase's linear-history benefit is moot — while its cost
(force-pushing a worktree branch) is a footgun `ship-change` already warns
against. Integration is a **merge of `origin/develop`**.

## What Changes

- **`ship-it` step 2.5 (new, primary integration):** before the harness (step 3),
  `git fetch origin develop` + `git merge --no-edit origin/develop`. The harness
  then validates the integrated tree (`T1`), not the pre-merge tree (`T0`).
- **`ship-change` step 1.5 (new, backstop):** before the verify gate (step 2),
  the same merge. No-op under `ship-it` (already merged); the genuine integration
  point when `ship-change` runs **standalone** (no harness); also catches the
  race where `develop` advanced during the harness run.
- Merge is `origin/develop` (remote ref), never local `develop` (worktree
  branch-collision pitfall). Idempotent: "Already up to date" → no commit.
- Conflict resolution reuses `ship-change`'s documented recipes (`AGENTS.md`
  union-keep, `package-lock.json` → `--theirs` + `npm install --package-lock-only`).
- The CodeRabbit loop (steps 6–8) is **unchanged**: merge once before the PR,
  then re-merge only if CI reports DIRTY (existing pitfall). No per-push merges
  (avoids the "worktree carries develop merges but misses the feature commit"
  misalignment pitfall).

## Capabilities

### Modified Capabilities

- `ship-workflow`: add a `develop`-integration step to both `ship-it` (before the
  harness) and `ship-change` (before the verify gate), placed upstream of the
  strongest gate that runs.

## Impact

- **Skills**: `.pi/skills/ship-it/SKILL.md` (new step 2.5), `.pi/skills/ship-change/SKILL.md` (new step 1.5).
- **Behavior**: PRs open from a develop-integrated, gate-validated tree. Fewer
  red PRs from textual/semantic conflicts and `DIRTY` merge states.
- **No code change**: docs/skill procedure only. No `src/**` touched.

## Discipline Skills

- `doubt-driven-review` — the ordering claim (merge must precede the *strongest*
  gate, which differs between `ship-it` and standalone `ship-change`) is the
  load-bearing decision; stress-test it before the skills are edited.
