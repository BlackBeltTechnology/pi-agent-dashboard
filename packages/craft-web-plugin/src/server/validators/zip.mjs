// Bounded zip CENTRAL-DIRECTORY reader shared by the craft-web format validators (worker-run, plain ESM,
// node built-ins only). Never walks local headers except to read one small member on request; refuses
// multi-disk, zip64 and more than MAX_ENTRIES entries.
//
// See change: edit-office-in-pane-with-craft-web (D5), extend-craft-web-to-all-apps (D7).
import { inflateRawSync } from "node:zlib";

export const MAX_ENTRIES = 10_000;
const EOCD_SEARCH = 22 + 0xffff;

/** Last End-Of-Central-Directory record whose comment length is consistent with the file length. */
function findEocd(view, len) {
  const min = Math.max(0, len - EOCD_SEARCH);
  for (let p = len - 22; p >= min; p--) {
    if (view.getUint32(p, true) !== 0x06054b50) continue;
    if (p + 22 + view.getUint16(p + 20, true) <= len) return p;
  }
  return -1;
}

/** End-Of-Central-Directory fields, or `{ error }` for a package this reader refuses (multi-disk, zip64, too many entries). */
function readEocd(view, len) {
  if (len < 22) return { error: "not a zip package" };
  const eocd = findEocd(view, len);
  if (eocd < 0) return { error: "not a zip package" };
  const total = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) return { error: "multi-disk zip" };
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return { error: "zip64 package" };
  if (total > MAX_ENTRIES) return { error: `too many zip entries (>${MAX_ENTRIES})` };
  if (cdOffset + cdSize > eocd) return { error: "corrupt zip central directory" };
  return { total, cdOffset, cdEnd: cdOffset + cdSize };
}

/** One central-directory entry at `p`, or `null` when it does not fit / has the wrong signature. */
function readEntry(bytes, view, p, cdEnd) {
  if (p + 46 > cdEnd || view.getUint32(p, true) !== 0x02014b50) return null;
  const nameLen = view.getUint16(p + 28, true);
  const extraLen = view.getUint16(p + 30, true);
  const commentLen = view.getUint16(p + 32, true);
  const next = p + 46 + nameLen + extraLen + commentLen;
  if (next > cdEnd) return null;
  return {
    next,
    name: Buffer.from(bytes.subarray(p + 46, p + 46 + nameLen)).toString("utf8"),
    flags: view.getUint16(p + 8, true),
    method: view.getUint16(p + 10, true),
    compSize: view.getUint32(p + 20, true),
    size: view.getUint32(p + 24, true),
    localOffset: view.getUint32(p + 42, true),
  };
}

/**
 * Central directory of `bytes` → `{ entries }` (directory order), or `{ error }`.
 * @param {Uint8Array} bytes
 */
export function readZipDirectory(bytes) {
  if (!(bytes instanceof Uint8Array)) return { error: "not a zip package" };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = readEocd(view, bytes.length);
  if (eocd.error) return eocd;
  const entries = [];
  let p = eocd.cdOffset;
  for (let i = 0; i < eocd.total; i++) {
    const e = readEntry(bytes, view, p, eocd.cdEnd);
    if (!e) return { error: "corrupt zip central directory" };
    entries.push(e);
    p = e.next;
  }
  return { entries, view };
}

/** Bytes of one (small) member: `{ data }` or `{ error }`; stored or deflated, at most `max` bytes. */
export function readZipMember(bytes, view, entry, max) {
  if (entry.flags & 1) return { error: `encrypted ${entry.name}` };
  if (entry.size > max) return { error: `${entry.name} too large` };
  if (entry.compSize === 0xffffffff || entry.localOffset + 30 > bytes.length) return { error: "corrupt zip entry" };
  if (view.getUint32(entry.localOffset, true) !== 0x04034b50) return { error: "corrupt zip entry" };
  const start = entry.localOffset + 30 + view.getUint16(entry.localOffset + 26, true) + view.getUint16(entry.localOffset + 28, true);
  const end = start + entry.compSize;
  if (end > bytes.length) return { error: "corrupt zip entry" };
  const raw = bytes.subarray(start, end);
  let data;
  if (entry.method === 0) data = raw;
  else if (entry.method === 8) {
    try {
      data = inflateRawSync(raw, { maxOutputLength: max + 1 });
    } catch {
      return { error: `${entry.name} is corrupt or too large` };
    }
  } else return { error: `unsupported compression for ${entry.name}` };
  if (data.length > max) return { error: `${entry.name} too large` };
  return { data };
}
