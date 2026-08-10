/**
 * Viewer registry — half (a) of the D3 registry split: maps every
 * `OpenPathViewer` (a kind `fileKind()` can return for a real file) to its tab
 * component. Adding a viewer is a registry insertion, not an `if` chain
 * mutation.
 *
 * The four explicitly-opened pseudo-tab kinds (`diff`, `terminal`, `url`,
 * `live-server`) live in `pseudo-tab-registry.tsx`. Keeping `DiffViewer` out of
 * this half is what breaks the cycle `CappedViewer -> viewer-registry ->
 * DiffViewer -> DiffPanel -> DiffFilePreview -> CappedViewer` — do NOT import a
 * pseudo-tab viewer here.
 *
 * See change: cleanup-import-cycles (D3).
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

import { fileKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { type ComponentType, lazy, Suspense } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { AsciiDocPreview } from "../preview/AsciiDocPreview.js";
import { AudioPreview } from "../preview/AudioPreview.js";
import { DocxPreview } from "../preview/DocxPreview.js";
import { EmlPreview } from "../preview/EmlPreview.js";
import { HtmlPreview } from "../preview/HtmlPreview.js";
import { ImagePreview } from "../preview/ImagePreview.js";
import { PptxPreview } from "../preview/PptxPreview.js";
import { SpreadsheetPreview } from "../preview/SpreadsheetPreview.js";
import { VideoPreview } from "../preview/VideoPreview.js";
import BinaryWarn from "./BinaryWarn.js";
import EditableSpreadsheetTab from "./EditableSpreadsheetTab.js";
import MarkdownViewer from "./MarkdownViewer.js";
import MermaidViewer from "./MermaidViewer.js";
import type { ViewerProps } from "./types.js";
import type { OpenPathViewer } from "./viewer-kinds.js";

const MonacoBuffer = lazy(() => import("./MonacoBuffer.js"));
// Lazy like the four preview components that dynamically import PdfPreview — a
// static import here would defeat their lazy boundary (dynamic-import warning).
const PdfPreview = lazy(() => import("../preview/PdfPreview.js"));

/** Adapt the editor-pane `ViewerProps` to a `preview/*` file target. */
const asTarget = ({ cwd, path }: ViewerProps) => ({ kind: "file" as const, cwd, path });

/** Absolute path for `fileKind` (which throws on a relative path). */
const absOf = (cwd: string, rel: string): string => (rel ? `${cwd}/${rel}` : cwd);

const PdfViewer = (p: ViewerProps) => (
  <Suspense
    fallback={
      <div className="p-4 text-sm text-[var(--text-tertiary)]">
        {i18nT("status.loadingPdfViewer", undefined, "Loading PDF viewer…")}
      </div>
    }
  >
    <PdfPreview target={asTarget(p)} />
  </Suspense>
);
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

export const viewerRegistry: Record<OpenPathViewer, ComponentType<ViewerProps>> = {
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
  "binary-warn": BinaryWarn,
};
