// Raster image signatures (D7): each extension needs ITS OWN signature (PNG bytes fail a `.jpg` write).
// See change: extend-craft-web-to-all-apps.
import { OK, reject } from "./text-window.mjs";

const startsWith = (b, sig, at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

/** @type {Record<string, (b: Uint8Array) => boolean>} */
const SIGNATURES = {
  ".png": (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ".jpg": (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  ".jpeg": (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  ".webp": (b) => startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8),
  ".tif": (b) => startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a]),
  ".tiff": (b) => startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a]),
};

export const RASTER_EXTENSIONS = Object.keys(SIGNATURES);

/** @param {Uint8Array} bytes @param {string} ext */
export function validateRaster(bytes, ext) {
  const check = SIGNATURES[ext];
  if (!check) return reject(`no raster signature for ${ext}`);
  return bytes.length >= 12 && check(bytes) ? OK : reject(`not a ${ext} image`);
}
