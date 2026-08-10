# WorktreeInitButton.tsx — index

Hook-run-only Initialize control per directory/worktree row. Accepts shared `status`/`onStatusChange` (row-owned probe) or self-probes standalone. friendlier-worktree-init: store-driven — reads `useInitRun(cwd)`, renders `WorktreeInitChip` (running/done/failed) instead of raw `<pre>`; labels "Review & trust changes" when `needsInit:false && trusted:false` (hook edited); subscribes by cwd. See change: friendlier-worktree-init. → see `WorktreeInitButton.tsx.AGENTS.md`
