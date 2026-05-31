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
