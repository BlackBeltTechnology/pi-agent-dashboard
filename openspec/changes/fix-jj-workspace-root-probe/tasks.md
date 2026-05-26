# Tasks

## Phase 1 — Recipe + probe fix

- [ ] Add `JJ_REPO_ROOT` recipe to `packages/shared/src/platform/jj.ts` (`jj root --no-pager` → `Recipe<WithCwd, string | undefined>`); export `repoRoot(input)` typed wrapper alongside the existing `workspaceRoot` export.
- [ ] Add `JJ_WORKSPACE_LIST` recipe (`jj workspace list --no-pager`) + `workspaceList(input)` wrapper returning the parsed default-workspace path; used as fallback step 2 in the Decision 2 chain (mirrors `git worktree list --porcelain` parse).
- [ ] Add an argv-shape unit test to `packages/shared/src/platform/__tests__/platform-jj.test.ts` for each new recipe (mirrors the existing `JJ_WORKSPACE_ROOT` shape test).
- [ ] Update the `JjState.workspaceRoot` doc comment in `packages/shared/src/types.ts` to read "absolute path of the **parent repo root** (== cwd for the default workspace)".
- [ ] Verify `pathKey` (in `src/client/lib/session-grouping.ts` and any server-side equivalent) canonicalizes paths (realpath / symlink resolution / trailing-separator normalization). If it does not, decide where to canonicalize per Decision 4: either fix `pathKey` or add normalization at the probe boundary in `gatherJjInfo` before assigning `workspaceRoot`.
- [ ] Add a unit test exercising the symlink case: `pathKey("/tmp/repo")` vs `pathKey("/private/tmp/repo")` on macOS-like layouts must compare equal (mock fs as needed).

## Phase 2 — Probe wiring

- [ ] In `packages/extension/src/vcs-info.ts::gatherJjInfo`, replace the `jj.workspaceRoot()` call with `jj.repoRoot()`; on hard error, fall back to `jj.workspaceRoot()` and record the failure in `lastError`.
- [ ] Keep all other behaviour unchanged (fast-path gating, `isColocated`, `workspaceName` resolution).
- [ ] Unit test: with `jj.repoRoot` mocked to return `/repo`, verify the probe populates `workspaceRoot = "/repo"` regardless of cwd shape.
- [ ] Unit test: with `jj.repoRoot` failing AND `jj.workspaceRoot` succeeding with `/repo/.shadow/np-tp/`, verify the probe still populates `workspaceRoot` (fallback) and sets `lastError`.

## Phase 3 — Live integration test

- [ ] Add `packages/extension/src/__tests__/vcs-info-jj-probe.test.ts` that:
  - [ ] Skips when the tool registry cannot resolve `jj` (mirror Phase 1 Task 5 of the parent change).
  - [ ] Creates a tmp dir, runs `git init` + `jj git init --colocate`.
  - [ ] Asserts `gatherJjInfo(tmpDir).workspaceRoot === tmpDir`.
  - [ ] Runs `jj workspace add ./.shadow/probe-test`.
  - [ ] Asserts `gatherJjInfo(tmpDir + "/.shadow/probe-test").workspaceRoot === tmpDir` (parent repo root, NOT the workspace cwd).
  - [ ] **Symlink case** (skip on Windows): symlink `tmpDir` to a sibling path, `cd` into the symlinked workspace, call `gatherJjInfo`, and assert `pathKey(workspaceRoot) === pathKey(symlinkedTmpDir)` so the group-key collapse still fires through a symlinked `/tmp`-style mount (the macOS `/tmp` → `/private/tmp` failure mode git worktree learned to handle).
  - [ ] Cleans up the tmp dir on teardown.

## Phase 4 — Docs

- [ ] Update the `JjState` row / `vcs-info.ts` row in `AGENTS.md` (if present) to note the probe now returns the parent repo root.
- [ ] Add a single line to `docs/architecture.md` "Jujutsu workspaces" subsection clarifying that `workspaceRoot` carries the parent repo root, so the sidebar collapses workspace cards under their parent.

## Phase 5 — Verification

- [ ] Manual smoke test: spawn a session inside a `.shadow/<name>/` workspace; confirm the session card appears under its parent repo's folder group in the sidebar instead of as a separate top-level folder card.
- [ ] Confirm no regression for plain-git sessions (`jjState` remains `undefined`) and for default-workspace sessions (group key unchanged).
