## 1. Shared protocol

- [x] 1.1 Add `git_head_update { type: "git_head_update"; cwd: string; branch: string | null }` to the server→browser message union in `packages/shared/src/types.ts` (or the browser-message module where `openspec_update` is declared).
- [x] 1.2 Confirm `resolveSessionGroupPath` + `pathKey` + `inferPlatform` are exported from `packages/shared/src/session-group-path.ts` for server import (they are; add a test-importing reference if missing).

## 2. Server — folder-head poll

- [x] 2.1 Create `packages/server/src/folder-head-poll.ts` exporting `computeFolderGroupKeys(sessions, pinnedDirectories): string[]` = `unique({ resolveSessionGroupPath(s, pinnedKeys) : s.status !== "ended" }) ∪ pinnedDirectories`, keyed via shared `pathKey`/`inferPlatform`.
- [x] 2.2 Add `pollFolderHeads(deps)` that, for each group key, calls `readHead(cwd)` (`git-operations.ts`), derives the display branch (branch name, or short SHA for detached HEAD via the `detectBranch` rule), diffs against an internal `Map<cwd, branch|null>`, and invokes `broadcast({ type: "git_head_update", cwd, branch })` only on first-seen or change.
- [x] 2.3 Unit test `folder-head-poll.test.ts`: group-key set includes `gitWorktree.mainPath` for a non-pinned worktree session; excludes ended sessions; honors pin-wins; diff suppresses unchanged broadcasts; missing/non-git cwd → `branch: null` broadcast once.

## 3. Server — wiring

- [x] 3.1 Wire `pollFolderHeads` into the existing directory poll tick (reuse the timer in `session-bootstrap.ts` / `directory-service.ts` startPolling path) so it runs each cycle; pass `sessionManager.listAll()` + `preferencesStore.getPinnedDirectories()` + `browserGateway.broadcastToAll`.
- [x] 3.2 Ensure the poll recomputes the group-key set each tick (folders drop out when their last non-ended session ends and they are unpinned).

## 4. Client — folder-git map + precedence

- [x] 4.1 In `useMessageHandler.ts`, handle `git_head_update`: upsert `folderGitMap` (a `Map<string, string | null>` in App state) keyed by `cwd`.
- [x] 4.2 Thread `folderGitMap` (or a per-cwd lookup) into `SessionList` → `GroupGitInfo`.
- [x] 4.3 In `GroupGitInfo` (`SessionCard.tsx`), change branch resolution to `folderGitMap.get(cwd) ?? session?.gitBranch ?? fetchedBranch`. Keep `branchCache`/REST as first-paint seed only; do not remove the seed fetch.
- [x] 4.4 When `folderGitMap.get(cwd) === null` (folder confirmed non-git via poll), render the existing dimmed/"Init git" state, same as `noGitRepo` today.

## 5. Server — folder-HEAD watcher (fast trigger)

- [x] 5.1 Create `packages/server/src/folder-head-watcher.ts` modeled byte-for-byte on `openspec-change-watcher.ts`: same `attach(cwd)` / `detach(cwd)` / `detachAll()` / `size()` surface, debounce, and graceful-degrade-on-throw (`failedOnce` set, return `false` = retry-later).
- [x] 5.2 Resolve the HEAD directory to watch via `git rev-parse --git-dir` (run in `cwd`) — returns the per-worktree gitdir for worktrees and `<cwd>/.git` for main checkouts. Watch that directory non-recursively; filter events to `filename === "HEAD"`.
- [x] 5.3 On a matching debounced event, invoke a single-cwd refresh (read → diff cache → broadcast) — reuse `pollFolderHeads`'s per-cwd path; the watcher MUST NOT bypass the diff cache or form a second broadcast path.
- [x] 5.4 Drive watcher attach/detach from the same place that computes `pollGroupKeys` each cycle: attach folders entering the set, detach folders leaving it, `detachAll()` on shutdown.
- [x] 5.5 Unit test `folder-head-watcher.test.ts`: attach returns true once then false; `fs.watch` throw → attach false + logged once + poll still covers (no throw propagated); a `HEAD` rename event fires the debounced trigger; a non-`HEAD` filename does not; worktree cwd resolves to the gitdir HEAD (mock `git rev-parse --git-dir`).

## 6. Tests (client + integration)

- [x] 6.1 Client test: `git_head_update` overwrites a stale `branchCache` value in `GroupGitInfo` (render with seed `os/foo`, dispatch `git_head_update { branch: "develop" }`, assert header shows `develop`).
- [x] 6.2 Client test: precedence — a group containing a worktree session whose `gitBranch` is `os/foo` plus a `folderGitMap` entry `develop` renders `develop` (folder HEAD outranks child branch).
- [x] 6.3 Client test: with no `folderGitMap` entry, behavior is unchanged (falls back to `session?.gitBranch`, then `fetchedBranch`).
- [x] 6.4 Integration: a HEAD change in a watched folder produces a `git_head_update` broadcast without waiting for the poll tick (watcher path), and a folder with `fs.watch` disabled still converges on the next tick (poll fallback).
