/**
 * Minimal ZIP reader for the Windows portable OBS archive (design D9): central
 * directory → stored / deflated entries via `zlib.inflateRawSync`. No
 * dependency. `checkEntries` rejects the WHOLE archive before anything is
 * written when any entry is absolute, contains `..`, or is a symbolic link
 * (unix mode `0o120000` in the external attributes). ZIP64 is not supported
 * (refused). See change: add-obs-studio-plugin.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ObsError } from "./errors.js";

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
  symlink: boolean;
  dir: boolean;
}

function readEntries(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ObsError("refused", "not a zip archive (no end-of-central-directory record)");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (off === 0xffffffff || count === 0xffff) throw new ObsError("refused", "zip64 archives are not supported");
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new ObsError("refused", "corrupt zip central directory");
    const method = buf.readUInt16LE(off + 10);
    const compressedSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const external = buf.readUInt32LE(off + 38);
    const localOffset = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    const unixMode = (external >>> 16) & 0o170000;
    entries.push({ name, method, compressedSize, localOffset, symlink: unixMode === 0o120000, dir: name.endsWith("/") });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Throws on the first unsafe entry. Nothing has been written yet. */
function checkEntries(entries: readonly ZipEntry[]): void {
  for (const e of entries) {
    const n = e.name.replace(/\\/g, "/");
    if (e.symlink) throw new ObsError("refused", `archive entry ${JSON.stringify(e.name)} is a symbolic link; refused`);
    if (n.startsWith("/") || /^[A-Za-z]:/.test(n)) throw new ObsError("refused", `archive entry ${JSON.stringify(e.name)} is an absolute path; refused`);
    if (n.split("/").includes("..")) throw new ObsError("refused", `archive entry ${JSON.stringify(e.name)} contains '..'; refused`);
  }
}

/** Validate every entry, then extract into `dest` (each write re-checked to stay inside). */
export function extractZip(buf: Buffer, dest: string): number {
  const entries = readEntries(buf);
  checkEntries(entries);
  const root = path.resolve(dest);
  let written = 0;
  for (const e of entries) {
    const target = path.resolve(root, e.name.replace(/\\/g, "/"));
    if (target !== root && !target.startsWith(root + path.sep)) throw new ObsError("refused", `archive entry ${JSON.stringify(e.name)} escapes the install directory`);
    if (e.dir) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    const lo = e.localOffset;
    if (buf.readUInt32LE(lo) !== 0x04034b50) throw new ObsError("refused", "corrupt zip local header");
    const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const raw = buf.subarray(start, start + e.compressedSize);
    const data = e.method === 0 ? raw : e.method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) throw new ObsError("refused", `unsupported zip compression method ${e.method}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    written++;
  }
  return written;
}
