// Minimal portable tar/zip writers (change: harden-untrusted-content-ingestion,
// task 0.1). System `tar`/`zip` cannot reliably emit `..`, absolute, link or
// control-char entries, so we craft the bytes ourselves.
import { crc32, gzipSync } from "node:zlib";

export interface Entry {
  name: string;
  data?: string | Buffer;
  /** regular (default) | symlink | hardlink | dir */
  type?: "file" | "symlink" | "hardlink" | "dir";
  /** link target for symlink/hardlink */
  target?: string;
}

function octal(n: number, width: number): string {
  return `${n.toString(8).padStart(width - 1, "0")}\0`;
}

/** ustar archive (uncompressed). Names >100 bytes use the `prefix` field when possible. */
export function tar(entries: Entry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const body = Buffer.from(e.data ?? "");
    const type = e.type ?? "file";
    const typeflag = { file: "0", symlink: "2", hardlink: "1", dir: "5" }[type];
    const h = Buffer.alloc(512);
    const nameBuf = Buffer.from(e.name);
    if (nameBuf.length > 100) throw new Error("fixture name too long");
    nameBuf.copy(h, 0);
    h.write(octal(type === "dir" ? 0o755 : 0o644, 8), 100);
    h.write(octal(0, 8), 108);
    h.write(octal(0, 8), 116);
    const size = type === "file" ? body.length : 0;
    h.write(octal(size, 12), 124);
    h.write(octal(0, 12), 136);
    h.write("        ", 148); // checksum placeholder
    h.write(typeflag, 156);
    if (e.target) Buffer.from(e.target).copy(h, 157);
    h.write("ustar\0", 257);
    h.write("00", 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(h);
    if (size > 0) {
      blocks.push(body, Buffer.alloc((512 - (size % 512)) % 512));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

export const tarGz = (entries: Entry[]): Buffer => gzipSync(tar(entries));

/** Zip archive, stored (no compression). Symlinks carry unix mode 0120777 in external attrs. */
export function zip(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const type = e.type ?? "file";
    const name = Buffer.from(e.name);
    const data = Buffer.from(type === "symlink" ? (e.target ?? "") : type === "dir" ? "" : (e.data ?? ""));
    const crc = type === "dir" ? 0 : crc32(data);
    const lf = Buffer.alloc(30);
    lf.writeUInt32LE(0x04034b50, 0);
    lf.writeUInt16LE(20, 4); // version needed
    lf.writeUInt16LE(0x0800, 6); // UTF-8 names
    lf.writeUInt16LE(0, 8); // stored
    lf.writeUInt32LE(crc >>> 0, 14);
    lf.writeUInt32LE(data.length, 18);
    lf.writeUInt32LE(data.length, 22);
    lf.writeUInt16LE(name.length, 26);
    parts.push(lf, name, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE((3 << 8) | 20, 4); // made by: unix
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt32LE(crc >>> 0, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    const mode = type === "symlink" ? 0o120777 : type === "dir" ? 0o040755 : 0o100644;
    cd.writeUInt32LE((mode << 16) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += lf.length + name.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}
