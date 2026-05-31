/**
 * Map a lowercase file extension (including the leading dot) to a MIME
 * `Content-Type` for the `/api/file/raw` binary-safe endpoint. Defaults
 * to `application/octet-stream` for unknown extensions.
 * See change: render-file-previews.
 */

const TABLE: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".adoc": "text/asciidoc; charset=utf-8",
  ".asciidoc": "text/asciidoc; charset=utf-8",
};

export function extToContentType(ext: string): string {
  return TABLE[ext.toLowerCase()] ?? "application/octet-stream";
}
