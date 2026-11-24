/**
 * Save a workspace file to disk. Hybrid delivery (design D3):
 * - same-origin API base + a file inside the pane cwd → a temporary
 *   `<a download>` to the `download=1` URL (cookie auth; the browser streams to
 *   disk at any size);
 * - otherwise (cross-origin / paired base — bearer is fetch-only; outside-cwd —
 *   may need a grant header / prompt) → fetch through the global wrapper →
 *   Blob → save under the basename, revoking the object URL.
 *
 * See change: add-file-download.
 */
import { getApiBase } from "../../lib/api/api-context.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { downloadUrl } from "./raw-url.js";

export interface DownloadOptions {
  /** The file lives outside the pane cwd (may need an access grant). */
  outsideCwd: boolean;
  /** Surfaces a failure of the Blob path (the link path fails at browser level). */
  showToast?: (text: string, variant?: "error") => void;
}

const basenameOf = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? "download";

function clickAnchor(href: string, filename?: string): void {
  const a = document.createElement("a");
  // client-sinks: allow — same-origin download URL or blob: object URL, clicked then removed
  a.href = href;
  a.download = filename ?? "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function startDownload(
  target: { cwd: string; path: string },
  { outsideCwd, showToast }: DownloadOptions,
): Promise<void> {
  const url = downloadUrl(target);
  if (getApiBase() === "" && !outsideCwd) {
    clickAnchor(url);
    return;
  }
  const fail = () => showToast?.(i18nT("editor.downloadFailed", undefined, "Download failed"), "error");
  let blob: Blob;
  try {
    const res = await fetch(url);
    if (!res.ok) return fail();
    blob = await res.blob();
  } catch {
    return fail();
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    clickAnchor(objectUrl, basenameOf(target.path));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
