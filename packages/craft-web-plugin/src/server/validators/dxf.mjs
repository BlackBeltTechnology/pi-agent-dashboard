// DXF sanity check (D7). Binary DXF: the `AutoCAD Binary DXF\r\n\x1a\0` sentinel. ASCII DXF: group-code /
// value line pairs — the first non-comment pair is `0/SECTION`, the head's pairs carry integer group codes,
// and the file ends with `0/EOF`. Reads at most the first 1 MiB and the last 4 KiB.
// See change: extend-craft-web-to-all-apps.
import { head, OK, reject, tail } from "./text-window.mjs";

const BINARY_SENTINEL = "AutoCAD Binary DXF\r\n\x1a\0";
/** Pairs checked for integer group codes at the head (enough to tell a DXF from other text). */
const CHECK_PAIRS = 256;

const lines = (text) => text.split(/\r?\n/);

/** @param {Uint8Array} bytes */
export function validateDxf(bytes) {
  const h = head(bytes);
  if (h.startsWith(BINARY_SENTINEL)) return bytes.length > BINARY_SENTINEL.length ? OK : reject("binary DXF without content");
  const ls = lines(h);
  // A head that ends mid-file may cut the last line; never judge it.
  if (bytes.length > h.length) ls.pop();
  let i = 0;
  while (i + 1 < ls.length && ls[i].trim() === "999") i += 2; // leading comments
  if (ls[i]?.trim() !== "0" || ls[i + 1]?.trim() !== "SECTION") return reject("ASCII DXF must start with 0/SECTION");
  for (let n = 0; n < CHECK_PAIRS && i + 1 < ls.length; n++, i += 2) {
    if (!/^-?\d{1,4}$/.test(ls[i].trim())) return reject(`ASCII DXF group code expected at line ${i + 1}`);
  }
  const t = lines(tail(bytes))
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (t.at(-1) !== "EOF" || t.at(-2) !== "0") return reject("ASCII DXF must end with 0/EOF");
  return OK;
}
