/**
 * Uniform props contract for every editor-pane viewer. The active tab resolves
 * its component via the viewer registry and renders it with this shape.
 *
 * See change: add-internal-monaco-editor-pane.
 */
import type { FileKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";

export interface ViewerProps {
  /** Absolute session working directory. */
  cwd: string;
  /** File path relative to `cwd`. */
  path: string;
  kind: FileKind;
  mimeType: string;
  size: number;
  /** 1-indexed line to scroll to (Monaco only); optional. */
  line?: number;
  /**
   * When true (canvas auto-open, no user click), document viewers inject a
   * restrictive CSP blocking external subresources so auto-open egress ≤
   * manual-click egress. Currently honoured by `HtmlPreview`. See change:
   * auto-canvas (Section 8 / S34).
   */
  restrictCsp?: boolean;
  /**
   * Live-server tabs: the agent re-declared the target while this tab was not
   * active (reload), or while it WAS active (`updatedByAgent` → offer Reload).
   * See change: improve-canvas-html-and-url-ux (D8).
   */
  reloadNonce?: number;
  updatedByAgent?: boolean;
}
