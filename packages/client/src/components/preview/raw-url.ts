/**
 * Build the `/api/file/raw` URL for a file-kind ViewTarget. Used by
 * `<img>`, `<video>`, `<iframe>` previews. See change: render-file-previews.
 */
import { getApiBase } from "../../lib/api-context.js";

export function rawUrl(target: { kind: "file"; cwd: string; path: string }): string {
  const base = getApiBase();
  const cwd = encodeURIComponent(target.cwd);
  const p = encodeURIComponent(target.path);
  return `${base}/api/file/raw?cwd=${cwd}&path=${p}`;
}

export function renderUrl(target: { kind: "file"; cwd: string; path: string }): string {
  const base = getApiBase();
  const cwd = encodeURIComponent(target.cwd);
  const p = encodeURIComponent(target.path);
  return `${base}/api/file/render?cwd=${cwd}&path=${p}`;
}

export function readTextUrl(target: { kind: "file"; cwd: string; path: string }): string {
  const base = getApiBase();
  const cwd = encodeURIComponent(target.cwd);
  const p = encodeURIComponent(target.path);
  return `${base}/api/file?cwd=${cwd}&path=${p}`;
}

/** `/api/file/rendered-pdf` URL for a docx→PDF stream. See change: render-office-previews. */
export function renderedPdfUrl(target: { kind: "file"; cwd: string; path: string }): string {
  const base = getApiBase();
  const cwd = encodeURIComponent(target.cwd);
  const p = encodeURIComponent(target.path);
  return `${base}/api/file/rendered-pdf?cwd=${cwd}&path=${p}`;
}

/** `/api/file/sheet` URL for xlsx/csv structured JSON. See change: render-office-previews. */
export function sheetUrl(
  target: { kind: "file"; cwd: string; path: string },
  limit?: number,
): string {
  const base = getApiBase();
  const cwd = encodeURIComponent(target.cwd);
  const p = encodeURIComponent(target.path);
  const q = limit != null ? `&limit=${encodeURIComponent(String(limit))}` : "";
  return `${base}/api/file/sheet?cwd=${cwd}&path=${p}${q}`;
}

/** `/api/file/eml` parse URL. `allowRemote` preserves remote resource refs. */
export function emlUrl(
  target: { kind: "file"; cwd: string; path: string },
  allowRemote = false,
): string {
  const base = getApiBase();
  const cwd = encodeURIComponent(target.cwd);
  const p = encodeURIComponent(target.path);
  return `${base}/api/file/eml?cwd=${cwd}&path=${p}${allowRemote ? "&allowRemote=1" : ""}`;
}

/** `/api/file/eml-attachment` streaming URL for one 0-based attachment index. */
export function emlAttachmentUrl(
  target: { kind: "file"; cwd: string; path: string },
  index: number,
): string {
  const base = getApiBase();
  const cwd = encodeURIComponent(target.cwd);
  const p = encodeURIComponent(target.path);
  return `${base}/api/file/eml-attachment?cwd=${cwd}&path=${p}&index=${index}`;
}
