/**
 * Viewer registry — maps a `ViewerKind` to its tab component. Adding a viewer
 * is a registry insertion, not an `if` chain mutation. `MonacoBuffer` is the
 * `React.lazy` boundary so the heavy Monaco chunk loads only on first
 * text-file open.
 *
 * See change: add-internal-monaco-editor-pane (design §6).
 */

import type { ViewerKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { type ComponentType, lazy } from "react";
import BinaryWarn from "./BinaryWarn.js";
import ImageViewer from "./ImageViewer.js";
import MarkdownViewer from "./MarkdownViewer.js";
import PdfViewer from "./PdfViewer.js";
import type { ViewerProps } from "./types.js";

const MonacoBuffer = lazy(() => import("./MonacoBuffer.js"));

export const viewerRegistry: Record<ViewerKind, ComponentType<ViewerProps>> = {
  monaco: MonacoBuffer,
  image: ImageViewer,
  pdf: PdfViewer,
  markdown: MarkdownViewer,
  "binary-warn": BinaryWarn,
};
