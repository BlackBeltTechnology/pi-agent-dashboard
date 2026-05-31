## 1. Dirty-flag the branch input

- [x] 1.1 Add `branchDirty: boolean` state in `WorktreeSpawnDialog`, initialized `false`.
- [x] 1.2 In the branch `<input>` `onChange`, call both `setNewBranch(e.target.value)` and `setBranchDirty(true)`.
- [x] 1.3 Confirm `initialBranch` mount-time seeding via `useState(initialBranch ?? "")` does NOT flip the flag (no `onChange` fires for initial state).

## 2. Reactive `attachProposal` effect

- [x] 2.1 Add `useEffect` keyed on `[attachProposal]`:
  - If `branchDirty` → no-op.
  - Else if `attachProposal && attachProposal.length > 0` → `setNewBranch("os/" + attachProposal)`.
  - Else → `setNewBranch(initialBranch ?? "")`.
- [x] 2.2 Verify path preview (`derivedPath`) updates automatically via the existing `slug`/`derivedPath` `useMemo` chain — no second effect needed.

## 3. Tests in `WorktreeSpawnDialog.test.tsx`

- [x] 3.1 Mount with `attachProposal="add-foo"`, no `initialBranch` → branch input renders `os/add-foo`; path preview shows `<repo>/.worktrees/add-foo`.
- [x] 3.2 Mount with no `attachProposal`, then re-render with `attachProposal="add-foo"` → branch input updates to `os/add-foo`.
- [x] 3.3 Mount with no `attachProposal`, user types `feature/x` into branch, then re-render with `attachProposal="add-foo"` → branch input stays `feature/x` (dirty wins).
- [x] 3.4 Mount with `attachProposal="add-foo"`, user does NOT type, then re-render with `attachProposal=undefined` → branch input clears (or reverts to `initialBranch ?? ""`).
- [x] 3.5 Mount with `attachProposal="add-foo"`, user types `os/other`, then re-render with `attachProposal="add-bar"` → branch input stays `os/other`.
- [x] 3.6 Backward-compat: mount with `initialBranch="os/preset"` and no `attachProposal` → branch input renders `os/preset` (existing `⑂+` flow unchanged).

## 4. Docs

- [x] 4.1 Update the `packages/client/src/components/WorktreeSpawnDialog.tsx` row in `docs/file-index-client.md`: append `Reacts to attachProposal prop changes — sets newBranch=os/<name> unless user typed. See change: auto-fill-branch-from-proposal-in-worktree-dialog.` (caveman style, in-place edit per the Documentation Update Protocol — delegate the docs write to a subagent).

## 5. Verify

- [x] 5.1 `npm test -- WorktreeSpawnDialog` passes.
- [ ] 5.2 Manual: open `+Worktree` from a folder header. (Today no in-dialog picker exists; `attachProposal` stays undefined; dialog behavior identical to before.)
- [ ] 5.3 Manual (regression): per-change `⑂+` button → dialog still opens with `os/<name>` preset, path preview correct.
