/**
 * Pure extension→`RendererKind` table, extracted from the client's
 * `preview-dispatch.ts` so both the client renderer dispatch AND the
 * server-side canvas detector classify through ONE source of truth.
 *
 * No I/O, no MIME sniffing. Extension-based only. `shared` MUST NOT import
 * client — this extraction is client→shared, safe by construction.
 *
 * See change: auto-canvas (Decision 2).
 */

export type RendererKind =
  | "markdown"
  | "asciidoc"
  | "docx"
  | "pptx"
  | "spreadsheet"
  | "html"
  | "pdf"
  | "video"
  | "audio"
  | "image"
  | "youtube"
  | "email"
  | "diagram"
  | "fallback";

/**
 * The non-`fallback` renderer kinds — the canvas policy universe. Grows as
 * sibling preview changes add kinds (docx/spreadsheet via render-office-previews,
 * email via add-eml-preview, diagram via diagram-rendering). `canvasTypes` is
 * sized to this live union.
 */
export const NON_FALLBACK_KINDS: readonly Exclude<RendererKind, "fallback">[] = [
  "markdown",
  "asciidoc",
  "docx",
  "pptx",
  "spreadsheet",
  "html",
  "pdf",
  "video",
  "audio",
  "image",
  "youtube",
  "email",
  "diagram",
];

/** Lowercase extension (including leading dot) → renderer. */
export const RENDERER_BY_EXT: Record<string, RendererKind> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".adoc": "asciidoc",
  ".asciidoc": "asciidoc",
  ".docx": "docx",
  ".pptx": "pptx",
  ".xlsx": "spreadsheet",
  ".csv": "spreadsheet",
  ".html": "html",
  ".htm": "html",
  ".pdf": "pdf",
  ".mp4": "video",
  ".webm": "video",
  ".mov": "video",
  ".mp3": "audio",
  ".wav": "audio",
  ".ogg": "audio",
  ".m4a": "audio",
  ".flac": "audio",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".svg": "image",
  ".webp": "image",
  ".eml": "email",
  ".puml": "diagram",
  ".plantuml": "diagram",
};

/**
 * Extract the lowercase extension (with leading dot) from a path or URL
 * pathname. Strips query/hash so `foo.pdf?x=1` still yields `.pdf`. Returns
 * `""` when there is no extension after the last path separator.
 */
export function extOf(p: string): string {
  const clean = p.split("?")[0].split("#")[0];
  const idx = clean.lastIndexOf(".");
  if (idx < 0) return "";
  const slash = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  if (idx < slash) return "";
  return clean.slice(idx).toLowerCase();
}

/** Renderer kind for a file path by extension, or `fallback`. */
export function rendererKindForPath(path: string): RendererKind {
  return RENDERER_BY_EXT[extOf(path)] ?? "fallback";
}
