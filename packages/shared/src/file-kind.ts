/**
 * Single source of truth for editor-pane viewer discrimination.
 *
 * Pure, browser-safe (no `node:*` imports) so both the dashboard server
 * (`/api/file`, `/api/file/raw`) and the web client (`OpenFileButton`,
 * `EditorFileTree`) classify a path identically. Same inputs always produce
 * the same output; no I/O.
 *
 * See change: add-internal-monaco-editor-pane.
 */

/** Component-registry key selecting the tab renderer. */
export type ViewerKind =
  | "monaco"
  | "image"
  | "pdf"
  | "markdown"
  | "html"
  | "mermaid"
  | "video"
  | "audio"
  | "live-server"
  // Opened explicitly (never returned by `fileKind()`), like `live-server`.
  // `url:<url>` renders a `canvas()` url/youtube declare in the split pane.
  // See change: auto-canvas (S35).
  | "url"
  // Opened explicitly (never returned by `fileKind()`), like `live-server`.
  // Diff tabs open under a virtual `diff:<relPath>` path so they coexist with
  // a monaco tab of the same file. See change: add-change-summary-table.
  | "diff"
  | "binary-warn";

/** Coarse semantic file class. */
export type FileKind =
  | "text"
  | "image"
  | "pdf"
  | "markdown"
  | "html"
  | "mermaid"
  | "video"
  | "audio"
  | "binary"
  | "unknown";

export interface FileKindResult {
  kind: FileKind;
  mimeType: string;
  viewer: ViewerKind;
  /**
   * Render-only in v1. As of `directory-settings-page-and-scoped-md-editing`,
   * `true` for the writable markdown subset (`.md` / `.mdx`); the `Instructions`
   * page mounts the markdown viewer in editable mode when this is set. The
   * server-side write authorization is still gated independently by
   * `isWritableMdTarget`; this flag only drives the UI.
   */
  editable: boolean;
}

/** Markdown extensions render via `MarkdownViewer`, overriding the text/code path. */
const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx", ".markdown"]);

/**
 * Editable markdown subset. Narrower than `MARKDOWN_EXTENSIONS`: `.markdown`
 * renders but stays read-only. Mirrors the write-guard's `.md`/`.mdx` allowance.
 * See change: directory-settings-page-and-scoped-md-editing.
 */
const WRITABLE_MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);

/**
 * Text/code allowlist → Monaco. Intentionally narrow; unrecognized text
 * extensions still fall back to Monaco via the default branch, just without a
 * dedicated language worker.
 */
export const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".jsonc",
  ".py", ".go", ".rs",
  ".yaml", ".yml",
  ".css", ".scss", ".less",
  ".sql",
  ".sh", ".bash", ".zsh",
  ".txt", ".xml", ".toml", ".ini", ".conf", ".log", ".csv",
  ".c", ".cc", ".cpp", ".h", ".hpp",
  ".java", ".rb", ".php", ".lua",
  ".vue", ".svelte", ".graphql", ".proto",
]);

/** Raster + vector image allowlist → `<img>` viewer. */
export const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp", ".avif",
]);

/** HTML → sandboxed `HtmlPreview` iframe (rendered, not source). */
export const HTML_EXTENSIONS = new Set([".html", ".htm"]);

/** Mermaid diagram source → `MermaidBlock`. */
export const MERMAID_EXTENSIONS = new Set([".mmd", ".mermaid"]);

/** Audio → `<audio controls>` viewer (Range-driven). */
export const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".flac"]);

/** Video → `<video controls>` viewer. Aligns with `file-and-url-preview`. */
export const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov"]);

/** Specific MIME overrides; everything else derives from `kind`. */
const MIME_BY_EXT: Record<string, string> = {
  ".ts": "text/x.typescript",
  ".tsx": "text/x.typescript",
  ".js": "text/javascript",
  ".jsx": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".json": "application/json",
  ".jsonc": "application/json",
  ".py": "text/x-python",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".sql": "text/x-sql",
  ".sh": "text/x-shellscript",
  ".bash": "text/x-shellscript",
  ".zsh": "text/x-shellscript",
  ".xml": "application/xml",
  ".csv": "text/csv",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".mmd": "text/vnd.mermaid",
  ".mermaid": "text/vnd.mermaid",
  ".md": "text/markdown",
  ".mdx": "text/markdown",
  ".markdown": "text/markdown",
};

/** True for POSIX (`/…`) and Windows (`C:\…`, `C:/…`, `\\unc`) absolute paths. */
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");
}

/** Lowercased extension including the leading dot, or `""` when none. */
function extOf(absPath: string): string {
  const lastSlash = Math.max(absPath.lastIndexOf("/"), absPath.lastIndexOf("\\"));
  const base = lastSlash >= 0 ? absPath.slice(lastSlash + 1) : absPath;
  const dot = base.lastIndexOf(".");
  // dot at position 0 → dotfile (e.g. `.gitignore`), treated as no extension.
  if (dot <= 0) return "";
  return base.slice(dot).toLowerCase();
}

/** NUL byte in the first 1024 bytes ⇒ treat as binary. */
function looksBinary(sniff: Buffer | string): boolean {
  const limit = Math.min(sniff.length, 1024);
  for (let i = 0; i < limit; i++) {
    const byte = typeof sniff === "string" ? sniff.charCodeAt(i) : sniff[i];
    if (byte === 0) return true;
  }
  return false;
}

/**
 * Classify a file path for editor-pane viewer dispatch.
 *
 * @param absPath absolute path (relative paths throw — both ends pass absolute)
 * @param sniff   optional first bytes; server-only NUL sniff promotes unknown
 *                extensions to `binary`. Absent ⇒ extension-only classification.
 */
export function fileKind(absPath: string, sniff?: Buffer | string): FileKindResult {
  if (!isAbsolutePath(absPath)) {
    throw new Error(`fileKind requires an absolute path, got: ${absPath}`);
  }

  const ext = extOf(absPath);
  const mimeOf = (fallback: string): string => MIME_BY_EXT[ext] ?? fallback;

  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return {
      kind: "markdown",
      mimeType: mimeOf("text/markdown"),
      viewer: "markdown",
      editable: WRITABLE_MARKDOWN_EXTENSIONS.has(ext),
    };
  }
  if (ext === ".pdf") {
    return { kind: "pdf", mimeType: mimeOf("application/pdf"), viewer: "pdf", editable: false };
  }
  if (HTML_EXTENSIONS.has(ext)) {
    return { kind: "html", mimeType: mimeOf("text/html"), viewer: "html", editable: false };
  }
  if (MERMAID_EXTENSIONS.has(ext)) {
    return { kind: "mermaid", mimeType: mimeOf("text/vnd.mermaid"), viewer: "mermaid", editable: false };
  }
  if (AUDIO_EXTENSIONS.has(ext)) {
    return { kind: "audio", mimeType: mimeOf("application/octet-stream"), viewer: "audio", editable: false };
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return { kind: "video", mimeType: mimeOf("application/octet-stream"), viewer: "video", editable: false };
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    return { kind: "image", mimeType: mimeOf("application/octet-stream"), viewer: "image", editable: false };
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return { kind: "text", mimeType: mimeOf("text/plain"), viewer: "monaco", editable: false };
  }

  // Unknown extension: sniff (server-only) decides text vs binary.
  if (sniff !== undefined && looksBinary(sniff)) {
    return { kind: "binary", mimeType: "application/octet-stream", viewer: "binary-warn", editable: false };
  }
  return { kind: "unknown", mimeType: mimeOf("text/plain"), viewer: "monaco", editable: false };
}
