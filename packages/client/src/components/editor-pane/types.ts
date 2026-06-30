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
}
