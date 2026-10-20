// OOXML content validator for the craft-web file-handler claims. Runs in a worker thread via
// `ctx.registerFileValidator` (plain ESM, node built-ins only — no TS, no third-party imports).
//
// Accepts bytes only when they are a zip package whose `[Content_Types].xml` declares, and whose
// archive contains, the main document part of the target kind. It reads the zip CENTRAL DIRECTORY
// (never walks local headers beyond the one content-types entry), bounds every size, rejects a
// DOCTYPE/ENTITY declaration and never parses or expands XML: the `<Override>` elements are read
// by a bounded attribute scan.
//
// See change: edit-office-in-pane-with-craft-web (D5). Zip reading shared via ./zip.mjs (behaviour unchanged);
// dispatched by ./index.mjs. See change: extend-craft-web-to-all-apps (D7).
import { readZipDirectory, readZipMember } from "./zip.mjs";

const MAX_CONTENT_TYPES_BYTES = 1024 * 1024;
const MAX_OVERRIDES = 20_000;

const MAIN_CONTENT_TYPE = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
};

const reject = (reason) => ({ ok: false, reason });

/** Central directory → `{ names:Set, contentTypes, view }` (the `[Content_Types].xml` entry), or `{ error }`. */
function readDirectory(bytes) {
  const dir = readZipDirectory(bytes);
  if (dir.error) return dir;
  const names = new Set();
  let contentTypes;
  for (const e of dir.entries) {
    if (e.name.toLowerCase() === "[content_types].xml") {
      if (contentTypes) return { error: "duplicate [Content_Types].xml" };
      contentTypes = e;
    }
    names.add(e.name);
  }
  return { names, contentTypes, view: dir.view };
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
  const dir = readDirectory(bytes);
  if (dir.error) return reject(dir.error);
  if (!dir.contentTypes) return reject("missing [Content_Types].xml");
  const ct = readZipMember(bytes, dir.view, dir.contentTypes, MAX_CONTENT_TYPES_BYTES);
  if (ct.error) return reject(ct.error);
  const text = Buffer.from(ct.data).toString("utf8");
  const xml = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) return reject("[Content_Types].xml declares a DOCTYPE or ENTITY");

  const parts = mainPartNames(xml, mainContentType);
  if (parts.length === 0) return reject(`[Content_Types].xml does not declare the ${ext} main document part`);
  if (!parts.some((p) => dir.names.has(p.replace(/^\//, "")))) return reject(`the ${ext} main document part is missing from the package`);
  return { ok: true };
}
