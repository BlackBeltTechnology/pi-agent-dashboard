# WorktreeActionsMenu.tsx — index

Exports `WorktreeActionsMenu` + `__resetGhAvailableCache`. Inline action menu for worktree sessions: Push, Open/View PR, Merge (`MergeConfirmDialog`), Close (`CloseWorktreeDialog`). Mobile collapses to `⋯` action sheet via `useMobile` + `usePopoverFlip`. Module-level `ghAvailableCache` probes `fetchTool("gh")`. `labelForCode` maps server error codes. `disabled` prop gates all buttons.
