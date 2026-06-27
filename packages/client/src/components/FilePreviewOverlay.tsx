import { mdiClose, mdiLoading } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useEffect, useRef, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { getApiBase } from "../lib/api-context.js";
import { t as i18nT } from "../lib/i18n";
import { getSyntaxTheme } from "../lib/syntax-theme.js";
import { DialogPortal } from "./DialogPortal.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { useThemeContext } from "./ThemeProvider.js";
import { detectLanguage } from "./tool-renderers/lang-detect.js";

/** DOM id of the scroll target line inside the highlighted code view. */
const TARGET_LINE_ID = "file-preview-target-line";

const BACKDROP_ID = "file-preview-backdrop";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);
const MD_EXTS = new Set(["md", "mdx"]);

interface Props {
  cwd: string;
  path: string;
  line?: number;
  onClose: () => void;
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
export function FilePreviewOverlay({ cwd, path, line, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const lineRef = useRef<HTMLDivElement | null>(null);
  const { resolved: theme, themeName } = useThemeContext();
  const syntaxStyle = getSyntaxTheme(theme, themeName);

  const ext = getExt(path);
  const isImage = IMAGE_EXTS.has(ext);
  const isMd = MD_EXTS.has(ext);
  const language = detectLanguage(path);

  useEffect(() => {
    if (isImage) return; // image loads via <img src>, no JSON fetch
    let cancelled = false;
    (async () => {
      try {
        const url = `${getApiBase()}/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`;
        const res = await fetch(url);
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
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, path, isImage]);

  // Esc + backdrop click dismiss.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    const handleClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.dataset?.testid === BACKDROP_ID) onCloseRef.current();
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("click", handleClick);
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
      <div
        data-testid={BACKDROP_ID}
        className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      >
        <div
          className="bg-[var(--bg-primary)] border border-[var(--border-secondary)] rounded shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col"
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
              title={i18nT("auto.close", undefined, "Close")}
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
            {!error && isImage && (
              <img
                src={`${getApiBase()}/api/file/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`}
                alt={path}
                className="max-w-full h-auto mx-auto"
                onError={() => setError((prev) => prev ?? `Failed to load image: ${path}`)}
              />
            )}
            {!error && !isImage && content === null && (
              <div className="flex items-center justify-center text-[var(--text-muted)]" data-testid="file-preview-loading">
                <Icon path={mdiLoading} size={1.0} spin className="animate-spin" />
              </div>
            )}
            {!error && !isImage && content !== null && isMd && (
              <MarkdownContent content={content} frontmatter="properties" />
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
    </DialogPortal>
  );
}
