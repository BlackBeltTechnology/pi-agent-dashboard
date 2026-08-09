# WorktreeInitButton.tsx — index

Hook-run-only Initialize control per directory/worktree row. Accepts shared `status`/`onStatusChange` (row-owned probe) or self-probes standalone. friendlier-worktree-init: store-driven — reads `useInitRun(cwd)`, renders `WorktreeInitChip` (running/done/failed) instead of raw `<pre>`; labels "Review & trust changes" when `needsInit:false && trusted:false` (hook edited); subscribes by cwd. See change: friendlier-worktree-init. → see `WorktreeInitButton.tsx.AGENTS.md`

See change: add-folder-actions-menu — the button's own gate is extracted as an exported pure fn `shouldShowWorktreeInitButton(status)` (`status.hasHook===true && (trusted===false || needsInit===true)`); the component delegates to it. It does NOT cover the live-run branch — a `useInitRun(cwd)` run short-circuits to `WorktreeInitChip` before the gate is read, so a caller testing for emptiness must check BOTH (`FolderActionBar` does).
