# Tasks — OpenSpec worktree cwd keying

## 1. Client aggregation

- [x] 1.1 In `SessionList.tsx`, compute `memberCwds = distinct([group.cwd, ...group.sessions.map(s => s.cwd)])`
- [x] 1.2 Build aggregated change list: flat-map `openspecMap.get(cwd)?.changes` tagging each with `sourceCwd`; de-dupe by change name (group.cwd wins on collision)
- [x] 1.3 OR-fold `initialized` / `pending` / `hasOpenspecDir` across member cwds to decide whether the folder card renders
- [x] 1.4 Pass aggregated data (not raw `openspecMap.get(group.cwd)`) into `FolderOpenSpecSection`

## 2. Per-change cwd threading

- [x] 2.1 Add `sourceCwd` to the change-row type consumed by `FolderOpenSpecSection`
- [x] 2.2 `TasksPopover` opened from a row uses `cwd={row.sourceCwd}` (read + toggle hit the correct working copy)
- [x] 2.3 Refresh / read-artifact / spawn-attach actions on a row use `row.sourceCwd`

## 3. Worktree-origin marker

- [x] 3.1 Render a small worktree indicator on rows whose `sourceCwd !== group.cwd`

## 4. Tests

- [x] 4.1 Unit-test the aggregation+dedupe helper: main-only, worktree-only, and collision cases
- [x] 4.2 Test that toggling a worktree-origin row targets the worktree cwd (assert `cwd` passed to toggle)

## 5. Verify

- [x] 5.1 `npm test` green
- [ ] 5.2 Manual: spawn a worktree session, edit its `tasks.md`, confirm the folder OpenSpec card reflects the change
- [ ] 5.3 Manual: tick a box on a worktree-origin row, confirm the worktree's `tasks.md` (not main) is written
