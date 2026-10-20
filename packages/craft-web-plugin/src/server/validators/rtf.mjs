// RTF sanity check (D7): `{\rtf1` at offset 0. See change: extend-craft-web-to-all-apps.
import { head, OK, reject } from "./text-window.mjs";

/** @param {Uint8Array} bytes */
export function validateRtf(bytes) {
  return /^\{\\rtf1(?![0-9])/.test(head(bytes, 16)) ? OK : reject("RTF must start with {\\rtf1");
}
