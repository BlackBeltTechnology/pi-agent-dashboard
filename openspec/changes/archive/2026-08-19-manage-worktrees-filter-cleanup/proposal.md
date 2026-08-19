## Why

`WorktreeSpawnDialog` §1 ("Existing worktrees of this repo") renders a raw,
uncapped dump of `GET /api/git/worktrees`. On this repo that is 8 rows, of which
5 are machine-generated noise — 4 detached `.worktrees/ab-impl/*` checkouts from
the A/B harness, plus a detached out-of-tree `/private/var/folders/.../tmp.*`
from the docker test harness. The 2 rows a human actually wants (plus the main
worktree) are buried.

Separately, worktree removal has no session-less entry point. The only path to
`POST /api/git/worktree/remove` is `SessionCard → WorktreeActionsMenu →
CloseWorktreeDialog`. A worktree whose session already ended — exactly the
abandoned ones that accumulate — cannot be removed from the UI at all.

The server side is already session-agnostic in its *input*: the `remove` endpoint
takes any `cwd`. `CloseWorktreeDialog` is likewise `cwd`-driven, not
session-driven. The gap is an absent UI entry point, not an absent capability.

But the endpoint touches the session manager **twice**, and the second use is
load-bearing: on success it stamps `cwdMissing: true` on every session under the
removed path and broadcasts `sessionUpdated` (`git-routes.ts:641-648`). Any new
removal path MUST replicate that broadcast or sessions whose directory just
vanished will keep rendering as healthy.

## What Changes

**Shared list component.** Extract §1 of `WorktreeSpawnDialog` into a
`WorktreeList` component with a `mode` of `spawn` | `manage`, reused by both
surfaces.

**Filter (client-side only — no new server data).** Every predicate is derivable
from the existing `WorktreeEntry { path, branch, sha, bare, detached, isMain }`,
because the main worktree's own path is present in the same list:

| Predicate | Derivation |
|---|---|
| `isMain` | field |
| `detached` | field |
| `inTree` | `path.startsWith(main.path + "/.worktrees/")` |
| text match | query substring over `path` + `branch` |

- Free-text query input.
- Toggle chips carrying **live counts** — `Detached (5)`, `Outside .worktrees (1)`.
- Default visible predicate: `isMain || (!detached && inTree)`.

**Cleanup actions.**

- Per-row `✕` opening the existing `CloseWorktreeDialog(cwd)` — inherits the
  `active_sessions` → shutdown → retry and `dirty_worktree` → `--force`
  escalations unchanged.
- Bulk checkbox select → `POST /api/git/worktree/remove-batch` (NEW), returning
  a per-item result with the same stable `RemoveCode` values so the client can
  escalate per row rather than failing the whole batch. Replicates the
  `cwdMissing` stamp + broadcast per successfully removed item, and caps the
  item count.
- `Prune stale` → `POST /api/git/worktree/prune` (NEW), wrapping
  `git worktree prune` for registrations whose directory is gone.
- `deleteBranch?: boolean` added to `remove` (and `remove-batch`), mirroring the
  option `mergeWorktree` already carries; runs `git branch -d` after a
  successful removal. Its outcome is reported in a **separate field with its own
  code space** (`branchDeleteCode`), never as a `RemoveCode` — see the collision
  note below.

**Stale registrations are a distinct row class.** `git worktree list` includes
registrations whose directory is gone, so they render in the list — but
`validateCwd` rejects a nonexistent path with `400 cwd_invalid` *before* git
runs, so `remove` can never clear them. These rows are exactly the junk the
manage surface exists to remove. They are detected client-side (the server
reports directory existence per entry) and routed to `prune`, not `remove`.

**Manage surface.** New `manage-worktrees` item in the `directory` group of
`FOLDER_MENU_GROUPS` (`FolderActionsMenu`, built in `SessionList`), opening the
shared list in `manage` mode.

**Guard.** The `isMain` row renders neither `✕` nor a checkbox. The UI must not
offer it — and note `git worktree remove` on the main worktree currently maps to
`git_failed` → 500, not a clean rejection, so both `remove` and `remove-batch`
reject it explicitly rather than relying on git's error.

### Known collision — `branch_not_merged` is already taken

`branch_not_merged` is an existing `RemoveCode` meaning *the removal itself
failed*; it maps to 409 and `CloseWorktreeDialog` auto-ticks `--force` and
retries on it. Reusing that string to mean "worktree removed, branch deletion
refused" would make the client force-retry a removal that already succeeded.
The branch outcome therefore lives in its own field and code space.

## Impact

- Affected specs: `worktree-spawn-dialog`, `worktree-lifecycle`,
  `git-operations-api`, `folder-actions-menu` (the last MODIFIES the fixed
  host-owned group taxonomy to admit the `manage-worktrees` item).
- Affected code:
  - `packages/client/src/components/worktree/WorktreeList.tsx` (new),
    `WorktreeSpawnDialog.tsx` (§1 extracted), `CloseWorktreeDialog.tsx` (escalation
    logic reused; it gains an optional `deleteBranch` prop — its `attempt()` posts
    `{ cwd, force }` only today — and learns to treat `cwd_invalid` as
    "already gone").
  - `packages/client/src/components/session/SessionList.tsx` (menu item),
    `packages/client/src/lib/git/git-api.ts` (`pruneWorktrees`,
    `removeWorktreeBatch`, `deleteBranch` param).
  - `packages/server/src/routes/git-routes.ts` (2 new routes),
    `packages/server/src/git-worktree/git-operations.ts` (`removeWorktree`
    gains `deleteBranch`; `pruneWorktrees`).

### Known risk — detached is not always noise

This server never creates a detached worktree: checkout mode resolves a local
branch name (passing `origin/foo` verbatim "would yield a DETACHED HEAD, not a
tracking branch" — `git-operations.ts:565-570`) and PR mode always passes `-b`
(`git-operations.ts:1645`). But detached rows arrive from sources the dashboard
does not control — external harnesses, manual `git worktree add`, other tooling
on the same repo — and the filter cannot tell noise from signal by provenance.
Hiding detached by default can therefore hide a row the user is looking for.
Mitigation: the toggle chip always renders a live count, so the list reads
`Detached (5)` — rows are never silently dropped, and one click reveals them.
Any scenario asserting the default filter MUST also assert the count is visible.

## Discipline Skills

- `security-hardening` — `remove-batch` accepts a caller-supplied array of paths
  and `prune` runs a mutating git command; both need the same `validateCwd` +
  `networkGuard` containment the existing single-`remove` route has, applied per
  item, with no path escaping the resolved main worktree.
- `review-code` — `deleteBranch` on remove is destructive and irreversible for
  an unmerged branch; the `-d` vs `-D` decision and its failure code need a
  deliberate review pass, not an incidental one.
- `doubt-driven-review` — hiding rows by default is a silent-data-loss-shaped
  UX decision (see Known risk); stress-test the default predicate before it
  stands.
