## Why

Git-worktree workflows are common when working on several branches in parallel, and the dashboard already handles a near-isomorphic concept (jj `.shadow/` workspaces) — but currently has zero affordance for git worktrees: no way to create one from the UI, no detection in the bridge, no awareness in session grouping. Users who create worktrees manually end up with orphaned session cards floating in their own unpinned group, divorced from the parent repo they belong to.

Two prior proposals (`worktree-awareness`, `workspace-actions`) tackled fragments of this surface but were never implemented, used a sibling-directory layout that pollutes the user's project parent dir, and missed the grouping problem entirely. This change supersedes both with a single coherent surface: detect worktrees, group their sessions under the parent repo, and give users a one-click button that lists existing worktrees and creates new ones under `.worktrees/<slug>/`.

## What Changes

- **Bridge worktree detection**: `git-info.ts` SHALL detect `isWorktree`, `mainWorktreePath`, and `worktreeName` via `git rev-parse --git-common-dir` vs `--show-toplevel`. Surfaced on `DashboardSession.gitWorktree?`.
- **Session grouping fix**: `resolveSessionGroupPath` SHALL group worktree sessions under their `mainWorktreePath` (priority: pin > `jjState.workspaceRoot` > `gitWorktree.mainWorktreePath` > `cwd`). `clusterByWorkspaceName` SHALL key on worktree name so worktree sessions cluster adjacent within the parent's group.
- **WORKSPACE-subcard worktree pill**: When `session.gitWorktree` is set, the session card's WORKSPACE subcard SHALL render a `worktree` pill next to the existing `⎇ <branch>` line. The `⎇ branch` display itself is unchanged (branches remain primary identity; pill is supplementary). Base branch SHALL be shown in tooltip.
- **Three new REST endpoints** (localhost-only, like existing git endpoints):
  - `GET /api/git/head?cwd=<path>` — current branch, detached state
  - `GET /api/git/worktrees?cwd=<path>` — `git worktree list --porcelain` parsed
  - `POST /api/git/worktree` — `{ cwd, base, newBranch, path?, force? }`; runs `git worktree add -b <newBranch> <path> <base>`
- **`+Worktree Session` button** in `FolderActionBar`, opening a unified fullscreen dialog that:
  1. Lists existing worktrees of the repo (including main checkout) as one-click `[Spawn →]` rows
  2. Below the list, offers a "create new worktree" form (base picker, new-branch input, derived path)
  3. On either path, auto-spawns a pi session in the chosen/created worktree cwd
  4. Persists `base` ref in `.meta.json` so the worktree pill's tooltip can show "base: develop"
- **`.worktrees/<slug>/` layout** chosen over sibling-directory layout. Slug derived from the new branch name; user-editable. `.worktrees/` SHALL be appended idempotently to `.git/info/exclude` on first creation (local-only ignore, never `.gitignore`).
- **Base-branch fallback chain**: current branch → `develop` → `main` → `master` → fail with helpful message.
- **Remote branches** allowed as base refs (existing `BranchPicker` already supports them).
- **Supersedes `worktree-awareness`** (different card-display decision: pill+branch instead of replacing branch with worktree folder) **and `workspace-actions`** (different layout, adds grouping fix + unified dialog + auto-spawn). Both SHALL be archived as superseded by this change.

Out of scope (explicit non-goals for v1):
- Worktree removal / cleanup UI
- Submodule init in new worktrees
- LFS-specific handling
- Bare-repo + worktree layout (alternate layout deferred to later config option)
- Visible sub-headers between session clusters in a folder (current jj silent-cluster pattern is matched; cross-cutting visual change is a separate proposal)

## Capabilities

### New Capabilities

_(none — every surface is an extension of an existing capability)_

### Modified Capabilities

- `git-context`: Worktree detection fields added to gathered git info and propagated through the session protocol.
- `git-operations-api`: Three new endpoints (`/api/git/head`, `/api/git/worktrees`, `/api/git/worktree`).
- `session-grouping`: `resolveSessionGroupPath` precedence extended with `gitWorktree.mainWorktreePath` step; `clusterByWorkspaceName` extended to key on worktree name.
- `folder-action-bar`: Adds `+Worktree Session` button (localhost-only, hidden when folder is not a git repo).
- `session-card-subcards`: WORKSPACE subcard adds worktree pill when `session.gitWorktree` is set.

## Impact

- **New files**:
  - `packages/server/src/git-worktree.ts` (pure helpers: slug, base fallback, porcelain parser)
  - `packages/client/src/components/WorktreeSpawnDialog.tsx`
  - Tests for each
- **Modified files**:
  - `packages/extension/src/git-info.ts` (+ worktree detection)
  - `packages/server/src/git-operations.ts` (+ worktreeAdd, readHead, listWorktrees)
  - `packages/server/src/routes/git-routes.ts` (+ 3 routes)
  - `packages/shared/src/types.ts` (+ `Session.gitWorktree?: { mainPath, name, base? }`)
  - `packages/client/src/components/FolderActionBar.tsx` (+ button)
  - `packages/client/src/components/WorkspaceSubcard.tsx` (+ pill)
  - `packages/client/src/lib/session-grouping.ts` (+ step 3 in precedence, + worktree key in cluster)
  - `packages/client/src/lib/git-api.ts` (+ worktree fetch helpers)
- **Protocol**: `Session.gitWorktree` is a new optional field — backward compatible (older bridges send `undefined`; clients treat as plain checkout).
- **Persistence**: New optional `gitWorktreeBase: string` field in `.meta.json` (written at spawn time, used for pill tooltip).
- **Tests**: grouping unit tests for the new precedence step; backend tests for the porcelain parser, slug helper, base-fallback chain, and the three endpoints; component test for the dialog (existing-list mode + create mode); WORKSPACE-subcard pill render test.
- **Superseded changes** (drop after this change archives):
  - `openspec/changes/worktree-awareness/`
  - `openspec/changes/workspace-actions/`
