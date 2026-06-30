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
export type ViewerKind = "monaco" | "image" | "pdf" | "markdown" | "binary-warn";

/** Coarse semantic file class. */
export type FileKind = "text" | "image" | "pdf" | "markdown" | "binary" | "unknown";

export interface FileKindResult {
  kind: FileKind;
  mimeType: string;
  viewer: ViewerKind;
  /** Always `false` in v1 (read-only). v3/v4 repurpose this. */
  editable: boolean;
}

/** Markdown extensions render via `MarkdownViewer`, overriding the text/code path. */
const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx", ".markdown"]);

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
  ".html", ".htm", ".css", ".scss", ".less",
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
    return { kind: "markdown", mimeType: mimeOf("text/markdown"), viewer: "markdown", editable: false };
  }
  if (ext === ".pdf") {
    return { kind: "pdf", mimeType: mimeOf("application/pdf"), viewer: "pdf", editable: false };
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
