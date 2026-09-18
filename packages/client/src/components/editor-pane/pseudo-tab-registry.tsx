/**
 * Pseudo-tab viewer registry — half (b) of the D3 registry split.
 *
 * Maps the four explicitly-opened `PseudoTabViewer` kinds to their components.
 * These are never returned by `fileKind()`; a tab reaches them only via an
 * explicit open under a virtual path (`diff:<rel>`, `term:<id>`, `url:<url>`,
 * `live:<url>`), so they carry no meaningful file size and skip the
 * `CappedViewer` size gate entirely.
 *
 * This half owns the `DiffViewer` import — which is exactly why it must be
 * imported ONLY by `EditorPane` (the pane's composition root, which nothing in
 * the cycle imports). `CappedViewer` importing this file would re-form
 * `CappedViewer -> DiffViewer -> DiffPanel -> DiffFilePreview -> CappedViewer`.
 *
 * See change: cleanup-import-cycles (D3).
 */

import { type ComponentType, lazy } from "react";
import LiveServerViewer from "./LiveServerViewer.js";
import type { ViewerProps } from "./types.js";
import UrlViewer from "./UrlViewer.js";
import type { PseudoTabViewer } from "./viewer-kinds.js";

/**
 * `terminal` viewer placeholder. A `term:<id>` tab's real xterm mount lives in
 * the keep-alive `TerminalPaneLayer` (single mount per id — see change:
 * terminals-in-tabbed-panes), so the registry entry renders nothing.
 */
const TerminalPlaceholder = (_p: ViewerProps) => null;

/**
 * `diff:` pseudo-tab viewer, deferred. A lazy entry here keeps the
 * `DiffViewer` import off the cold graph while preserving the registry split
 * this file exists to enforce (see header) — `EditorPane.tsx` already wraps the
 * pseudo-tab render in a `<Suspense>`, so this entry adds NO new boundary.
 *
 * See change: add-lazy-terminal-diff-bootstrap (D4).
 */
const DiffViewer = lazy(() => import("./DiffViewer.js"));

export const pseudoTabRegistry: Record<PseudoTabViewer, ComponentType<ViewerProps>> = {
  "live-server": LiveServerViewer,
  // Opened explicitly under a virtual `url:<url>` path (never from `fileKind()`),
  // for `canvas()` url/youtube declares. See change: auto-canvas (S35).
  url: UrlViewer,
  diff: DiffViewer,
  // See TerminalPlaceholder above — real mount is the keep-alive layer.
  terminal: TerminalPlaceholder,
};
