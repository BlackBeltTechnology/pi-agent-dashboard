/**
 * Hand-written ustar/PAX/GNU tar writer and a tiny fixture runtime tarball (with the real pinned layout
 * and a real sha512 pin) for the provisioning tests.
 *
 * See change: add-blender-wasm-mcp (tasks 2.5–2.25).
 */
import { createHash } from "node:crypto";
import { brotliCompressSync, gzipSync } from "node:zlib";
import type { PinSpec } from "../../pin.js";

const BLOCK = 512;

// ── tar writer ──────────────────────────────────────────────────────────────

export interface TarEntryOpts {
  name: string;
  /** ustar typeflag; default `0` (file). */
  type?: string;
  data?: Buffer | string;
  linkname?: string;
}

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function field(buf: Buffer, offset: number, text: string, width: number): void {
  buf.write(text.slice(0, width), offset, "latin1");
}

/** One entry: 512-byte header + data padded to a block boundary. */
export function tarEntry(opts: TarEntryOpts): Buffer {
  const data = typeof opts.data === "string" ? Buffer.from(opts.data) : (opts.data ?? Buffer.alloc(0));
  const header = Buffer.alloc(BLOCK);
  field(header, 0, opts.name, 100);
  field(header, 100, octal(0o644, 8), 8);
  field(header, 108, octal(0, 8), 8);
  field(header, 116, octal(0, 8), 8);
  field(header, 124, octal(data.length, 12), 12);
  field(header, 136, octal(0, 12), 12);
  header.fill(0x20, 148, 156);
  header[156] = (opts.type ?? "0").charCodeAt(0);
  if (opts.linkname) field(header, 157, opts.linkname, 100);
  field(header, 257, "ustar\0", 6);
  field(header, 263, "00", 2);
  let sum = 0;
  for (const b of header) sum += b;
  field(header, 148, `${sum.toString(8).padStart(6, "0")}\0 `, 8);
  const pad = Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK);
  return Buffer.concat([header, data, pad]);
}

export const tarFile = (name: string, data: Buffer | string): Buffer => tarEntry({ name, data });
export const tarDir = (name: string): Buffer => tarEntry({ name: name.endsWith("/") ? name : `${name}/`, type: "5" });
export const tarSymlink = (name: string, target: string): Buffer => tarEntry({ name, type: "2", linkname: target });

/** PAX extended header (`x`) applying to the next entry; `g` makes it global. */
export function paxHeader(records: Record<string, string>, global = false): Buffer {
  const body = Object.entries(records)
    .map(([k, v]) => {
      const rest = ` ${k}=${v}\n`;
      let len = Buffer.byteLength(rest) + 1;
      while (String(len).length + Buffer.byteLength(rest) !== len) len = String(len).length + Buffer.byteLength(rest);
      return `${len}${rest}`;
    })
    .join("");
  return tarEntry({ name: "PaxHeader/x", type: global ? "g" : "x", data: body });
}

/** GNU long-name header (`L`) applying to the next entry. */
export const gnuLongName = (name: string): Buffer => tarEntry({ name: "././@LongLink", type: "L", data: `${name}\0` });

export function buildTar(entries: Buffer[]): Buffer {
  return Buffer.concat([...entries, Buffer.alloc(BLOCK * 2)]);
}

export const gzipTar = (entries: Buffer[]): Buffer => gzipSync(buildTar(entries));

// ── hashing ─────────────────────────────────────────────────────────────────

export const sha256Hex = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
export const sha512Integrity = (b: Buffer): string => `sha512-${createHash("sha512").update(b).digest("base64")}`;

// ── fixture runtime ─────────────────────────────────────────────────────────

export const FIXTURE_LICENCE = "GPL-3.0-or-later";

export interface RuntimeFixtureOptions {
  /** Make `runtime/st/manifest.json`'s raw blender.data sha256 wrong. */
  corruptDataSha?: boolean;
  /** Emit a PAX header (long path override) and directory entries around the files. */
  withMetadata?: boolean;
  /** Extra entries appended before the end-of-archive marker. */
  extra?: Buffer[];
  /** Entries inserted before everything else. */
  prepend?: Buffer[];
  version?: string;
}

export interface RuntimeFixture {
  tgz: Buffer;
  pin: PinSpec;
  /** Expanded runtime files by committed relative path. */
  raw: { wasm: Buffer; data: Buffer };
}

/** Deterministic pseudo-random bytes (compressible enough, never trivially constant). */
export function pseudoBytes(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[i] = (x >>> 24) & 0x3f;
  }
  return out;
}

/** Small tarball with the real archive layout: allowlisted files plus things that must NOT be extracted. */
export function makeRuntimeFixture(opts: RuntimeFixtureOptions = {}): RuntimeFixture {
  const version = opts.version ?? "0.0.5";
  const wasm = pseudoBytes(6000, 11);
  const data = pseudoBytes(9000, 29);
  const stManifest = {
    flavor: "browser-st",
    forkRevision: "fixture-rev",
    files: {},
    raw: {
      "blender.data": { bytes: data.length, sha256: opts.corruptDataSha ? "0".repeat(64) : sha256Hex(data) },
      "blender.wasm": { bytes: wasm.length, sha256: sha256Hex(wasm) },
    },
  };
  const pkg = { name: "@knervous/blender-web", version, type: "module", license: FIXTURE_LICENCE };
  const meta = opts.withMetadata
    ? [tarDir("package"), tarDir("package/runtime"), paxHeader({ path: "package/runtime/session-worker.js", comment: "pax" })]
    : [];
  const sessionWorker = tarFile(meta.length ? "package/runtime/PAX-PLACEHOLDER" : "package/runtime/session-worker.js", "// session worker\n");
  const entries = [
    ...(opts.prepend ?? []),
    ...meta,
    sessionWorker,
    tarFile("package/package.json", JSON.stringify(pkg)),
    tarFile("package/LICENSE", "GPL\n"),
    tarFile("package/THIRD-PARTY-LICENSES.md", "# third party\n"),
    tarFile("package/README.md", "readme"),
    tarFile("package/DESIGN.md", "design"),
    tarFile("package/bin/blender-web.js", "#!/usr/bin/env node\n"),
    tarFile("package/runtime/manifest.json", JSON.stringify({ forkRevision: "x", encoding: "br", flavors: { st: {}, mt: {} } })),
    tarFile("package/runtime/run-worker.js", "// run worker\n"),
    tarFile("package/runtime/brotli-decode.wasm", "wasm"),
    tarFile("package/runtime/st/blender.js", "// blender st\n"),
    tarFile("package/runtime/st/blender.wasm.br", brotliCompressSync(wasm)),
    tarFile("package/runtime/st/blender.data.br", brotliCompressSync(data)),
    tarFile("package/runtime/st/manifest.json", JSON.stringify(stManifest)),
    tarFile("package/runtime/mt/blender.js", "// blender mt\n"),
    tarFile("package/runtime/mt/blender.wasm.br", "mt-wasm"),
    tarFile("package/runtime/mt/blender.data.br", "mt-data"),
    tarFile("package/runtime/mt/manifest.json", "{}"),
    tarFile("package/dist/browser/index.js", "export const index = 1;\n"),
    tarFile("package/dist/browser/index.js.map", "{}"),
    tarFile("package/dist/browser/index.d.ts", "export {};"),
    tarFile("package/dist/browser/brotli.js", "export const brotli = 1;\n"),
    tarFile("package/dist/browser/session-worker.js", "// dist worker\n"),
    tarFile("package/dist/project/protocol.generated.js", "export const protocol = 1;\n"),
    tarFile("package/dist/project/protocol.generated.js.map", "{}"),
    tarFile("package/dist/project/protocol.generated.d.ts", "export {};"),
    tarFile("package/dist/project/project.js", "export const project = 1;\n"),
    tarFile("package/dist/project/protocol.py", "# protocol\n"),
    tarFile("package/dist/node/index.js", "export {};\n"),
    ...(opts.extra ?? []),
  ];
  const tgz = gzipTar(entries);
  const pin: PinSpec = {
    name: "@knervous/blender-web",
    version,
    bytes: tgz.length,
    integrity: sha512Integrity(tgz),
    tarball: `https://registry.example.test/@knervous/blender-web/-/blender-web-${version}.tgz`,
  };
  return { tgz, pin, raw: { wasm, data } };
}

/** Pin for an arbitrary tarball buffer. */
export function pinFor(tgz: Buffer, version = "0.0.5"): PinSpec {
  return {
    name: "@knervous/blender-web",
    version,
    bytes: tgz.length,
    integrity: sha512Integrity(tgz),
    tarball: `https://registry.example.test/blender-web-${version}.tgz`,
  };
}
