/**
 * Device download from the HOST origin (anchor + blob). The frame has no
 * `allow-downloads` by design, so every export/save-to-device goes through here.
 * See change: edit-office-in-pane-with-craft-web (D4).
 */
import { baseName } from "./save-routing.js";

/** Strips path separators and control characters from an app-supplied file name. */
function safeDownloadName(name: string): string {
  const cleaned = baseName(name).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned || "download";
}

export function downloadToDevice(name: string, bytes: ArrayBuffer, mime?: string): void {
  const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  // client-sinks: allow — same-origin blob: object URL for a download
  a.href = url;
  a.download = safeDownloadName(name);
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
