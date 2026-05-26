## Why

`add-worktree-spawn-dialog` shipped worktree creation but explicitly deferred removal, merge, PR creation, and the cwd-loss handling those operations require. Users now have a one-click way to *make* worktrees but no way to *finish* them — they must drop to a terminal to merge, push, open a PR, and run `git worktree remove`. Worse, removing a worktree from outside the dashboard silently breaks any pi session still running inside it: the session's `cwd` vanishes, the bridge dies, and the card sits in the dashboard with stale `gitWorktree` / `gitBranch` data forever. There is no visual cue, no recovery action, and `resume` fails with a cryptic `cwd_invalid`.

This change closes the loop: ship the four lifecycle actions a worktree session typically needs (push, open PR, merge into base, remove), gate them behind safety pre-flights, and add first-class detection + UI for sessions whose cwd disappeared (whether the dashboard removed the worktree or the user did it externally).

## What Changes

### Worktree lifecycle actions (new capability)

- **Server**: Four new REST endpoints under `/api/git/worktree/*` (loopback-gated, same pattern as existing `add-worktree-spawn-dialog` endpoints):
  - `POST /api/git/worktree/remove` — `{ cwd, force? }` → runs `git worktree remove <path>` from the parent repo; refuses when dirty unless `force`; pre-flight returns `active_sessions: SessionId[]` so the client can show a kill-confirm dialog before destructive removal.
  - `POST /api/git/worktree/merge` — `{ cwd, deleteBranch? }` → `git checkout <base>` in `mainPath` then `git merge --no-ff <branch>`; refuses when main checkout is dirty; returns the merge commit SHA and (optionally) deletes the merged branch.
  - `POST /api/git/worktree/push` — `{ cwd, setUpstream? }` → `git push -u origin <branch>` from the worktree; surfaces `gh auth status` failure modes verbatim.
  - `POST /api/git/worktree/pr` — `{ cwd, title?, body? }` → `gh pr create --base <base> --head <branch> [--title --body]`; auto-pushes when remote-tracking branch is missing; returns the new PR URL. Requires `gh` resolvable via the tool registry.
- **Client**: New `WorktreeActionsMenu` rendered in the WORKSPACE subcard for sessions with `gitWorktree`. Buttons: `Push`, `Open PR` / `View PR` (toggles based on `gitPrNumber`), `Merge into <base>`, `Close worktree`. Each opens a small confirm dialog inline. The `Open PR` button is gh-gated — hidden when `gh` is not resolvable via the tool registry; the `View PR` link still renders when a PR already exists (`gitPrNumber` set), since opening an existing URL does not require gh.
- **Client**: `MergeConfirmDialog` shows a 5-line `git diff --stat` between branch and base before letting the user submit.
- **Client**: `CloseWorktreeDialog` lists every active session in that cwd, offers `[Abort all then remove]` as a single button; offers a `Delete merged branch` checkbox when the branch is fully merged into base; offers a `--force` toggle when removal would fail otherwise.

### Cwd-loss detection + handling

- **Server**: New `cwdMissing: boolean` field on `DashboardSession` (broadcast on `session_updated`). Stamped by:
  1. Bridge: when the periodic 30 s git tick catches `existsSync(cwd) === false`, emits `cwd_missing` extension→server message.
  2. Server: when an ended session is reattached / re-listed, the scanner re-probes `existsSync` and stamps the field. Cheap (one stat per ended session, only when the session enters the listing).
  3. Lifecycle endpoints: `worktree/remove` stamps `cwdMissing: true` on every session inside the removed path *before* the remove actually runs (optimistic — corrected by the next scan if remove fails).
- **Server**: `spawn-preflight.ts` already rejects on missing cwd with `cwd_invalid`; we add a stable error code mapped to `cwd_missing` for clearer UX. (No new logic — just a rename in the error envelope.)
- **Client**: When `session.cwdMissing` is `true`, the card SHALL render a small red `cwd gone` pill (similar styling to the worktree pill, red tone) and the resume button SHALL be disabled with a tooltip "session's directory no longer exists".
- **Client**: New `FolderActionBar` button `Clean up broken (N)` appears when the folder has ≥ 1 ended session with `cwdMissing: true`. Click → bulk-hide those sessions (existing `hidden` mechanism — no new persistence shape).

### Pre-removal session guard

When `worktree/remove` is invoked and the registry shows ≥ 1 active session whose `cwd` is inside the target path, the server SHALL refuse with `error: "active_sessions"` and a list of session IDs. The client SHALL present a confirm dialog ("This will end N pi sessions — continue?"); on confirm, the client sends `shutdown` to each session then re-invokes `worktree/remove`. The server SHALL NOT auto-kill sessions on its own — destructive action stays explicit.

### Out of scope

- **Squash / rebase merge variants** — `--no-ff` only in v1. Add as a dropdown in v2 if asked.
- **Conflict resolution UI** — merge that hits conflicts surfaces stderr verbatim; user resolves in their editor.
- **PR templates** — title/body inputs are free-text; we don't parse `.github/PULL_REQUEST_TEMPLATE.md`.
- **Force-pushing branches** — push without `--force-with-lease` only; users with non-trivial push needs use the terminal.
- **Worktree rename / relocate** — out of scope; rare and `git worktree move` is finicky.
- **Hooks for `worktree remove`** — we don't run user `pre-remove` hooks; git's `worktree-remove-hook` (if present) fires naturally.

## Capabilities

### New Capabilities

- **`worktree-lifecycle`** — Push, PR, merge, and remove operations for worktree sessions, plus the pre-removal session guard. Lives alongside the existing `git-operations-api` capability rather than under it because it composes git + gh + session-manager and has its own UI surface.

### Modified Capabilities

- **`git-operations-api`** — Adds four endpoints under `/api/git/worktree/*`. Existing `POST /api/git/worktree` (create) is unchanged.
- **`git-context`** — Adds `cwdMissing?: boolean` to `DashboardSession`. Bridge probes existence on its 30 s git tick.
- **`session-card-subcards`** — WORKSPACE subcard renders `WorktreeActionsMenu` for sessions with `gitWorktree`. Adds the `cwd gone` pill when `cwdMissing` is true.
- **`folder-action-bar`** — Adds `Clean up broken (N)` button when applicable.

## Impact

- **New files**:
  - `packages/server/src/git-worktree-lifecycle.ts` — pure orchestration helpers (remove, merge, push, pr) plus stderr→code mapper
  - `packages/server/src/active-sessions-in-cwd.ts` — pure helper: given session list + path, returns IDs whose `cwd` is inside `path`
  - `packages/client/src/components/WorktreeActionsMenu.tsx`
  - `packages/client/src/components/CloseWorktreeDialog.tsx`
  - `packages/client/src/components/MergeConfirmDialog.tsx`
  - Tests for each
- **Modified files**:
  - `packages/server/src/git-operations.ts` — adds `removeWorktree`, `mergeWorktree`, `pushBranch`, `createPullRequest` (thin wrappers calling lifecycle helpers)
  - `packages/server/src/routes/git-routes.ts` — registers 4 new routes
  - `packages/shared/src/types.ts` — adds `cwdMissing?: boolean` on `DashboardSession`
  - `packages/shared/src/protocol.ts` — adds `cwd_missing` extension→server message
  - `packages/extension/src/vcs-info.ts` — periodic `existsSync(cwd)` probe in the git tick
  - `packages/extension/src/bridge.ts` — emits `cwd_missing` when probe flips
  - `packages/server/src/event-wiring.ts` — handles `cwd_missing` → `sessionManager.update` → broadcast
  - `packages/server/src/session-scanner.ts` — re-probes `existsSync` for ended sessions during scan
  - `packages/server/src/spawn-preflight.ts` — error code `cwd_invalid` → `cwd_missing`
  - `packages/client/src/components/SessionCard.tsx` — `<CwdGonePill>` next to `<WorktreePill>`; resume button gating
  - `packages/client/src/components/FolderActionBar.tsx` — `Clean up broken (N)` button
- **Protocol**:
  - `DashboardSession.cwdMissing?: boolean` — additive, backward-compatible (older bridges send `undefined` → client treats as not missing).
  - `cwd_missing` extension→server message — additive.
- **Persistence**: None. `cwdMissing` is computed; not persisted (server re-probes on startup scan).
- **Tests**:
  - Unit: 4 lifecycle helpers (happy + every stderr error arm), `active-sessions-in-cwd` (pure), `cwd-missing` probe (mocked fs).
  - Route: 4 endpoint tests covering success + 409 (`active_sessions`, `dirty_main`, `dirty_worktree`, `branch_not_merged`, `gh_not_authed`, `no_remote`) + 400 (`cwd_invalid`) + 200 envelopes.
  - Component: `WorktreeActionsMenu` (button visibility per state), `CloseWorktreeDialog` (active-sessions confirm flow, force toggle, delete-branch checkbox), `MergeConfirmDialog` (diff render, conflict-stderr surfacing), `CwdGonePill` (visible only when flag set).
  - Integration: end-to-end via local WS gateway — bridge stamps `cwdMissing` after we `rm -rf` the cwd, server broadcasts, client receives.

## Migration

None required. Older bridges that don't probe `existsSync` simply never stamp `cwdMissing`, and the client treats undefined as "not missing" — silent degradation. Once the upgraded bridge reattaches, the field starts flowing.
