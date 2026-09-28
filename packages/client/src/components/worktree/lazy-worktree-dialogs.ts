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
};

export const LazyCloseWorktreeDialog = lazy(worktreeDialogLoaders.CloseWorktreeDialog);
export const LazyMergeConfirmDialog = lazy(worktreeDialogLoaders.MergeConfirmDialog);
