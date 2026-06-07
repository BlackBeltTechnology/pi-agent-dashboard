# Tasks

## 1. Dialog callbacks (WorktreeSpawnDialog)
- [x] 1.1 Add optional props `onSpawnStart?(parentCwd: string)` and `onSpawnAbort?(parentCwd: string)` to `WorktreeSpawnDialog`. → verify: types compile; props optional (back-compat).
- [x] 1.2 Fire `onSpawnStart?.(cwd)` at the TOP of the submit handlers (both existing-worktree `Spawn →` row click and create-new submit), before any `createWorktree` / spawn call. → verify: test asserts `onSpawnStart` called with parent `cwd` on submit, before `createWorktree` resolves.
- [x] 1.3 In the create-new path, on `createWorktree` rejection (or non-ok result), call `onSpawnAbort?.(cwd)` and keep the dialog open showing the error. → verify: test simulates `branch_in_use` → `onSpawnAbort(cwd)` fired, dialog stays open, error rendered.

## 2. Pending-spawn placeholderCwd (useSessionActions)
- [x] 2.1 `handleSpawnSession(cwd, attachProposal?, opts?)` accepts `opts.placeholderCwd?: string`. Pending-spawn entry stores `placeholderCwd: opts?.placeholderCwd ?? cwd`. → verify: unit test asserts entry carries parent cwd when provided.
- [x] 2.2 The spawning-set add in `handleSpawnSession` keys on `placeholderCwd ?? cwd`. For worktree spawns the parent cwd was already added by `onSpawnStart`; guard against double-add / double-timeout for the same group cwd. → verify: test asserts no duplicate set entry / single timeout per group cwd across `onSpawnStart` + `handleSpawnSession`.

## 3. Clear keyed on placeholderCwd (useMessageHandler)
- [x] 3.1 `session_added` requestId-tier clear: `clearSpawningCwd(entry.placeholderCwd ?? entry.cwd)`. → verify: test — worktree `session_added` clears the PARENT cwd placeholder.
- [x] 3.2 `session_added` cwd-fallback tier + `spawn_result` failure clear use `placeholderCwd` when the matching pending entry has one. → verify: tests for both arms.

## 4. Wire SessionList dialog mounts
- [x] 4.1 Plain mount (`worktreeDialogCwd`): pass `onSpawnStart={(c) => addSpawningCwd(c)}` / `onSpawnAbort={(c) => clearSpawningCwd(c)}`; `onSpawn={(path, opts) => { setWorktreeDialogCwd(null); onSpawnSession?.(path, opts?.attachProposal, {...opts, placeholderCwd: worktreeDialogCwd}); }}`. → verify: placeholder appears under parent group on submit.
- [x] 4.2 Proposal-aware mount (`worktreeForChange`): same wiring with `placeholderCwd: worktreeForChange.cwd`. → verify: same behavior for the `os/<change>` flow.
- [x] 4.3 Confirm the `SessionCard` `+Worktree` button path routes through these same mounts (no third wiring site). → verify: grep `setWorktreeDialogCwd` / `setWorktreeForChange` call sites.

## 5. Tests
- [x] 5.1 `SessionList.test.tsx`: worktree spawn renders `PlaceholderSessionCard` under the PARENT repo group (not a worktree-path group); parent `+ New Session` disabled during the in-flight window. → verify: green.
- [x] 5.2 `WorktreeSpawnDialog` test: `onSpawnStart` fired at submit before `createWorktree`; `onSpawnAbort` fired on `createWorktree` reject. → verify: green.
- [x] 5.3 `useMessageHandler` / `useSessionActions` tests for `placeholderCwd` clearing on register + failure. → verify: `npm test 2>&1 | tee /tmp/pi-test.log` green.

## 6. Build + restart (client change)
- [x] 6.1 `npm run build` then `curl -X POST http://localhost:8000/api/restart`. → verify: `/api/health` mode unchanged; spawning a worktree shows a placeholder under the parent folder from submit until register; parent `+ New Session` disabled meanwhile.
