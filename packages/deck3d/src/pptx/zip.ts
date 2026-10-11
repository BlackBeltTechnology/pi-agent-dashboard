/**
 * Guarded OOXML zip reader (design D1, spec "Untrusted input is contained").
 *
 *  1. Sniff the container: an OLE compound file is "encrypted" when it holds
 *     an `EncryptionInfo` stream, else "not a .pptx (OOXML) file"; anything
 *     without a zip end-of-central-directory record is the latter too.
 *  2. Read the central directory and reject on DECLARED entry count / sizes /
 *     ratio and on absolute or `..` entry names — before inflating a byte.
 *  3. Inflate each entry in small input slices with fflate's streaming
 *     `Inflate`, counting ACTUAL output per entry and in total, and abort the
 *     moment a limit or the ratio is crossed. A bomb is never fully inflated.
 *  4. Reject any XML part (by `[Content_Types].xml` type or `.xml`/`.rels`
 *     name) whose raw bytes contain `<!DOCTYPE`. Media are never scanned.
 */
import { Inflate } from "fflate";
import { PptxImportError } from "./types.js";

export const ZIP_LIMITS = {
  maxEntries: 4000,
  maxEntryBytes: 128 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxRatio: 200,
  /**
   * The ratio rule is evaluated once an entry's output passes this size. A
   * few-KiB part can exceed 200:1 legitimately (boilerplate XML) and cannot
   * be a bomb; every bomb crosses this floor long before it does damage.
   */
  ratioFloorBytes: 1024 * 1024,
};

const MiB = 1024 * 1024;
/** Compressed bytes pushed per inflate step — bounds the output of one step. */
const SLICE = 4096;

export class ZipLimitError extends PptxImportError {
  constructor(
    message: string,
    /** Actual bytes inflated for the offending entry when the stream stopped. */
    readonly inflated = 0,
  ) {
    super(message);
    this.name = "ZipLimitError";
  }
}

interface CdEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  flags: number;
}

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

/** UTF-16LE needle search — OLE directory entry names are stored that way. */
function containsUtf16(bytes: Uint8Array, text: string): boolean {
  const needle = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) needle[i * 2] = text.charCodeAt(i);
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

function notOoxml(): PptxImportError {
  return new PptxImportError("not a .pptx (OOXML) file");
}

function findEocd(bytes: Uint8Array): number {
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
  }
  return -1;
}

/** Absolute, drive-letter, backslash-rooted or `..`-segment names are rejected. */
export function unsafeEntryName(name: string): boolean {
  if (name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/.test(name)) return true;
  return name.split(/[\\/]/).some((seg) => seg === "..");
}

function readCentralDirectory(bytes: Uint8Array): CdEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes);
  if (eocd < 0) throw notOoxml();
  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count > ZIP_LIMITS.maxEntries) {
    throw new ZipLimitError(`zip lists ${count} entries (limit ${ZIP_LIMITS.maxEntries})`);
  }
  const entries: CdEntry[] = [];
  let p = cdOffset;
  let declaredTotal = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw notOoxml();
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (unsafeEntryName(name)) throw new ZipLimitError(`unsafe entry name '${name}' (absolute or '..' segment)`);
    if (size > ZIP_LIMITS.maxEntryBytes) {
      throw new ZipLimitError(`entry '${name}' declares ${size} bytes (limit ${ZIP_LIMITS.maxEntryBytes / MiB} MiB per entry)`);
    }
    declaredTotal += size;
    if (declaredTotal > ZIP_LIMITS.maxTotalBytes) {
      throw new ZipLimitError(`zip declares more than ${ZIP_LIMITS.maxTotalBytes / MiB} MiB uncompressed (at entry '${name}')`);
    }
    if (size >= ZIP_LIMITS.ratioFloorBytes && size > ZIP_LIMITS.maxRatio * Math.max(1, compressedSize)) {
      throw new ZipLimitError(`entry '${name}' declares a compression ratio above ${ZIP_LIMITS.maxRatio}:1`);
    }
    entries.push({ name, method, compressedSize, size, localOffset, flags });
  }
  return entries;
}

function entryData(bytes: Uint8Array, e: CdEntry): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const p = e.localOffset;
  if (p + 30 > bytes.length || view.getUint32(p, true) !== 0x04034b50) throw new PptxImportError(`corrupt zip entry '${e.name}'`);
  const start = p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true);
  if (start + e.compressedSize > bytes.length) throw new PptxImportError(`truncated zip entry '${e.name}'`);
  return bytes.subarray(start, start + e.compressedSize);
}

function inflateGuarded(name: string, data: Uint8Array, budget: { total: number }): Uint8Array {
  const chunks: Uint8Array[] = [];
  let produced = 0;
  const check = (): void => {
    if (produced > ZIP_LIMITS.maxEntryBytes) {
      throw new ZipLimitError(`entry '${name}' inflates past ${ZIP_LIMITS.maxEntryBytes / MiB} MiB (limit per entry)`, produced);
    }
    if (budget.total + produced > ZIP_LIMITS.maxTotalBytes) {
      throw new ZipLimitError(`zip inflates past ${ZIP_LIMITS.maxTotalBytes / MiB} MiB in total (at entry '${name}')`, produced);
    }
    if (produced >= ZIP_LIMITS.ratioFloorBytes && produced > ZIP_LIMITS.maxRatio * Math.max(1, data.length)) {
      throw new ZipLimitError(`entry '${name}' exceeds a compression ratio of ${ZIP_LIMITS.maxRatio}:1`, produced);
    }
  };
  const inflater = new Inflate((chunk) => {
    produced += chunk.length;
    check();
    chunks.push(chunk);
  });
  for (let off = 0; off < data.length; off += SLICE) {
    const end = Math.min(data.length, off + SLICE);
    inflater.push(data.subarray(off, end), end === data.length);
  }
  if (data.length === 0) inflater.push(new Uint8Array(0), true);
  budget.total += produced;
  const out = new Uint8Array(produced);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

const DOCTYPE = [0x3c, 0x21, 0x64, 0x6f, 0x63, 0x74, 0x79, 0x70, 0x65]; // "<!doctype"

/** Case-insensitive raw-byte scan for `<!DOCTYPE`. */
export function hasDoctype(bytes: Uint8Array): boolean {
  outer: for (let i = 0; i + DOCTYPE.length <= bytes.length; i++) {
    for (let j = 0; j < DOCTYPE.length; j++) {
      const b = bytes[i + j];
      const lower = b >= 0x41 && b <= 0x5a ? b + 0x20 : b;
      if (lower !== DOCTYPE[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** Part names `[Content_Types].xml` declares with an XML content type. */
function xmlPartsFromContentTypes(ct: Uint8Array | undefined): { overrides: Set<string>; extensions: Set<string> } {
  const overrides = new Set<string>();
  const extensions = new Set<string>();
  if (!ct) return { overrides, extensions };
  const text = new TextDecoder().decode(ct);
  for (const m of text.matchAll(/<Override\b[^>]*>/g)) {
    const part = /PartName="([^"]+)"/.exec(m[0])?.[1];
    const type = /ContentType="([^"]+)"/.exec(m[0])?.[1] ?? "";
    if (part && /xml/i.test(type)) overrides.add(part.replace(/^\//, ""));
  }
  for (const m of text.matchAll(/<Default\b[^>]*>/g)) {
    const ext = /Extension="([^"]+)"/.exec(m[0])?.[1];
    const type = /ContentType="([^"]+)"/.exec(m[0])?.[1] ?? "";
    if (ext && /xml/i.test(type)) extensions.add(ext.toLowerCase());
  }
  return { overrides, extensions };
}

/** Read every entry of a pptx zip into memory, under the D1 guards. */
export function readPptxZip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (startsWith(bytes, OLE_MAGIC)) {
    if (containsUtf16(bytes, "EncryptionInfo")) {
      throw new PptxImportError("the file is encrypted (password-protected pptx); remove the password and export again");
    }
    throw notOoxml();
  }
  const entries = readCentralDirectory(bytes);
  const files = new Map<string, Uint8Array>();
  const budget = { total: 0 };
  for (const e of entries) {
    if (e.name.endsWith("/")) continue;
    if (e.flags & 1) throw new PptxImportError(`entry '${e.name}' is encrypted`);
    const data = entryData(bytes, e);
    let out: Uint8Array;
    if (e.method === 0) {
      out = data;
      budget.total += out.length;
      if (budget.total > ZIP_LIMITS.maxTotalBytes) throw new ZipLimitError(`zip exceeds ${ZIP_LIMITS.maxTotalBytes / MiB} MiB in total`);
    } else if (e.method === 8) {
      out = inflateGuarded(e.name, data, budget);
    } else {
      throw new PptxImportError(`entry '${e.name}' uses unsupported compression method ${e.method}`);
    }
    files.set(e.name, out);
  }
  const { overrides, extensions } = xmlPartsFromContentTypes(files.get("[Content_Types].xml"));
  for (const [name, data] of files) {
    const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    const isXml = ext === "xml" || ext === "rels" || overrides.has(name) || extensions.has(ext);
    if (isXml && hasDoctype(data)) throw new ZipLimitError(`XML part '${name}' contains <!DOCTYPE (DTDs and entities are rejected)`);
  }
  return files;
}
