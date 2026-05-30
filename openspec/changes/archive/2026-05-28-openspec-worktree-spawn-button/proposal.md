## Why

When a user is working through an OpenSpec change attached to a folder, the natural next action is often "give this change its own branch + working tree so I can iterate without disturbing the main checkout." Today that takes four manual steps: open the folder `+Worktree` dialog → invent a branch name → wait for the worktree to spawn → manually attach the change to the new session.

The folder OpenSpec section already has a one-click `▶ spawn-attached` button per change (creates a fresh session in the folder cwd with the change attached). This proposal adds a sibling `⑂+ spawn-attached-in-worktree` button that wraps the existing `WorktreeSpawnDialog` — inheriting the change name as a branch suggestion and the attachment as a post-spawn intent.

A new global preference `gitWorktreeEnabled` (default `true`) gates BOTH the existing folder `+Worktree` button and the new per-change button. Users who don't use worktrees can hide the surface without affecting the underlying REST endpoints (which remain reachable for tooling).

## What Changes

- **New config field** `gitWorktreeEnabled: boolean` in `packages/shared/src/config.ts` (default `true`). Surfaced in `SettingsPanel.tsx` as a checkbox labelled "Show worktree spawn buttons in folders and OpenSpec rows" (preference-only language — not a capability gate).
- **`FolderActionBar.tsx` visibility gate extended**: `showWorktreeButton = isGitRepo === true && gitWorktreeEnabled && !!onOpenWorktreeDialog`. When disabled, `+Worktree` hides; folder still functions normally.
- **New per-change button** in `FolderOpenSpecSection.tsx`: `⑂+` icon (mdiSourceBranchPlus) rendered next to existing `▶` spawn-attached button, gated `isGitRepo && gitWorktreeEnabled`. Click opens `WorktreeSpawnDialog` scoped to the folder cwd, prefilled with `initialBranch = "os/<change-name>"`.
- **`WorktreeSpawnDialog` accepts two new optional props**:
  - `initialBranch?: string` — prefills the create-form branch input (existing dialog has no prefill).
  - `attachProposal?: string` — when supplied, forwarded through `onSpawn` so the parent's `spawn_session` ws message carries `attachProposal` alongside `gitWorktreeBase`. Server already accepts `attachProposal` on `spawn_session` (via `pendingAttachRegistry`) — no server change.
- **`onSpawn` callback shape extended**: third param becomes `{ gitWorktreeBase?: string; attachProposal?: string }`. Existing call sites pass only `gitWorktreeBase`; new per-change call site passes both.
- **Visibility precedence (single source)**: `gitWorktreeEnabled` gates UI only. REST routes `/api/git/worktree*` remain unguarded by this flag — they're already localhost-gated and capability-bound to git availability.
- **Orphan-path detection in `WorktreeSpawnDialog`**: the dialog SHALL detect when its derived target path already exists on disk but is NOT a registered worktree (`git worktree list --porcelain` does not include it). When detected, the dialog SHALL render an inline warning above the submit button: `This path exists but isn't a registered worktree — likely an orphan from a previous failed attempt.` A `[Clean up]` button next to the warning SHALL invoke `POST /api/git/worktree/orphan-cleanup` (new endpoint, body `{ path }`) which: (1) re-runs `git worktree list --porcelain` to confirm the path is NOT a registered worktree, (2) refuses if the dir contains a `.git` entry of any kind (file OR directory), (3) refuses if the dir contains > N (default 20) files or any file larger than a small threshold, (4) deletes the dir on pass. After successful cleanup the warning collapses and submit re-enables.
- **Backstop in `addWorktree`**: when the route returns `path_exists`, the error envelope SHALL include `orphanLikely: boolean` (true when the path exists but isn't in the worktree list). The dialog uses this signal to show the same warning + clean-up affordance on submit failure (covers the race where the path appears between path-preview-check and submit).

Out of scope:
- Per-folder override of `gitWorktreeEnabled` (global only for v1).
- Disabling the REST endpoints when the flag is off (preference, not capability).
- Auto-derived worktree path UX changes (dialog's existing path preview is reused as-is).
- Branch slug variants (we use the change name verbatim under the `os/` prefix; `slugifyBranch` is already applied downstream by the worktree route).
- Recovering from orphan dirs that contain a `.git` file (looks like a broken worktree link rather than a stray dir — refuse and surface a manual-fix hint instead).

## Capabilities

### Modified Capabilities

- **`folder-action-bar`**: `+Worktree` visibility now AND-gated on `gitWorktreeEnabled` config flag in addition to existing `isGitRepo` + handler-wired checks.
- **`openspec-folder-section`**: Each change row renders a new optional `⑂+` button (between letter-buttons and `▶` spawn-attached). Same visibility gate as folder `+Worktree`.
- **`settings-panel`**: Adds a checkbox bound to `gitWorktreeEnabled`.
- **`git-operations-api`**: Adds `POST /api/git/worktree/orphan-cleanup` endpoint (localhost-only, refuses dirs with `.git`, file-count cap, size cap). Adds `orphanLikely: boolean` field to `path_exists` error envelope from `POST /api/git/worktree`.

### Added Capabilities

- **`server-startup-node-version-guard`** (post-archive addition, see tasks §9): Server SHALL refuse to start when running Node falls outside `package.json#engines.node` (`>=22.19.0 <26`). Single actionable startup-time error replacing the deeper failure (e.g. confusing EBADENGINE during worktree-spawn `npm ci` if engines are below floor). CI standalone-install-smoke matrices include every Node major in the range (today: 22, 24, 25).

## Impact

- **Modified files**:
  - `packages/shared/src/config.ts` — add field + default
  - `packages/client/src/components/SettingsPanel.tsx` — checkbox in the existing git/worktree-adjacent section
  - `packages/client/src/components/FolderActionBar.tsx` — extend `showWorktreeButton`; accept `gitWorktreeEnabled` prop
  - `packages/client/src/components/FolderOpenSpecSection.tsx` — new `⑂+` button + `onSpawnAttachedWorktree?: (cwd, changeName) => void` callback
  - `packages/client/src/components/WorktreeSpawnDialog.tsx` — `initialBranch`, `attachProposal` props; thread `attachProposal` through `onSpawn`
  - `packages/client/src/components/SessionList.tsx` — wire flag from config; route the new per-change handler through to dialog; forward `attachProposal` into `spawn_session` ws call
  - `packages/server/src/git-operations.ts` — new `orphanCleanup(path)` pure-ish helper + tighten `addWorktree` to populate `orphanLikely` on `path_exists`
  - `packages/server/src/routes/git-routes.ts` — register `POST /api/git/worktree/orphan-cleanup`
  - `packages/client/src/lib/git-api.ts` — new `cleanupOrphanWorktreePath(path)` fetch helper
  - `packages/server/src/node-guard.ts` — new `isOutOfEnginesRange` predicate + `buildEnginesRangeMessage`; `assertNodeVersionSupported()` calls both guards (post-archive, see tasks §9)
  - `packages/server/src/__tests__/node-guard.test.ts` — predicate + message tests
  - `packages/shared/src/__tests__/no-managed-dir-reference.test.ts` — allowlist `node-guard.ts` (advisory help-text only)
  - `.github/workflows/ci.yml` — drop Node 25 from both standalone-install-smoke matrices (lockstep with `engines.node` cap)
- **Protocol**: none — `spawn_session.attachProposal` and `spawn_session.gitWorktreeBase` already exist (see `packages/shared/src/browser-protocol.ts:865-887`). One new REST route added (see above).
- **Persistence**: none beyond the new config field.
- **Tests**:
  - `FolderActionBar.test.tsx` — extend visibility-gate suite with `gitWorktreeEnabled=false` arm.
  - New `FolderOpenSpecSection.test.tsx` cases — `⑂+` button visibility + click → handler invocation.
  - `WorktreeSpawnDialog.test.tsx` — `initialBranch` prefills input; `attachProposal` flows through `onSpawn`.
  - Config round-trip test — flag default + persistence.
- **Backward compat**: All additive. Older clients without the flag treat it as `true`; older servers with no awareness of the flag are unaffected (UI-only).
- **Visual**: `⑂+` (mdiSourceBranchPlus, size 0.5) matching the icon idiom used on `FolderActionBar`. Tooltip: `New worktree for this change`.
