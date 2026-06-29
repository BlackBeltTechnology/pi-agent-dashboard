## Context

The folder-header branch is derived client-side by `GroupGitInfo` (`SessionCard.tsx:208`):

```
const session = sessions.find((s) => s.gitBranch);
const branchName = session?.gitBranch ?? fetchedBranch;
```

`fetchedBranch` comes from a one-shot `GET /api/git/branches?cwd=<cwd>` cached in a module-level `branchCache` (`SessionCard.tsx:200`), invalidated only on `BranchSwitchDialog` close (`SessionList.tsx:1221`).

Folder groups are keyed by `resolveSessionGroupPath` (`packages/shared/src/session-group-path.ts`): precedence **pin > `gitWorktree.mainPath` > `cwd`**. So a non-pinned worktree session groups under the main repo root, and its branch leaks into the parent folder header.

The server's existing per-directory work set is `computeKnownDirectories()` (`directory-service.ts:317`) = `pinnedDirectories ∪ { session.cwd : status ≠ "ended" }`. This is keyed by raw session cwds (the worktree paths), **not** the resolved group paths (`mainPath`). The set the client renders and the set the server polls therefore diverge for worktrees.

Server already has `readHead(cwd)` (`git-operations.ts`) returning `{ branch | detached | sha, hasSubmodules }`, and a proven per-directory poll + fs.watch pattern (`directory-service.ts` + `openspec-change-watcher.ts`) that broadcasts `openspec_update { cwd, data }` consumed by `useMessageHandler.ts:417`.

## Goals / Non-Goals

Goals:
- Folder header reflects the folder's own current HEAD, refreshing after external checkouts.
- Worktree branches do not leak into the parent folder header.
- Reuse existing poll cadence, `readHead`, and broadcast/consume plumbing.

Non-Goals:
- Changing per-session `git_info_update` (the session card branch is correct and unchanged).
- Changing grouping precedence (`resolveSessionGroupPath` stays as-is).

## Decisions

### D1 — Poll resolved group keys, not raw session cwds

The folder-HEAD poll set is:

```
pollGroupKeys = unique({ resolveSessionGroupPath(s, pinnedKeys) : s ∈ nonEndedSessions }) ∪ pinnedDirectories
```

Rationale: this is exactly the set of folders the client renders as groups. Using `computeKnownDirectories()` (raw cwds) would poll the worktree (already covered by a live session's `git_info_update`) and miss the main-repo folder the user actually sees. Computing group keys requires the same `resolveSessionGroupPath` + `pathKey` the client uses; both already live in `packages/shared` so the server can import them directly (precedent: order-map keying, `simplify-session-card-ordering`).

Alternative rejected: extend `computeKnownDirectories` to also add `session.gitWorktree?.mainPath`. That works but conflates the openspec poll set (intentionally scoped to active cwds, `scope-openspec-poll-to-active-cwds`) with the folder-head set. Keep them separate: a dedicated `folder-head-poll` set avoids re-broadening the openspec poll.

### D2 — Server diffs and broadcasts `git_head_update` only on change

Per tick, for each `cwd` in `pollGroupKeys`, run `readHead(cwd)`, derive the display branch (`branch`, or short SHA for detached HEAD — same rule as `detectBranch`), compare against a `Map<cwd, branch>` cache. On first-seen or change, `broadcastToAll({ type: "git_head_update", cwd, branch })`. No broadcast when unchanged (dedup parity with openspec poll). Missing/non-git folder → `branch: null`, broadcast once, cache the null.

### D3 — Client precedence: folder HEAD outranks child-session branch

```
branchName = folderGitMap[cwd] ?? session?.gitBranch ?? fetchedBranch
```

`folderGitMap` (cwd → branch|null) is fed by `git_head_update`. When the entry exists (even `null`), it is authoritative for the GROUP header: it is the folder's own HEAD, not a borrowed child branch. `session?.gitBranch` is demoted to a fallback used only before the first `git_head_update` arrives (or when the group key equals a session's own cwd and no separate folder poll has reported yet). `branchCache`/`fetchedBranch` stays as the cold-start REST seed for first paint.

Note: when a folder is itself a single session's own checkout (no worktree, group key == session.cwd), `folderGitMap[cwd]` and `session.gitBranch` agree, so the precedence flip is a no-op for the common case. It only changes behavior for the worktree-parent case, which is the bug.

### D4 — `fs.watch` fast-trigger over each folder's HEAD

For instant (sub-tick) updates, attach an `fs.watch` per folder group key, modeled byte-for-byte on `openspec-change-watcher.ts` (same attach/detach/`detachAll`/`size` surface, same debounce, same graceful-degrade-on-throw contract).

HEAD location resolution (the one new wrinkle vs the openspec watcher, which watches a fixed `openspec/changes` dir):

```
main checkout:  <cwd>/.git/HEAD          → watch dir <cwd>/.git, filter filename === "HEAD"
worktree:       <cwd>/.git is a FILE     → read it: "gitdir: <main>/.git/worktrees/<name>"
                                            → watch dir <that gitdir>, filter "HEAD"
```

Resolution SHALL use git itself where possible to avoid reparsing the `.git` file by hand: `git rev-parse --git-dir` (run in `cwd`) returns the per-worktree gitdir whose `HEAD` is the file to watch. Watch that directory non-recursively and filter `filename === "HEAD"`. Atomic checkouts replace HEAD via rename, so watching the *directory* (not the HEAD file inode) survives the swap.

The watcher is **trigger-only**: on a HEAD event it invokes the same `pollFolderHeads`-for-one-cwd path (read → diff cache → broadcast). It never bypasses the diff cache, never forms a second broadcast path. If `fs.watch` throws (ENOENT for a not-yet-created `.git`, EMFILE, EACCES, EPERM) the folder silently degrades to poll-only — correctness is unaffected, only latency.

Watcher lifecycle mirrors the poll set: attach when a folder enters `pollGroupKeys`, detach when it leaves (and `detachAll` on shutdown). Attach returning `false` (already attached OR `fs.watch` threw) means "retry next cycle", same contract as `OpenSpecChangeWatcher.attach`.

### D5 — Lifecycle and dedup

The poll set is recomputed each tick from current sessions + pinned dirs, so folders drop out naturally when their last non-ended session ends and they are unpinned (matching how the group disappears client-side). No explicit detach needed for poll-only. The cache `Map` entry for a vanished cwd may be pruned opportunistically or left (bounded by folder count). Broadcast is fire-and-forget to all browsers, same as `openspec_update`.

## Risks / Trade-offs

- **Poll latency** (~tick cadence, e.g. 30–60s): only hit when `fs.watch` is unavailable; the watcher (D4) makes the common case near-instant. The bug today is "never refreshes", so even poll-only is a strict improvement.
- **Watcher fd cost**: one `fs.watch` handle per rendered folder (typically < 30). Bounded by folder count and released on detach. Same fd-budget profile as the openspec watcher, which already runs per cwd.
- **Worktree gitdir drift** (`git worktree repair`, `move`): the watched gitdir path can change. Re-resolving via `git rev-parse --git-dir` on each attach (and the poll fallback) covers it; a stale watcher just stops firing and the poll re-converges.
- **Extra `readHead` per folder per tick**: bounded by number of rendered folders (typically < 30); `readHead` is a cheap `git symbolic-ref`/`rev-parse`. Negligible vs existing openspec poll cost.
- **Cross-platform path keying**: must use shared `pathKey`/`inferPlatform` so server group keys match client keys exactly (same risk class already solved for the order map).
- **First-paint flash**: REST seed may briefly show the old cached branch before the first `git_head_update`. Mitigated by keeping the seed but letting WS overwrite; acceptable transient.

## Migration

None. Additive protocol message; older clients ignore it. No persisted-state or config changes.

## Open Questions

- Should the folder-head poll piggyback on the exact `directory-service` tick or run on its own interval? Leaning: reuse the directory poll tick to avoid a second timer, but compute the folder-head set independently from `computeKnownDirectories`.
- Detached-HEAD display in the folder header: short SHA (consistent with `detectBranch`) vs an explicit "detached" affordance. Default to short SHA for parity.
