// PDF sanity check (D7): `%PDF-1.x` (or 2.0) header within the first 1 KiB, `%%EOF` within the last 2 KiB.
// Reject-only, bounded. See change: extend-craft-web-to-all-apps.
import { head, OK, reject, tail } from "./text-window.mjs";

/** @param {Uint8Array} bytes */
export function validatePdf(bytes) {
  if (!/%PDF-(?:1\.[0-7]|2\.0)/.test(head(bytes, 1024))) return reject("no %PDF-1.x header in the first 1 KiB");
  if (!tail(bytes, 2048).includes("%%EOF")) return reject("no %%EOF marker in the last 2 KiB");
  return OK;
}
