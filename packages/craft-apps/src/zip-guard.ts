/**
 * Zip-native list guard and JS extraction for web-build archives (`<app>-web-<ver>.zip`).
 *
 * `tar -tvf` cannot read a zip on GNU tar hosts and `fflate` exposes no external attributes, so `yauzl`
 * reads the central directory: absolute/`..` names, symlink or other non-regular entries, encrypted
 * entries, more than 2,000 entries and more than 512 MB uncompressed all abort BEFORE anything is
 * extracted. Extraction is pure JS (no `tar`/`ditto`), confined to the destination, and size-checked
 * against the header (`yauzl` `validateEntrySizes`). Callers still run `assertTreeSafe` afterwards.
 *
 * See change: edit-office-in-pane-with-craft-web (design D2).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Entry, ZipFile } from "yauzl";

export const ZIP_MAX_ENTRIES = 2000;
export const ZIP_MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

export class ZipGuardError extends Error {
  override name = "ZipGuardError";
}

export interface ZipLimits {
  maxEntries?: number;
  maxUncompressedBytes?: number;
}

export interface ZipEntryInfo {
  name: string;
  isDirectory: boolean;
  uncompressedSize: number;
}

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const UNIX_HOST = 3;

async function openZip(archive: string): Promise<ZipFile> {
  const yauzl = await import("yauzl");
  return new Promise((resolve, reject) => {
    yauzl.open(archive, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) reject(new ZipGuardError(`not a readable zip archive: ${err?.message ?? "unknown error"}`));
      else resolve(zip);
    });
  });
}

function checkEntry(entry: Entry): ZipEntryInfo {
  const name = entry.fileName;
  const segments = name.split(/[\\/]/);
  if (name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/.test(name) || segments.includes("..")) {
    throw new ZipGuardError(`zip entry "${name}" escapes the install directory; refusing to extract`);
  }
  if (name.includes("\0")) throw new ZipGuardError("zip entry name contains a NUL byte; refusing to extract");
  if (entry.isEncrypted()) throw new ZipGuardError(`zip entry "${name}" is encrypted; refusing to extract`);
  const isDirectory = name.endsWith("/");
  // External attributes carry a Unix mode in the high 16 bits only when the archive was made on a Unix host.
  if (entry.versionMadeBy >>> 8 === UNIX_HOST) {
    const type = (entry.externalFileAttributes >>> 16) & S_IFMT;
    if (type !== 0 && type !== S_IFREG && type !== S_IFDIR) {
      throw new ZipGuardError(`zip entry "${name}" is not a regular file or directory (mode type ${type.toString(8)}); refusing to extract`);
    }
    if (type === S_IFDIR && !isDirectory) throw new ZipGuardError(`zip entry "${name}" is a directory without a trailing slash; refusing to extract`);
  }
  return { name, isDirectory, uncompressedSize: entry.uncompressedSize };
}

/** Walk the central directory, applying every guard. Reads no entry data. */
export async function listZip(archive: string, limits: ZipLimits = {}): Promise<ZipEntryInfo[]> {
  const maxEntries = limits.maxEntries ?? ZIP_MAX_ENTRIES;
  const maxBytes = limits.maxUncompressedBytes ?? ZIP_MAX_UNCOMPRESSED_BYTES;
  const zip = await openZip(archive);
  try {
    if (zip.entryCount > maxEntries) throw new ZipGuardError(`zip has ${zip.entryCount} entries (limit ${maxEntries}); refusing to extract`);
    const out: ZipEntryInfo[] = [];
    const seen = new Set<string>();
    let total = 0;
    await new Promise<void>((resolve, reject) => {
      zip.on("error", (e) => reject(new ZipGuardError(`zip listing failed: ${e.message}`)));
      zip.on("end", () => resolve());
      zip.on("entry", (entry: Entry) => {
        try {
          const info = checkEntry(entry);
          if (seen.has(info.name)) throw new ZipGuardError(`zip has a duplicate entry "${info.name}"; refusing to extract`);
          seen.add(info.name);
          total += info.uncompressedSize;
          if (total > maxBytes) throw new ZipGuardError(`zip uncompressed size exceeds ${maxBytes} bytes; refusing to extract`);
          out.push(info);
          zip.readEntry();
        } catch (e) {
          reject(e);
        }
      });
      zip.readEntry();
    });
    return out;
  } finally {
    zip.close();
  }
}

/** Extract `archive` into `dest` (must exist). Re-applies the guards, so it is safe without a prior `listZip`. */
export async function extractZip(archive: string, dest: string, limits: ZipLimits = {}): Promise<void> {
  await listZip(archive, limits);
  const root = path.resolve(dest);
  const zip = await openZip(archive);
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on("error", (e) => reject(new ZipGuardError(`zip extraction failed: ${e.message}`)));
      zip.on("end", () => resolve());
      zip.on("entry", (entry: Entry) => {
        void (async () => {
          const target = path.resolve(root, entry.fileName);
          if (target !== root && !target.startsWith(root + path.sep)) {
            throw new ZipGuardError(`zip entry "${entry.fileName}" escapes the install directory; refusing to extract`);
          }
          if (entry.fileName.endsWith("/")) {
            fs.mkdirSync(target, { recursive: true });
          } else {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            const stream = await new Promise<NodeJS.ReadableStream>((res, rej) =>
              zip.openReadStream(entry, (err, s) => (err || !s ? rej(err ?? new Error("no stream")) : res(s))),
            );
            await pipeline(stream, fs.createWriteStream(target, { mode: 0o644, flags: "wx" }));
          }
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}
