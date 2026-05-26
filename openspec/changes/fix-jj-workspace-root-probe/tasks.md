# Tasks

## Phase 1 — Helper + types + audit

- [x] **Superseded**: original task proposed `JJ_REPO_ROOT` recipe (`jj root` subprocess). Verification during implementation showed `jj root` is documented as "shortcut for `jj workspace root`" and returns the workspace's own cwd, not the parent. Replaced by Decision 1's filesystem read of `<cwd>/.jj/repo`. Implemented as pure helper `deriveJjRepoRoot(cwd)` in `packages/extension/src/vcs-info.ts` — no new recipe in `platform/jj.ts`.
- [x] **Superseded**: no recipe added, so no argv-shape test needed. Unit tests for `deriveJjRepoRoot` live alongside the probe in `packages/extension/src/__tests__/vcs-info-jj.test.ts`.
- [x] Update the `JjState.workspaceRoot` doc comment in `packages/shared/src/types.ts` to read "absolute path of the **parent repo root** (== cwd for the default workspace)".
- [x] Verify `pathKey` (in `src/client/lib/session-grouping.ts` and any server-side equivalent) canonicalizes paths (realpath / symlink resolution / trailing-separator normalization). If it does not, decide where to canonicalize per Decision 4: either fix `pathKey` or add normalization at the probe boundary in `gatherJjInfo` before assigning `workspaceRoot`.
  - **Audit result**: `pathKey` (in `packages/client/src/lib/session-grouping.ts`) calls `normalizePath` which is **syntactic-only** (separator collapse, `.`/`..` resolution, no `realpath`). It does NOT resolve symlinks. Therefore, per Decision 4, the probe canonicalizes via `fs.realpathSync.native` at the boundary before assigning to `workspaceRoot` — see Phase 2.
- [x] Add a unit test exercising the symlink case: `pathKey("/tmp/repo")` vs `pathKey("/private/tmp/repo")` on macOS-like layouts must compare equal (mock fs as needed).
  - **Resolution**: covered at the probe layer instead of `pathKey` — `pathKey` cannot resolve symlinks (it runs in the browser, no fs). The probe-side symlink case is exercised by the live integration test in Phase 3 (Task 10), which symlinks the repo dir and asserts `gatherJjInfo` returns the canonical path.

## Phase 2 — Probe wiring

- [x] In `packages/extension/src/vcs-info.ts`, add pure helper `deriveJjRepoRoot(cwd)` that stat-s `<cwd>/.jj/repo`: if directory → return cwd; if file → read contents, resolve relative path against `<cwd>/.jj/`, return parent of the resolved storage dir; on any error throw a tagged error for the caller to handle.
- [x] In `gatherJjInfo`, replace the `jj.workspaceRoot()` call with `deriveJjRepoRoot(cwd)`; on thrown error, fall back to `jj.workspaceRoot()` and record the failure in `lastError`. Canonicalize the final value via `fs.realpathSync.native` before assigning (Decision 4).
- [x] Keep all other behaviour unchanged (fast-path gating, `isColocated`, `workspaceName` resolution).
- [x] Unit test: `deriveJjRepoRoot` against a tmp dir with `.jj/repo` as a **directory** returns the tmp dir.
- [x] Unit test: `deriveJjRepoRoot` against a tmp dir with `.jj/repo` as a **file** containing `../../../.jj/repo` resolves to the correct parent and returns its repo root.
- [x] Unit test: with `deriveJjRepoRoot` succeeding, verify the probe populates `workspaceRoot` to the canonical (realpath-resolved) parent value.
- [x] Unit test: with `deriveJjRepoRoot` throwing AND `jj.workspaceRoot` succeeding with `/repo/.shadow/np-tp/`, verify the probe still populates `workspaceRoot` (fallback) and sets `lastError`.

## Phase 3 — Live integration test

- [x] Add `packages/extension/src/__tests__/vcs-info-jj-probe.test.ts` that:
  - [x] Skips when the tool registry cannot resolve `jj` (mirror Phase 1 Task 5 of the parent change).
  - [x] Creates a tmp dir, runs `git init` + `jj git init --colocate`.
  - [x] Asserts `gatherJjInfo(tmpDir).workspaceRoot === tmpDir`.
  - [x] Runs `jj workspace add ./.shadow/probe-test`.
  - [x] Asserts `gatherJjInfo(tmpDir + "/.shadow/probe-test").workspaceRoot === tmpDir` (parent repo root, NOT the workspace cwd).
  - [x] **Symlink case** (skip on Windows): symlink `tmpDir` to a sibling path, `cd` into the symlinked workspace, call `gatherJjInfo`, and assert `pathKey(workspaceRoot) === pathKey(symlinkedTmpDir)` so the group-key collapse still fires through a symlinked `/tmp`-style mount (the macOS `/tmp` → `/private/tmp` failure mode git worktree learned to handle).
  - [x] Cleans up the tmp dir on teardown.

## Phase 4 — Docs

- [x] Update the `JjState` row / `vcs-info.ts` row in `AGENTS.md` (if present) to note the probe now returns the parent repo root.
  - **Note**: per project documentation protocol, per-file details go in `docs/file-index-<area>.md` rather than AGENTS.md. The `vcs-info.ts` row in `docs/file-index-extension.md` has been appended with the new derivation behaviour. AGENTS.md was not touched (the backbone entry there is one-line architectural and does not list per-change semantics).
- [x] Add a single line to `docs/architecture.md` "Jujutsu workspaces" subsection clarifying that `workspaceRoot` carries the parent repo root, so the sidebar collapses workspace cards under their parent.

## Phase 5 — Verification

- [ ] Manual smoke test: spawn a session inside a `.shadow/<name>/` workspace; confirm the session card appears under its parent repo's folder group in the sidebar instead of as a separate top-level folder card.
- [ ] Confirm no regression for plain-git sessions (`jjState` remains `undefined`) and for default-workspace sessions (group key unchanged).
