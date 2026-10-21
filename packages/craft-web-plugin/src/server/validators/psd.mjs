// PSD / PSB sanity check (D7): `8BPS` signature + version 1 (PSD) or 2 (PSB). See change: extend-craft-web-to-all-apps.
import { OK, reject } from "./text-window.mjs";

/** @param {Uint8Array} bytes */
export function validatePsd(bytes) {
  if (bytes.length < 26) return reject("PSD too short");
  if (bytes[0] !== 0x38 || bytes[1] !== 0x42 || bytes[2] !== 0x50 || bytes[3] !== 0x53) return reject("missing 8BPS signature");
  const version = (bytes[4] << 8) | bytes[5];
  return version === 1 || version === 2 ? OK : reject(`unsupported PSD version ${version}`);
}
