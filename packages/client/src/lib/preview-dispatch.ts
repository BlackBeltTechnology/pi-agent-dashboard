/**
 * Pure dispatch from a `ViewTarget` to a `RendererKind`. No I/O, no MIME
 * sniffing, no server round-trips — extension- and URL-pattern-based only.
 * Single source of truth for `/view` renderer selection. See change:
 * render-file-previews.
 *
 * The extension→kind table (`RENDERER_BY_EXT`, `RendererKind`, `extOf`) now
 * lives in `packages/shared/src/renderer-by-ext.ts` so the server-side canvas
 * detector shares ONE table (see change: auto-canvas). Re-exported here so
 * existing client imports keep working.
 */

import {
  extOf,
  RENDERER_BY_EXT,
  type RendererKind,
} from "@blackbelt-technology/pi-dashboard-shared/renderer-by-ext.js";
import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export type { RendererKind };
export { RENDERER_BY_EXT };

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);

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
