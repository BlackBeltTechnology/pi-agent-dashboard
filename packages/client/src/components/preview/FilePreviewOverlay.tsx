import { useEscapeDismiss } from "@blackbelt-technology/pi-dashboard-client-utils/escape-stack";
import { mdiClose, mdiLoading } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { type ComponentType, useEffect, useRef, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { getApiBase } from "../../lib/api/api-context.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { getSyntaxTheme } from "../../lib/theme/syntax-theme.js";
import { DialogPortal } from "../primitives/DialogPortal.js";
import { useThemeContext } from "../settings/ThemeProvider.js";
import { detectLanguage } from "../tool-renderers/lang-detect.js";
import { AsciiDocPreview } from "./AsciiDocPreview.js";
import { DiagramPreview } from "./DiagramPreview.js";
import { DocxPreview } from "./DocxPreview.js";
import { EmlPreview } from "./EmlPreview.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { PptxPreview } from "./PptxPreview.js";
import { dirname } from "./resolve-local-image-src.js";
import { SpreadsheetPreview } from "./SpreadsheetPreview.js";
import { logRejection } from "../../lib/report-error.js";
import { eligibleFetch, PreviewProvenance, usePreviewFetch } from "../../lib/access-grants/preview-provenance.js";
import { classifyResponse, type DenialFailure } from "./denial-fetch.js";
import { DenialNotice } from "./DenialNotice.js";
import { isSameOriginApiBase, useBlobImage } from "./use-blob-image.js";

/** DOM id of the scroll target line inside the highlighted code view. */
const TARGET_LINE_ID = "file-preview-target-line";

const BACKDROP_ID = "file-preview-backdrop";

const absOf = (cwd: string, rel: string): string => (rel ? `${cwd}/${rel}` : cwd);

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);
const MD_EXTS = new Set(["md", "mdx"]);

/**
 * Rich office / document / email kinds routed to their shared `preview/*`
 * renderer instead of the raw `/api/file` `content` fetch. Reclassifying these
 * extensions in `fileKind` stops `/api/file` from returning `content`, so a
 * plain-text overlay would render blank; these branches route each to the
 * renderer that fetches its own bytes. See change:
 * open-view-command-in-editor-pane (D3, blank-overlay regression).
 */
type FileTargetProps = { target: { kind: "file"; cwd: string; path: string } };
const RICH_PREVIEW_BY_EXT: Record<string, ComponentType<FileTargetProps>> = {
  docx: DocxPreview,
  pptx: PptxPreview,
  xlsx: SpreadsheetPreview,
  xls: SpreadsheetPreview,
  csv: SpreadsheetPreview,
  adoc: AsciiDocPreview,
  asciidoc: AsciiDocPreview,
  eml: EmlPreview,
  puml: DiagramPreview,
  plantuml: DiagramPreview,
};

interface Props {
  cwd: string;
  path: string;
  line?: number;
  onClose: () => void;
  /**
   * Who opened the overlay. It opens on an operator click today, so the default
   * is `"operator"`; a future non-click opener passes `"auto"` instead of
   * silently inheriting eligibility (surface-denial-remedy-in-previews, D4).
   */
  provenance?: "operator" | "auto";
}

function getExt(p: string): string {
  const dot = p.lastIndexOf(".");
  return dot >= 0 ? p.slice(dot + 1).toLowerCase() : "";
}

/**
 * Map a raw `/api/file` failure into a human message. Stale links in old
 * sessions are the common case: the file was deleted, or the session's working
 * directory no longer exists (e.g. a removed worktree). Both read as "gone"
 * rather than a generic "Failed to read file".
 */
export function friendlyReadError(
  rawError: string | undefined,
  path: string,
  cwd: string,
): string {
  if (rawError === "not found") {
    return `File no longer exists at ${path} (session working directory: ${cwd}).`;
  }
  if (rawError === "unknown session path") {
    return `Session working directory is no longer available, so ${path} can't be previewed (was: ${cwd}).`;
  }
  return rawError ?? "Failed to read file";
}

/**
 * Read-only file preview overlay used by `FileLink` when the dashboard is
 * remote / no editor is detected. Reuses the existing `cwd`-scoped
 * `/api/file` endpoint (anti-traversal already enforced server-side).
 *
 * Extension routing per spec `tool-output-linkification` — "Click routing":
 *   .md / .mdx → MarkdownContent
 *   image      → inline <img>
 *   otherwise  → line-numbered <pre>, scrolls to `line` if provided.
 *
 * See change: linkify-tool-output.
 */
export function FilePreviewOverlay({ provenance = "operator", ...props }: Props) {
  // The provider must sit ABOVE the component whose hooks read it, so the
  // loading code lives in the inner body (surface-denial-remedy-in-previews, D4).
  return (
    <PreviewProvenance autoOpened={provenance === "auto"}>
      {/* Keyed by target: the host reuses one overlay across targets, and every
          target-scoped state (the ask, errors, content) must start fresh. */}
      <FilePreviewOverlayBody key={`${props.cwd}\u0000${props.path}`} {...props} />
    </PreviewProvenance>
  );
}

function FilePreviewOverlayBody({ cwd, path, line, onClose }: Omit<Props, "provenance">) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A containment denial (text or image) renders `DenialNotice`; other read
  // failures keep their friendly stale-link message.
  const [denial, setDenial] = useState<DenialFailure | null>(null);
  const { fetch: previewFetch, optedOut } = usePreviewFetch();
  const [asked, setAsked] = useState(false);
  const textUrl = `${getApiBase()}/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`;
  const imageUrl = `${getApiBase()}/api/file/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const lineRef = useRef<HTMLDivElement | null>(null);
  const { resolved: theme, themeName } = useThemeContext();
  const syntaxStyle = getSyntaxTheme(theme, themeName);

  const ext = getExt(path);
  const isImage = IMAGE_EXTS.has(ext);
  const isMd = MD_EXTS.has(ext);
  const RichViewer = RICH_PREVIEW_BY_EXT[ext];
  const isRich = RichViewer !== undefined;
  const language = detectLanguage(path);

  // Same-origin API base: the image loads through `fetch` → `blob:` so it can
  // reach the dialog (D1); otherwise the `<img>` below is unchanged.
  const blobImage = useBlobImage(isImage && !isRich && isSameOriginApiBase() ? imageUrl : null);

  useEffect(() => {
    if (isImage || isRich) return; // image / rich renderers fetch their own bytes
    let cancelled = false;
    setDenial(null);
    // Discarded with a stated handler. See change: cleanup-client-plugin-promises.
    void (async () => {
      try {
        const res = await (asked ? eligibleFetch : previewFetch)(textUrl);
        if (res.status === 403) {
          const r = await classifyResponse(res, asked ? false : optedOut);
          if (cancelled) return;
          if (r.kind === "denied") {
            setDenial(r);
            return;
          }
          setError(friendlyReadError(r.kind === "refused" ? r.error : undefined, path, cwd));
          return;
        }
        const json = await res.json();
        if (cancelled) return;
        if (!json.success) {
          setError(friendlyReadError(json.error, path, cwd));
          return;
        }
        if (json.data?.type !== "file") {
          setError("Path is not a file");
          return;
        }
        setContent(json.data.content as string);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Network error");
      }
    })().catch(logRejection("FilePreviewOverlay.loadFile"));
    return () => {
      cancelled = true;
    };
  }, [cwd, path, textUrl, isImage, isRich, asked, previewFetch, optedOut]);

  // Escape dismissal routes through the shared escape-stack so an Escape opened
  // above another dismissible surface peels only this overlay.
  // See change: fix-stacked-escape-closes-layers.
  useEscapeDismiss(true, onClose);

  // Backdrop click dismiss. The backdrop element is the dim layer over the
  // message area only (see render): clicking it closes; clicks inside the panel
  // or down in the composer cutout never match its testid, so they are
  // click-isolated.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.dataset?.testid === BACKDROP_ID) onCloseRef.current();
    };
    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("click", handleClick);
    };
  }, []);

  // The preview is a non-blocking inspector: its dim backdrop must not cover the
  // chat composer, or it intercepts pointer events on the send button (a user
  // could not send a prompt without first dismissing the preview). Reserve a
  // bottom cutout the height of the composer so the composer pokes through and
  // stays interactive while the dim layer still blocks + dismisses over the
  // message area. Falls back to a full-viewport backdrop when no composer is
  // mounted (e.g. preview opened from a dialog). See change:
  // fix-file-preview-backdrop-blocks-composer.
  const [composerInset, setComposerInset] = useState(0);
  useEffect(() => {
    const el = document.querySelector('[data-testid="composer-root"]') as HTMLElement | null;
    if (!el) return;
    const measure = () => setComposerInset(el.getBoundingClientRect().height);
    measure();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // After content loads, scroll to the requested line if any. The flat
  // (no-language) branch uses `lineRef`; the highlighted branch tags the
  // target line with `TARGET_LINE_ID` via `lineProps`.
  useEffect(() => {
    if (!content || !line) return;
    if (language) {
      document.getElementById(TARGET_LINE_ID)?.scrollIntoView({ block: "center" });
    } else if (lineRef.current) {
      lineRef.current.scrollIntoView({ block: "center" });
    }
  }, [content, line, language]);

  return (
    <DialogPortal>
      {/* Outer wrapper spans the viewport but is click-through, so the composer
          cutout at the bottom stays interactive. z-index sits ABOVE the Dialog
          layer (`z-dialog (50)`) so a preview opened from a dialog renders in front of
          it, not behind. See change: fix-stacked-escape-closes-layers. */}
      <div className="fixed inset-0 z-[70] pointer-events-none">
        {/* Dim + dismiss layer: covers the message area only, stopping above the
            composer (bottom = measured composer height). */}
        <div
          data-testid={BACKDROP_ID}
          className="absolute inset-x-0 top-0 bg-black/60 flex items-center justify-center p-4 pointer-events-auto"
          style={{ bottom: composerInset }}
        >
          <div
            className="bg-[var(--bg-primary)] border border-[var(--border-secondary)] rounded shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col pointer-events-auto"
            data-testid="file-preview-overlay"
          >
          <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-secondary)]">
            <span className="text-sm font-mono text-[var(--text-secondary)] truncate flex-1" title={path}>
              {path}
              {line ? `:${line}` : ""}
            </span>
            <button
              onClick={onClose}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 rounded hover:bg-[var(--bg-surface)]"
              title={i18nT("common.close", undefined, "Close")}
            >
              <Icon path={mdiClose} size={0.7} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {error && (
              <div className="text-red-400 text-sm" data-testid="file-preview-error">
                {error}
              </div>
            )}
            {!error && denial && (
              <DenialNotice result={denial} url={textUrl} path={path} onAsk={() => setAsked(true)} asked={asked} />
            )}
            {!error && isImage && !isRich && blobImage.state.status === "failed" && (
              <DenialNotice
                result={blobImage.state.failure}
                url={imageUrl}
                path={path}
                onAsk={blobImage.ask}
                asked={blobImage.asked}
              />
            )}
            {!error && isRich && RichViewer && (
              <RichViewer target={{ kind: "file", cwd, path }} />
            )}
            {!error && !denial && !isRich && isImage && !isSameOriginApiBase() && (
              <img
                src={imageUrl}
                alt={path}
                className="max-w-full h-auto mx-auto"
                onError={() => setDenial({ kind: "unknown" })}
              />
            )}
            {!error && !isRich && isImage && blobImage.state.status === "ok" && (
              <img src={blobImage.state.src} alt={path} className="max-w-full h-auto mx-auto" />
            )}
            {!error && !isRich && isImage && isSameOriginApiBase() && blobImage.state.status === "loading" && (
              <div className="flex items-center justify-center text-[var(--text-muted)]" data-testid="file-preview-loading">
                <Icon path={mdiLoading} size={1.0} spin className="animate-spin" />
              </div>
            )}
            {!error && !denial && !isImage && !isRich && content === null && (
              <div className="flex items-center justify-center text-[var(--text-muted)]" data-testid="file-preview-loading">
                <Icon path={mdiLoading} size={1.0} spin className="animate-spin" />
              </div>
            )}
            {!error && !isImage && content !== null && isMd && (
              <MarkdownContent
                content={content}
                frontmatter="properties"
                imageBase={{ cwd, dir: absOf(cwd, dirname(path)) }}
              />
            )}
            {!error && !isImage && content !== null && !isMd && language && (
              <SyntaxHighlighter
                style={syntaxStyle}
                language={language}
                PreTag="div"
                showLineNumbers
                wrapLines
                lineProps={(n: number) =>
                  n === line
                    ? { id: TARGET_LINE_ID, style: { display: "block", background: "var(--bg-surface)" } }
                    : { style: { display: "block" } }
                }
                customStyle={{ margin: 0, padding: "0.5rem", fontSize: "12px", background: "var(--bg-code)" }}
                data-testid="file-preview-code"
              >
                {content}
              </SyntaxHighlighter>
            )}
            {!error && !isImage && content !== null && !isMd && !language && (
              <pre className="text-xs font-mono whitespace-pre-wrap text-[var(--text-secondary)]">
                {content.split("\n").map((row, i) => {
                  const num = i + 1;
                  const isTarget = line === num;
                  return (
                    <div
                      key={i}
                      ref={isTarget ? lineRef : undefined}
                      className={isTarget ? "bg-[var(--bg-surface)]" : undefined}
                    >
                      <span className="select-none text-[var(--text-muted)] pr-3 inline-block w-10 text-right">
                        {num}
                      </span>
                      {row}
                    </div>
                  );
                })}
              </pre>
            )}
          </div>
          </div>
        </div>
      </div>
    </DialogPortal>
  );
}
