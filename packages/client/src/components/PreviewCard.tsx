/**
 * Inline chat-message card that previews a file or URL. Header shows
 * an icon, a target label, and a `⤢ expand` button that navigates to
 * the corresponding overlay route. Body dispatches to the per-format
 * renderer chosen by `dispatchPreview`. Inline size policy per design D2.
 * See change: render-file-previews.
 */
import React, { Suspense, lazy } from "react";
import { Icon } from "@mdi/react";
import {
  mdiFileDocumentOutline,
  mdiFilePdfBox,
  mdiImageOutline,
  mdiVideoOutline,
  mdiWeb,
  mdiYoutube,
  mdiLanguageHtml5,
  mdiOpenInNew,
} from "@mdi/js";
import { useLocation } from "wouter";
import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { dispatchPreview, type RendererKind } from "../lib/preview-dispatch.js";
import { encodeFolderPath } from "../lib/folder-encoding.js";
import { MarkdownPreview } from "./preview/MarkdownPreview.js";
import { AsciiDocPreview } from "./preview/AsciiDocPreview.js";
import { HtmlPreview } from "./preview/HtmlPreview.js";
import { VideoPreview } from "./preview/VideoPreview.js";
import { ImagePreview } from "./preview/ImagePreview.js";
import { YouTubePreview } from "./preview/YouTubePreview.js";
import { FallbackPreview } from "./preview/FallbackPreview.js";

// Lazy-load pdfjs only when a PDF preview actually mounts. Keeps pdfjs
// out of the main bundle. See change: render-file-previews (D6).
const PdfPreview = lazy(() => import("./preview/PdfPreview.js"));

interface Props {
  target: ViewTarget;
}

function iconFor(kind: RendererKind): string {
  switch (kind) {
    case "markdown":
    case "asciidoc":
      return mdiFileDocumentOutline;
    case "pdf":
      return mdiFilePdfBox;
    case "image":
      return mdiImageOutline;
    case "video":
      return mdiVideoOutline;
    case "youtube":
      return mdiYoutube;
    case "html":
      return mdiLanguageHtml5;
    default:
      return mdiWeb;
  }
}

function labelFor(target: ViewTarget): string {
  return target.kind === "file" ? target.path : target.url;
}

/** Inline size policy per design D2. Returns the body container className. */
function bodyClassFor(kind: RendererKind): string {
  switch (kind) {
    case "markdown":
    case "asciidoc":
    case "html":
      return "max-h-[60vh] overflow-auto";
    case "pdf":
      return "h-[60vh]";
    case "video":
    case "youtube":
      return ""; // intrinsic 16:9 inside the renderer
    case "image":
      return "max-h-[40vh] max-w-full overflow-hidden flex justify-center";
    default:
      return "";
  }
}

function expandUrlFor(target: ViewTarget): string {
  if (target.kind === "file") {
    return `/folder/${encodeFolderPath(target.cwd)}/view?path=${encodeURIComponent(target.path)}`;
  }
  return `/pi-view?url=${encodeURIComponent(target.url)}`;
}

/** Dispatch the body renderer for a given kind + target. */
export function PreviewBody({
  kind,
  target,
}: {
  kind: RendererKind;
  target: ViewTarget;
}) {
  if (kind === "youtube" && target.kind === "url") return <YouTubePreview target={target} />;
  if (kind === "fallback") return <FallbackPreview target={target} />;
  if (target.kind !== "file") return <FallbackPreview target={target} />;
  switch (kind) {
    case "markdown":
      return <MarkdownPreview target={target} />;
    case "asciidoc":
      return <AsciiDocPreview target={target} />;
    case "html":
      return <HtmlPreview target={target} />;
    case "pdf":
      return (
        <Suspense fallback={<div className="text-[var(--text-muted)] text-sm p-2">Loading PDF viewer…</div>}>
          <PdfPreview target={target} />
        </Suspense>
      );
    case "video":
      return <VideoPreview target={target} />;
    case "image":
      return <ImagePreview target={target} />;
    default:
      return <FallbackPreview target={target} />;
  }
}

export function PreviewCard({ target }: Props) {
  const [, navigate] = useLocation();
  const kind = dispatchPreview(target);
  const label = labelFor(target);
  const expandUrl = expandUrlFor(target);
  return (
    <div
      className="rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] my-2"
      data-testid="preview-card"
      data-kind={kind}
    >
      <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--border-secondary)] text-xs">
        <Icon path={iconFor(kind)} size={0.7} />
        <span className="truncate flex-1 font-mono text-[var(--text-secondary)]">{label}</span>
        <button
          className="p-1 rounded hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          onClick={() => navigate(expandUrl)}
          title="Expand"
          aria-label="Expand preview"
          data-testid="preview-expand"
        >
          <Icon path={mdiOpenInNew} size={0.7} />
        </button>
      </div>
      <div className={bodyClassFor(kind)}>
        <PreviewBody kind={kind} target={target} />
      </div>
    </div>
  );
}
