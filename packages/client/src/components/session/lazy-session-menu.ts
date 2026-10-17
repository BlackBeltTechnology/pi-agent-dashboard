/**
 * Code-split halves of the session actions flyout, off the cold-landing entry
 * chunk (`mdi-chunk-size` gzip cap — "lazy a subsystem instead of raising it"):
 * the menu panel (with `deriveSessionMenu`) and the per-card dialog host. Both
 * render inside `<Suspense fallback={null}>`. Unit tests map this module to the
 * eager components (`test-support/eager-lazy-dialogs.ts`); the real wrappers are
 * covered by `lazy-session-menu.test.tsx`.
 *
 * See change: add-session-actions-flyout.
 */
import { lazy } from "react";

/** Module loaders — exported so the split mapping is testable. */
export const sessionMenuLoaders = {
  SessionActionsPanel: () => import("./SessionActionsPanel.js").then((m) => ({ default: m.SessionActionsPanel })),
  SessionCardDialogs: () => import("./SessionCardDialogs.js").then((m) => ({ default: m.SessionCardDialogs })),
};

export const LazySessionActionsPanel = lazy(sessionMenuLoaders.SessionActionsPanel);
export const LazySessionCardDialogs = lazy(sessionMenuLoaders.SessionCardDialogs);

/** Start loading the panel chunk before the first open (trigger hover / focus). */
export function prefetchSessionActionsPanel(): void {
  void sessionMenuLoaders.SessionActionsPanel();
}
