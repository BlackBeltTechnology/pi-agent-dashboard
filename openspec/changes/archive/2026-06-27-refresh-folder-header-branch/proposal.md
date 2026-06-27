## Why

The sidebar folder-header branch label (`GroupGitInfo` in `SessionCard.tsx`) never refreshes when a folder's git HEAD changes outside the dashboard (e.g. `git checkout develop` in a terminal). Two independent defects compound:

1. **No folder-level refresh path.** When no session is rooted directly at the folder, `GroupGitInfo` fetches `/api/git/branches?cwd=<folder>` exactly once and stores the result in a module-level `branchCache` (`SessionCard.tsx:200`). That cache is invalidated in exactly one place — `BranchSwitchDialog` close (`SessionList.tsx:1221`). An external checkout never invalidates it, so the header shows the branch that was current at first paint, indefinitely.

2. **Child worktree branch leaks into the parent folder header.** A non-pinned worktree session groups under `gitWorktree.mainPath` (the main repo) per `resolveSessionGroupPath` precedence (`pin > mainPath > cwd`). `GroupGitInfo` then picks the first session with a branch (`sessions.find(s => s.gitBranch)`) and renders *that worktree's* branch as the *main repo folder's* branch. Because `session?.gitBranch` always wins, the folder never shows its own HEAD even when the worktree is irrelevant to it.

Net effect: a folder on `develop` displays a stale or borrowed branch name (e.g. `os/inline-agent-screenshot-artifacts`) and there is no code path that ever corrects it short of a full page reload, opening+closing the branch-switch dialog, or spawning a session in that exact folder.

## What Changes

Make a folder's own HEAD a first-class, self-refreshing, server-pushed value — mirroring the existing per-session 30s git poll (bridge) and the per-directory openspec poll (server).

- **Server — poll resolved group keys, not raw session cwds.** Add a folder-HEAD poll over the set of paths the client actually renders as groups: `{ resolveSessionGroupPath(s) : s ∈ sessions } ∪ pinnedDirectories`. The existing server tracked set (`computeKnownDirectories` = pinned ∪ non-ended session cwds) does **not** include `gitWorktree.mainPath`, so the main-repo folder in the worktree case is currently never polled. Polling resolved group keys closes that gap.
- **Server — per-key `readHead()` + diff + broadcast.** On the poll tick, call the existing `readHead(cwd)` (`git-operations.ts`), diff against a cached value, and broadcast `git_head_update { cwd, branch }` only on change.
- **Server — folder-HEAD `fs.watch` for instant updates.** Attach a watcher per folder group key on the directory holding HEAD (resolving the worktree `.git`-file → gitdir indirection), modeled byte-for-byte on `openspec-change-watcher.ts`. A HEAD-file event triggers an immediate, debounced `readHead` + diff + broadcast for that cwd. The watcher is a faster trigger for the same poll path — it does NOT bypass the diff cache; the periodic poll remains the correctness fallback when `fs.watch` is unavailable (ENOENT/EMFILE/EACCES) or silently drops events.
- **Shared — new browser protocol message** `git_head_update { type, cwd, branch }`.
- **Client — folder-git map + precedence flip.** `useMessageHandler` stores `folderGitMap(cwd → branch)`. `GroupGitInfo` reads `folderGitMap[cwd] ?? session?.gitBranch ?? fetchedBranch` so the folder's own HEAD outranks a leaked child-worktree branch. `branchCache` remains a first-paint REST seed; a WS `git_head_update` overwrites it.

The resolved-group-key poll and the client precedence flip are both required together: without the poll the main-repo folder is never reached; without the client precedence flip the leaked worktree branch still wins even after the correct value arrives. The `fs.watch` watcher layers on top for instant (sub-tick) updates while the poll guarantees correctness.

## Capabilities

### New Capabilities
- `folder-head-refresh`: server polls resolved folder group keys for git HEAD (with an `fs.watch` fast-trigger over each folder's HEAD file), diffs, and broadcasts `git_head_update`; client maintains a folder-git map and renders a folder's own HEAD with precedence over child-session branches.

### Touched (code only, no spec delta here)
- `git-context` (capability): the new folder-HEAD poll + `git_head_update` broadcast runs alongside the existing per-session `git_info_update`; behavior captured in the new `folder-head-refresh` capability.
- `sidebar-folder-header` (capability): `GroupGitInfo` branch precedence becomes `folderGitMap[cwd] ?? session?.gitBranch ?? fetchedBranch`; captured in `folder-head-refresh`.

## Impact

- Code (server): new `folder-head-poll.ts` (resolve group keys, `readHead`, diff cache, broadcast); new `folder-head-watcher.ts` (per-folder HEAD `fs.watch`, worktree gitdir resolution, debounced trigger) modeled on `openspec-change-watcher.ts`; wiring on the directory poll tick; `session-bootstrap`/`directory-service` integration.
- Code (shared): add `git_head_update` to the browser protocol message union.
- Code (client): `useMessageHandler` `folderGitMap`; `GroupGitInfo` precedence; keep `branchCache` as seed only.
- Behavior: folder headers update near-instantly after any external checkout (watcher trigger), with a poll fallback that still converges within one tick if the watcher is unavailable; worktree branches no longer leak into the parent folder header.
- No migration. No new config keys. Backward compatible: clients without `git_head_update` handling ignore the message; the REST seed path is unchanged.
- Reuses `readHead` and the existing directory poll cadence — no new external process spawns beyond one `readHead` per tracked folder per tick (plus one on each watcher trigger). The watcher degrades gracefully to poll-only on `fs.watch` failure, exactly like `openspec-change-watcher.ts`.
