/**
 * Click-only worktree dialogs, code-split off the cold-landing entry chunk
 * (the `mdi-chunk-size` 900 KB gz cap). Render inside
 * `<Suspense fallback={null}>`. See change: redesign-composer-session-strip.
 */
import { lazy } from "react";

/** Module loaders — exported so the split mapping is testable. */
export const worktreeDialogLoaders = {
  CloseWorktreeDialog: () => import("./CloseWorktreeDialog.js").then((m) => ({ default: m.CloseWorktreeDialog })),
  MergeConfirmDialog: () => import("./MergeConfirmDialog.js").then((m) => ({ default: m.MergeConfirmDialog })),
  // Click-only (folder `+ Worktree`, per-change `⑂+`, the session menu's New worktree
  // session): ~14 KB raw off the cold-landing entry. See change: add-session-actions-flyout.
  WorktreeSpawnDialog: () => import("./WorktreeSpawnDialog.js").then((m) => ({ default: m.WorktreeSpawnDialog })),
  BranchSwitchDialog: () => import("./BranchSwitchDialog.js").then((m) => ({ default: m.BranchSwitchDialog })),
  ManageWorktreesDialog: () => import("./ManageWorktreesDialog.js").then((m) => ({ default: m.ManageWorktreesDialog })),
};

export const LazyCloseWorktreeDialog = lazy(worktreeDialogLoaders.CloseWorktreeDialog);
export const LazyMergeConfirmDialog = lazy(worktreeDialogLoaders.MergeConfirmDialog);
export const LazyWorktreeSpawnDialog = lazy(worktreeDialogLoaders.WorktreeSpawnDialog);
export const LazyBranchSwitchDialog = lazy(worktreeDialogLoaders.BranchSwitchDialog);
export const LazyManageWorktreesDialog = lazy(worktreeDialogLoaders.ManageWorktreesDialog);
