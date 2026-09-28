/**
 * Click-only OpenSpec dialogs, code-split off the cold-landing entry chunk
 * (the `mdi-chunk-size` 900 KB gz cap). Every importer (session card,
 * composer strip, mobile action menu, board) renders them inside
 * `<Suspense fallback={null}>`, so none pulls them eagerly.
 * See change: redesign-composer-session-strip.
 */
import { lazy } from "react";

/** Module loaders — exported so the split mapping is testable. */
export const openspecDialogLoaders = {
  AttachChangePicker: () => import("./AttachChangePicker.js").then((m) => ({ default: m.AttachChangePicker })),
  ExploreDialog: () => import("./ExploreDialog.js").then((m) => ({ default: m.ExploreDialog })),
  NewChangeDialog: () => import("./NewChangeDialog.js").then((m) => ({ default: m.NewChangeDialog })),
  ProposeDialog: () => import("./ProposeDialog.js").then((m) => ({ default: m.ProposeDialog })),
  TasksPopover: () => import("../session/TasksPopover.js").then((m) => ({ default: m.TasksPopover })),
};

export const LazyAttachChangePicker = lazy(openspecDialogLoaders.AttachChangePicker);
export const LazyExploreDialog = lazy(openspecDialogLoaders.ExploreDialog);
export const LazyNewChangeDialog = lazy(openspecDialogLoaders.NewChangeDialog);
export const LazyProposeDialog = lazy(openspecDialogLoaders.ProposeDialog);
export const LazyTasksPopover = lazy(openspecDialogLoaders.TasksPopover);
