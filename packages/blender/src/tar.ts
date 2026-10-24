/**
 * Streaming gunzip + tar reader that lists every entry before anything is extracted.
 *
 * Accepts regular files, directories and PAX/GNU metadata headers (`x`, `g`, `L`, `K`); aborts with
 * `ProvisionError("unsafe-archive")` on absolute paths, `..` segments, symlinks, hardlinks,
 * device/FIFO entries or more than {@link MAX_ENTRIES} entries. `extractAllowlisted` re-lists first, then
 * streams the archive a second time and writes only the allowlisted files (never outside `dest`).
 * The gunzipped tar is never held in memory; only 64 KiB chunks and metadata headers are.
 *
 * See change: add-blender-wasm-mcp (design D3 step 2–3, task 2.2).
 */
import { createReadStream } from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { createGunzip } from "node:zlib";
import { ProvisionError } from "./pin.js";

export const MAX_ENTRIES = 500;
const BLOCK = 512;
/** Metadata headers (PAX/GNU long name) larger than this are refused. */
const MAX_META_BYTES = 1024 * 1024;

export type TarEntryType = "file" | "directory";

export interface TarEntry {
  /** Archive path (directories without the trailing slash). */
  path: string;
  type: TarEntryType;
  size: number;
  /** Offset of the entry's data in the gunzipped tar stream. */
  offset: number;
}

export type TarSource = string | Buffer;

/** Receives the data of one entry; `abort` runs when the walk fails mid-entry. */
export interface TarSink {
  write(chunk: Buffer): Promise<void>;
  end(): Promise<void>;
  abort(): Promise<void>;
}

/** Maps an archive path to its destination path (relative to the extraction dir), or `undefined` to skip. */
export type AllowFn = (archivePath: string) => string | undefined;

const unsafe = (message: string): ProvisionError => new ProvisionError("unsafe-archive", message);

// ── Chunk reader ────────────────────────────────────────────────────────────

class TarReader {
  /** Bytes consumed from the gunzipped stream so far. */
  position = 0;
  private readonly iter: AsyncIterator<Buffer>;
  private buf: Buffer = Buffer.alloc(0);
  private done = false;

  constructor(iter: AsyncIterator<Buffer>) {
    this.iter = iter;
  }

  private async fill(min: number): Promise<void> {
    while (this.buf.length < min && !this.done) {
      let r: IteratorResult<Buffer>;
      try {
        r = await this.iter.next();
      } catch (e) {
        throw unsafe(`archive is not a valid gzip tar: ${(e as Error).message}`);
      }
      if (r.done) this.done = true;
      else this.buf = this.buf.length > 0 ? Buffer.concat([this.buf, r.value]) : r.value;
    }
  }

  /** Exactly `n` bytes; `undefined` when the stream ended cleanly before the first byte. */
  async readExact(n: number): Promise<Buffer | undefined> {
    await this.fill(n);
    if (this.buf.length === 0) return undefined;
    if (this.buf.length < n) throw unsafe("truncated tar archive");
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    this.position += n;
    return out;
  }

  /** Stream the next `n` bytes into `sink` (or drop them). */
  async consume(n: number, sink?: TarSink): Promise<void> {
    let remaining = n;
    while (remaining > 0) {
      if (this.buf.length === 0) await this.fill(1);
      if (this.buf.length === 0) throw unsafe("truncated tar archive");
      const take = Math.min(this.buf.length, remaining);
      const chunk = this.buf.subarray(0, take);
      this.buf = this.buf.subarray(take);
      this.position += take;
      remaining -= take;
      if (sink) await sink.write(chunk);
    }
  }
}

// ── Header parsing ──────────────────────────────────────────────────────────

interface RawHeader {
  name: string;
  size: number;
  type: string;
}

const cstr = (b: Buffer, start: number, len: number): string => {
  const slice = b.subarray(start, start + len);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul < 0 ? len : nul).toString("utf8");
};

function parseSize(field: Buffer): number {
  if (field[0] & 0x80) {
    // GNU base-256: big-endian, first byte's high bit is the marker.
    let n = field[0] & 0x7f;
    for (let i = 1; i < field.length; i++) n = n * 256 + field[i];
    if (!Number.isSafeInteger(n)) throw unsafe("tar entry size out of range");
    return n;
  }
  const text = field.toString("latin1").replace(/[\0 ]+$/g, "").replace(/^ +/, "");
  if (!/^[0-7]*$/.test(text)) throw unsafe("corrupt tar header (size)");
  return text === "" ? 0 : Number.parseInt(text, 8);
}

function isZeroBlock(b: Buffer): boolean {
  return b.every((v) => v === 0);
}

function verifyChecksum(b: Buffer): void {
  const stored = Number.parseInt(b.subarray(148, 156).toString("latin1").replace(/[\0 ]+/g, ""), 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : b[i];
  if (!Number.isFinite(stored) || stored !== sum) throw unsafe("corrupt tar header (checksum)");
}

/** `undefined` for the zero block that ends the archive. */
function parseHeader(block: Buffer): RawHeader | undefined {
  if (isZeroBlock(block)) return undefined;
  verifyChecksum(block);
  const ustar = block.subarray(257, 262).toString("latin1") === "ustar";
  const prefix = ustar ? cstr(block, 345, 155) : "";
  const name = cstr(block, 0, 100);
  const typeByte = block[156];
  return {
    name: prefix ? `${prefix}/${name}` : name,
    size: parseSize(block.subarray(124, 136)),
    type: typeByte === 0 ? "0" : String.fromCharCode(typeByte),
  };
}

/** PAX records: `<len> <key>=<value>\n`, length counted in bytes of the whole record. */
function parsePax(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 0;
  while (pos < data.length) {
    const sp = data.indexOf(0x20, pos);
    const len = sp < 0 ? Number.NaN : Number.parseInt(data.subarray(pos, sp).toString("latin1"), 10);
    if (!Number.isInteger(len) || len <= sp - pos + 1 || pos + len > data.length) throw unsafe("corrupt PAX header");
    const record = data.subarray(sp + 1, pos + len - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    pos += len;
  }
  return out;
}

function assertSafePath(name: string): void {
  const segments = name.split(/[\\/]/);
  if (
    name === "" ||
    name.includes("\0") ||
    name.startsWith("/") ||
    name.startsWith("\\") ||
    /^[A-Za-z]:/.test(name) ||
    segments.includes("..")
  ) {
    throw unsafe(`archive entry "${name}" is absolute or escapes the extraction directory; refusing`);
  }
}

const TYPE_NAMES: Record<string, string> = {
  "1": "hard link",
  "2": "symbolic link",
  "3": "character device",
  "4": "block device",
  "6": "FIFO",
};

function entryType(type: string, name: string): TarEntryType {
  if (type === "0" || type === "7") return "file";
  if (type === "5") return "directory";
  throw unsafe(`archive entry "${name}" is a ${TYPE_NAMES[type] ?? `unsupported type "${type}"`}; refusing`);
}

// ── Walk ────────────────────────────────────────────────────────────────────

function openGunzip(source: TarSource): { iterator: AsyncIterator<Buffer>; close: () => void } {
  const gz = createGunzip();
  if (typeof source === "string") {
    const rs = createReadStream(source);
    rs.on("error", (e) => gz.destroy(e));
    rs.pipe(gz);
    return { iterator: gz[Symbol.asyncIterator]() as AsyncIterator<Buffer>, close: () => (rs.destroy(), gz.destroy()) };
  }
  gz.end(source);
  return { iterator: gz[Symbol.asyncIterator]() as AsyncIterator<Buffer>, close: () => gz.destroy() };
}

type Visit = (entry: TarEntry) => Promise<TarSink | undefined> | TarSink | undefined;

interface Pending {
  name?: string;
  size?: number;
}

/** Read a metadata header's data (bounded) and its padding. */
async function readMeta(reader: TarReader, size: number): Promise<Buffer> {
  if (size > MAX_META_BYTES) throw unsafe(`tar metadata header of ${size} bytes is too large; refusing`);
  const padded = Math.ceil(size / BLOCK) * BLOCK;
  const data = padded === 0 ? Buffer.alloc(0) : await reader.readExact(padded);
  if (!data) throw unsafe("truncated tar archive");
  return data.subarray(0, size);
}

async function drain(reader: TarReader, entry: TarEntry, visit: Visit): Promise<void> {
  const sink = await visit(entry);
  try {
    await reader.consume(entry.size, sink);
    await sink?.end();
  } catch (e) {
    await sink?.abort().catch(() => undefined);
    throw e;
  }
  await reader.consume(Math.ceil(entry.size / BLOCK) * BLOCK - entry.size);
}

/** Walk every entry in order, handing real entries to `visit`; returns the validated entry list. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ustar/PAX/GNU header state machine: each branch is one header type or rejection.
async function walkTar(source: TarSource, visit: Visit): Promise<TarEntry[]> {
  const { iterator, close } = openGunzip(source);
  const entries: TarEntry[] = [];
  const pending: Pending = {};
  try {
    const reader = new TarReader(iterator);
    for (;;) {
      const block = await reader.readExact(BLOCK);
      const header = block ? parseHeader(block) : undefined;
      if (!header) break;
      if (header.type === "x" || header.type === "L" || header.type === "K" || header.type === "g") {
        const data = header.type === "g" ? undefined : await readMeta(reader, header.size);
        if (!data) await reader.consume(Math.ceil(header.size / BLOCK) * BLOCK);
        else if (header.type === "L") pending.name = cstr(data, 0, data.length);
        else if (header.type === "x") {
          const rec = parsePax(data);
          if (rec.path !== undefined) pending.name = rec.path;
          if (rec.size !== undefined) pending.size = Number.parseInt(rec.size, 10);
        }
        continue;
      }
      const name = pending.name ?? header.name;
      const size = pending.size ?? header.size;
      pending.name = undefined;
      pending.size = undefined;
      const type = entryType(header.type, name);
      assertSafePath(name);
      if (!Number.isSafeInteger(size) || size < 0) throw unsafe(`archive entry "${name}" has an invalid size`);
      if (entries.length >= MAX_ENTRIES) throw unsafe(`archive has more than ${MAX_ENTRIES} entries; refusing`);
      const entry: TarEntry = { path: name.replace(/\/+$/, ""), type, size, offset: reader.position };
      entries.push(entry);
      await drain(reader, entry, visit);
    }
    return entries;
  } finally {
    close();
  }
}

/** List every entry of a `.tgz` (path or buffer) without extracting; throws `unsafe-archive` per the guard. */
export function listTar(source: TarSource): Promise<TarEntry[]> {
  return walkTar(source, () => undefined);
}

// ── Extraction ──────────────────────────────────────────────────────────────

interface Planned {
  entry: TarEntry;
  target: string;
  rel: string;
}

function planExtraction(entries: TarEntry[], dest: string, allow: AllowFn): Map<number, Planned> {
  const root = path.resolve(dest);
  const plan = new Map<number, Planned>();
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "file") continue;
    const rel = allow(entry.path);
    if (rel === undefined) continue;
    const target = path.resolve(root, rel);
    if (!target.startsWith(root + path.sep)) throw unsafe(`destination "${rel}" for "${entry.path}" resolves outside the extraction directory`);
    if (seen.has(target)) throw unsafe(`archive contains "${entry.path}" more than once; refusing`);
    seen.add(target);
    plan.set(entry.offset, { entry, target, rel });
  }
  return plan;
}

async function openFileSink(target: string): Promise<TarSink> {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const fh = await fsp.open(target, "wx", 0o644);
  return {
    write: async (chunk) => {
      let off = 0;
      while (off < chunk.length) off += (await fh.write(chunk, off, chunk.length - off)).bytesWritten;
    },
    end: () => fh.close(),
    abort: () => fh.close(),
  };
}

/**
 * List the whole archive first (guard), then extract only entries `allow` maps to a destination under
 * `dest`. Returns the destination-relative paths written, in archive order.
 */
export async function extractAllowlisted(source: TarSource, dest: string, allow: AllowFn): Promise<string[]> {
  const entries = await listTar(source);
  const plan = planExtraction(entries, dest, allow);
  const written: string[] = [];
  await walkTar(source, async (entry) => {
    const item = plan.get(entry.offset);
    if (!item || item.entry.path !== entry.path) return undefined;
    written.push(item.rel);
    return openFileSink(item.target);
  });
  return written;
}
