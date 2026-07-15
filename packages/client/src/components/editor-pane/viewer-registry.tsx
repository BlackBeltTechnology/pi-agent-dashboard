/**
 * Viewer registry — maps a `ViewerKind` to its tab component. Adding a viewer
 * is a registry insertion, not an `if` chain mutation.
 *
 * The rich viewer kinds delegate to the shared `preview/*` renderers (one
 * renderer per kind, no editor-pane duplicate): pdf → `PdfPreview` (pdfjs
 * canvas, fixes the broken `<object>` path), html → `HtmlPreview` (sandboxed
 * iframe, scripts disabled), video → `VideoPreview`, image → `ImagePreview`
 * (full pan/zoom variant), audio → `AudioPreview`, mermaid → `MermaidViewer`
 * (fetch + `MermaidBlock`). `MonacoBuffer` stays the `React.lazy` boundary so
 * the heavy Monaco chunk loads only on first text-file open.
 *
 * See change: add-internal-monaco-editor-pane (design §6).
 * See change: improve-content-editor (adopt preview/* renderers §4.3).
 */

import type { ViewerKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { type ComponentType, lazy } from "react";
import { AudioPreview } from "../preview/AudioPreview.js";
import { HtmlPreview } from "../preview/HtmlPreview.js";
import { ImagePreview } from "../preview/ImagePreview.js";
import { PdfPreview } from "../preview/PdfPreview.js";
import { VideoPreview } from "../preview/VideoPreview.js";
import BinaryWarn from "./BinaryWarn.js";
import DiffViewer from "./DiffViewer.js";
import LiveServerViewer from "./LiveServerViewer.js";
import MarkdownViewer from "./MarkdownViewer.js";
import MermaidViewer from "./MermaidViewer.js";
import type { ViewerProps } from "./types.js";
import UrlViewer from "./UrlViewer.js";

const MonacoBuffer = lazy(() => import("./MonacoBuffer.js"));

/** Adapt the editor-pane `ViewerProps` to a `preview/*` file target. */
const asTarget = ({ cwd, path }: ViewerProps) => ({ kind: "file" as const, cwd, path });

const PdfViewer = (p: ViewerProps) => <PdfPreview target={asTarget(p)} />;
const HtmlViewer = (p: ViewerProps) => <HtmlPreview target={asTarget(p)} restrictCsp={p.restrictCsp} />;
const VideoViewer = (p: ViewerProps) => <VideoPreview target={asTarget(p)} />;
const ImageTab = (p: ViewerProps) => <ImagePreview target={asTarget(p)} variant="full" />;
const AudioViewer = (p: ViewerProps) => <AudioPreview target={asTarget(p)} />;

export const viewerRegistry: Record<ViewerKind, ComponentType<ViewerProps>> = {
  monaco: MonacoBuffer,
  image: ImageTab,
  pdf: PdfViewer,
  markdown: MarkdownViewer,
  html: HtmlViewer,
  mermaid: MermaidViewer,
  video: VideoViewer,
  audio: AudioViewer,
  "live-server": LiveServerViewer,
  // Opened explicitly under a virtual `url:<url>` path (never from `fileKind()`),
  // for `canvas()` url/youtube declares. See change: auto-canvas (S35).
  url: UrlViewer,
  diff: DiffViewer,
  "binary-warn": BinaryWarn,
};
