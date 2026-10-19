// OOXML content validator for the craft-web file-handler claims. Runs in a worker thread via
// `ctx.registerFileValidator` (plain ESM, node built-ins only — no TS, no third-party imports).
//
// Accepts bytes only when they are a zip package whose `[Content_Types].xml` declares, and whose
// archive contains, the main document part of the target kind. It reads the zip CENTRAL DIRECTORY
// (never walks local headers beyond the one content-types entry), bounds every size, rejects a
// DOCTYPE/ENTITY declaration and never parses or expands XML: the `<Override>` elements are read
// by a bounded attribute scan.
//
// See change: edit-office-in-pane-with-craft-web (D5).
import { inflateRawSync } from "node:zlib";

const MAX_ENTRIES = 10_000;
const MAX_CONTENT_TYPES_BYTES = 1024 * 1024;
const MAX_OVERRIDES = 20_000;
const EOCD_SEARCH = 22 + 0xffff;

const MAIN_CONTENT_TYPE = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
};

const reject = (reason) => ({ ok: false, reason });

/** Last End-Of-Central-Directory record whose comment length is consistent with the file length. */
function findEocd(view, len) {
  const min = Math.max(0, len - EOCD_SEARCH);
  for (let p = len - 22; p >= min; p--) {
    if (view.getUint32(p, true) !== 0x06054b50) continue;
    if (p + 22 + view.getUint16(p + 20, true) <= len) return p;
  }
  return -1;
}

/** End-Of-Central-Directory fields, or `{ error }` for a package this validator refuses (multi-disk, zip64, too many entries). */
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

/** Central directory → `{ names:Set, contentTypes }` (the `[Content_Types].xml` entry), or `{ error }`. */
function readDirectory(bytes, view) {
  const eocd = readEocd(view, bytes.length);
  if (eocd.error) return eocd;
  const names = new Set();
  let contentTypes;
  let p = eocd.cdOffset;
  for (let i = 0; i < eocd.total; i++) {
    const e = readEntry(bytes, view, p, eocd.cdEnd);
    if (!e) return { error: "corrupt zip central directory" };
    if (e.name.toLowerCase() === "[content_types].xml") {
      if (contentTypes) return { error: "duplicate [Content_Types].xml" };
      contentTypes = e;
    }
    names.add(e.name);
    p = e.next;
  }
  return { names, contentTypes };
}

/** Inflate the content-types entry (bounded), or `{ error }`. */
function readContentTypes(bytes, view, entry) {
  if (entry.flags & 1) return { error: "encrypted [Content_Types].xml" };
  if (entry.size > MAX_CONTENT_TYPES_BYTES) return { error: "[Content_Types].xml too large" };
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
      data = inflateRawSync(raw, { maxOutputLength: MAX_CONTENT_TYPES_BYTES + 1 });
    } catch {
      return { error: "[Content_Types].xml is corrupt or too large" };
    }
  } else return { error: "unsupported compression for [Content_Types].xml" };
  if (data.length > MAX_CONTENT_TYPES_BYTES) return { error: "[Content_Types].xml too large" };
  return { text: Buffer.from(data).toString("utf8") };
}

/** Bounded attribute scan of the `<Override PartName=… ContentType=…/>` elements (no XML parser). */
function mainPartNames(xml, mainContentType) {
  const parts = [];
  const element = /<(?:[A-Za-z0-9_.-]+:)?Override\b([^>]*)>/g;
  let seen = 0;
  for (let m = element.exec(xml); m !== null; m = element.exec(xml)) {
    if (++seen > MAX_OVERRIDES) break;
    let partName;
    let contentType;
    const attr = /\b(PartName|ContentType)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    for (let a = attr.exec(m[1]); a !== null; a = attr.exec(m[1])) {
      const value = a[2] ?? a[3];
      if (a[1] === "PartName") partName = value;
      else contentType = value;
    }
    if (contentType === mainContentType && partName !== undefined && !partName.includes("&")) parts.push(partName);
  }
  return parts;
}

/**
 * @param {Uint8Array} bytes the document about to be written
 * @param {string} ext lower-case extension with leading dot (`.docx` | `.xlsx` | `.pptx`)
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function validate(bytes, ext) {
  const mainContentType = MAIN_CONTENT_TYPE[ext];
  if (!mainContentType) return reject(`unsupported extension ${String(ext)}`);
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return reject("empty document");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const dir = readDirectory(bytes, view);
  if (dir.error) return reject(dir.error);
  if (!dir.contentTypes) return reject("missing [Content_Types].xml");
  const ct = readContentTypes(bytes, view, dir.contentTypes);
  if (ct.error) return reject(ct.error);
  const xml = ct.text.charCodeAt(0) === 0xfeff ? ct.text.slice(1) : ct.text;
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) return reject("[Content_Types].xml declares a DOCTYPE or ENTITY");

  const parts = mainPartNames(xml, mainContentType);
  if (parts.length === 0) return reject(`[Content_Types].xml does not declare the ${ext} main document part`);
  if (!parts.some((p) => dir.names.has(p.replace(/^\//, "")))) return reject(`the ${ext} main document part is missing from the package`);
  return { ok: true };
}
