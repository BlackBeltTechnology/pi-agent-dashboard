/**
 * Pure dispatch from a `ViewTarget` to a `RendererKind`. No I/O, no MIME
 * sniffing, no server round-trips — extension- and URL-pattern-based only.
 * Single source of truth for `/view` renderer selection. See change:
 * render-file-previews.
 */
import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export type RendererKind =
  | "markdown"
  | "asciidoc"
  | "html"
  | "pdf"
  | "video"
  | "image"
  | "youtube"
  | "fallback";

/** Lowercase extension (including leading dot) → renderer. */
export const RENDERER_BY_EXT: Record<string, RendererKind> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".adoc": "asciidoc",
  ".asciidoc": "asciidoc",
  ".html": "html",
  ".htm": "html",
  ".pdf": "pdf",
  ".mp4": "video",
  ".webm": "video",
  ".mov": "video",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".svg": "image",
  ".webp": "image",
};

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);

function extOf(p: string): string {
  // Strip query/hash before extracting the extension so `foo.pdf?x=1`
  // still dispatches as `.pdf`.
  const clean = p.split("?")[0].split("#")[0];
  const idx = clean.lastIndexOf(".");
  if (idx < 0) return "";
  const slash = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  if (idx < slash) return "";
  return clean.slice(idx).toLowerCase();
}

export function dispatchPreview(target: ViewTarget): RendererKind {
  if (target.kind === "file") {
    return RENDERER_BY_EXT[extOf(target.path)] ?? "fallback";
  }
  // URL target — host first, then extension, then fallback.
  let host = "";
  let pathname = "";
  try {
    const u = new URL(target.url);
    host = u.hostname.toLowerCase();
    pathname = u.pathname;
  } catch {
    return "fallback";
  }
  if (YOUTUBE_HOSTS.has(host)) return "youtube";
  const ext = extOf(pathname);
  return RENDERER_BY_EXT[ext] ?? "fallback";
}
