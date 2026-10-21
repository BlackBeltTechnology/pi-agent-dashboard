// VectorCraft document (`.vectorcraft`) sanity check (D7, task 3.1): VectorCraft 0.13.1 saves a JSON object
// `{"format": "vectorcraft", "version": <n>, "generator": …, "document": {…}}`. Bounded: the format and
// version keys within the first 4 KiB, the text starts with `{` and ends with `}`. No JSON is parsed.
// See change: extend-craft-web-to-all-apps.
import { head, OK, reject, tail } from "./text-window.mjs";

/** @param {Uint8Array} bytes */
export function validateVectorcraft(bytes) {
  const h = head(bytes, 4096).replace(/^\uFEFF/, "");
  if (!/^\s*\{\s*"format"\s*:\s*"vectorcraft"\s*,/.test(h)) return reject('missing leading "format": "vectorcraft"');
  if (!/"version"\s*:\s*\d+/.test(h)) return reject("missing version");
  if (!/\}\s*$/.test(tail(bytes, 64))) return reject("truncated document");
  return OK;
}
