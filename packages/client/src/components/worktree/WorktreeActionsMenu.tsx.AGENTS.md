# WorktreeActionsMenu.tsx — index

Exports `WorktreeActionsMenu` + `__resetGhAvailableCache`. Inline action menu for worktree sessions: Push, Open/View PR, Merge (`MergeConfirmDialog`), Close (`CloseWorktreeDialog`). Mobile collapses to `⋯` action sheet via `useMobile` + `usePopoverFlip`. Module-level `ghAvailableCache` probes `fetchTool("gh")`. `labelForCode` maps server error codes. `disabled` prop gates all buttons.

See change: fix-popover-container-clip — mobile action sheet reads `usePopoverBoundary()`, passes `boundaryRef` + `estimatedWidth:140`; `anchorRight ? right-0 : left-0` + inline maxWidth (session-card rail can be slim). Boundary flip proven at component level (F9).
