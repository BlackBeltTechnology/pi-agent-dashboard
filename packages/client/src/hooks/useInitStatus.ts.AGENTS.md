# useInitStatus.ts — index

`useInitStatus(cwd, opts?: { sessions, isProjectRoot }) → { status: WorktreeInitStatus|null, refetch }`. Single shared `GET /api/git/worktree/init-status` probe per folder row (owned by `FolderInitScope`); feeds the tier-0 `FolderActionBanner` and the folder menu's setup tally from one fetch. Fail-open via `fetchWorktreeInitStatus`.
Re-probe (gated on `isProjectRoot` AND last interpretable probe = "not-a-project"; failed probe never closes the gate): session enters `idle`/`ended`, first seen already idle/ended, or vanishes un-ended — seeded `Map<id,status>`, first snapshot only seeds, effect keyed on sorted `id:status` signature; plus `visibilitychange`→visible throttled 30 000 ms measured from probe issue.
Latest-wins request id + mounted ref (no set-after-unmount). `setupState` lives in `lib/init-setup-state.ts`.
Tests: `__tests__/useInitStatus.test.tsx` (E1–E8, F1–F7, F9, X1, X2). See change: distinguish-initialize-actions, fix-project-setup-completion-state.
