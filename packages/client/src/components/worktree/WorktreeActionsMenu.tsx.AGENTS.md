# WorktreeActionsMenu.tsx — index

Exports `WorktreeActionsMenu` + `__resetGhAvailableCache`. Inline action menu for worktree sessions: Push, Open/View PR, Merge (`MergeConfirmDialog`), Close (`CloseWorktreeDialog`). Mobile collapses to `⋯` action sheet via `useMobile` + `usePopoverFlip`. Module-level `ghAvailableCache` probes `fetchTool("gh")`. `labelForCode` maps server error codes. `disabled` prop gates all buttons.

See change: fix-popover-container-clip — mobile action sheet reads `usePopoverBoundary()`, passes `boundaryRef` + `estimatedWidth:140`; `anchorRight ? right-0 : left-0` + inline maxWidth (session-card rail can be slim). Boundary flip proven at component level (F9).

## fix-popover-pane-bounded-height

- `usePopoverFlip` now returns `minHeight` (floor, capped by `maxHeight`) alongside `maxHeight` (bound, never floor-inflated). This file applies BOTH as inline styles — applying only `maxHeight` would silently lose the floor.

PR status segment `worktree-pr-segment` (glyph + word, link iff `gitPrUrl`, `#N` for legacy) replaces "View PR #N". Actions by PR state: none/closed → Push, Open PR (gh), Merge; open/draft → Push, Merge; merged → Push iff ahead. Close last after `worktree-actions-separator`. Props `mergeIsPrimary?` (fills Merge, never while disabled), `appearance?: "chips"|"segments"`. `disabled` → aria-disabled, focusable. See change: redesign-composer-session-strip.
