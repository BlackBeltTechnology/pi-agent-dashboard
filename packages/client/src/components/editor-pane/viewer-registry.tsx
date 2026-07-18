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

import { fileKind, type ViewerKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { type ComponentType, lazy } from "react";
import { AsciiDocPreview } from "../preview/AsciiDocPreview.js";
import { AudioPreview } from "../preview/AudioPreview.js";
import { DocxPreview } from "../preview/DocxPreview.js";
import { EmlPreview } from "../preview/EmlPreview.js";
import { HtmlPreview } from "../preview/HtmlPreview.js";
import { ImagePreview } from "../preview/ImagePreview.js";
import { PdfPreview } from "../preview/PdfPreview.js";
import { PptxPreview } from "../preview/PptxPreview.js";
import { SpreadsheetPreview } from "../preview/SpreadsheetPreview.js";
import { VideoPreview } from "../preview/VideoPreview.js";
import BinaryWarn from "./BinaryWarn.js";
import DiffViewer from "./DiffViewer.js";
import EditableSpreadsheetTab from "./EditableSpreadsheetTab.js";
import LiveServerViewer from "./LiveServerViewer.js";
import MarkdownViewer from "./MarkdownViewer.js";
import MermaidViewer from "./MermaidViewer.js";
import type { ViewerProps } from "./types.js";
import UrlViewer from "./UrlViewer.js";

const MonacoBuffer = lazy(() => import("./MonacoBuffer.js"));

/** Adapt the editor-pane `ViewerProps` to a `preview/*` file target. */
const asTarget = ({ cwd, path }: ViewerProps) => ({ kind: "file" as const, cwd, path });

/** Absolute path for `fileKind` (which throws on a relative path). */
const absOf = (cwd: string, rel: string): string => (rel ? `${cwd}/${rel}` : cwd);

/**
 * `terminal` viewer placeholder. A `term:<id>` tab's real xterm mount lives in
 * the keep-alive `TerminalPaneLayer` (single mount per id — see change:
 * terminals-in-tabbed-panes), so the registry entry renders nothing.
 */
const TerminalPlaceholder = (_p: ViewerProps) => null;

const PdfViewer = (p: ViewerProps) => <PdfPreview target={asTarget(p)} />;
const HtmlViewer = (p: ViewerProps) => <HtmlPreview target={asTarget(p)} restrictCsp={p.restrictCsp} />;
const VideoViewer = (p: ViewerProps) => <VideoPreview target={asTarget(p)} />;
const ImageTab = (p: ViewerProps) => <ImagePreview target={asTarget(p)} variant="full" />;
const AudioViewer = (p: ViewerProps) => <AudioPreview target={asTarget(p)} />;
// Rich office / document / email viewers, each delegating to its shared
// `preview/*` renderer. See change: open-view-command-in-editor-pane (D3).
const DocxViewer = (p: ViewerProps) => <DocxPreview target={asTarget(p)} />;
const PptxViewer = (p: ViewerProps) => <PptxPreview target={asTarget(p)} />;
// An `editable` spreadsheet (`.csv`) gets the Preview/Edit toggle tab; binary
// `.xlsx`/`.xls` render the read-only grid directly. See change:
// open-view-command-in-editor-pane (D4).
const SpreadsheetViewer = (p: ViewerProps) =>
  fileKind(absOf(p.cwd, p.path)).editable ? (
    <EditableSpreadsheetTab {...p} />
  ) : (
    <SpreadsheetPreview target={asTarget(p)} />
  );
const AsciiDocViewer = (p: ViewerProps) => <AsciiDocPreview target={asTarget(p)} />;
const EmlViewer = (p: ViewerProps) => <EmlPreview target={asTarget(p)} />;

export const viewerRegistry: Record<ViewerKind, ComponentType<ViewerProps>> = {
  monaco: MonacoBuffer,
  image: ImageTab,
  pdf: PdfViewer,
  markdown: MarkdownViewer,
  html: HtmlViewer,
  mermaid: MermaidViewer,
  video: VideoViewer,
  audio: AudioViewer,
  docx: DocxViewer,
  pptx: PptxViewer,
  spreadsheet: SpreadsheetViewer,
  asciidoc: AsciiDocViewer,
  email: EmlViewer,
  "live-server": LiveServerViewer,
  // Opened explicitly under a virtual `url:<url>` path (never from `fileKind()`),
  // for `canvas()` url/youtube declares. See change: auto-canvas (S35).
  url: UrlViewer,
  diff: DiffViewer,
  // See TerminalPlaceholder above — real mount is the keep-alive layer.
  terminal: TerminalPlaceholder,
  "binary-warn": BinaryWarn,
};
