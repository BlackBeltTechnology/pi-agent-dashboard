/**
 * Runtime provisioning: pin, cache root, tar guard, download bounds, verification, atomic commit, override,
 * repair and reporting. E10/E12 (real pinned tarball / real boot) live in the real-runtime suites.
 *
 * See change: add-blender-wasm-mcp (test-plan E1–E9, E11, E13–E18, X1–X3).
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARCHIVE_ALLOWLIST,
  PIN,
  type PinSpec,
  parseSri,
  REQUIRED_FILES,
  readStamp,
  resolveCacheRoot,
  STAMP_NAME,
} from "../pin.js";
import {
  commitTree,
  defaultDeps,
  type ProvisionDeps,
  ProvisionError,
  type ProvisionResult,
  provision,
  repairAfterBootFailure,
  singleFlight,
  sweepStaleStaging,
} from "../provision.js";
import { cacheStatus, dirBytes, failureReport, provisionReport } from "../report.js";
import { extractAllowlisted, listTar, MAX_ENTRIES } from "../tar.js";
import {
  buildTar,
  FIXTURE_LICENCE,
  gnuLongName,
  gzipTar,
  makeRuntimeFixture,
  paxHeader,
  pinFor,
  sha256Hex,
  tarDir,
  tarEntry,
  tarFile,
  tarSymlink,
} from "./helpers/tar-fixtures.js";

// ── Harness ─────────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];
const tmp = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "blender-prov-"));
  tmpDirs.push(d);
  return d;
};

afterEach(() => {
  vi.useRealTimers();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function setup(fx = makeRuntimeFixture()) {
  const home = tmp();
  const root = path.join(home, "cache");
  const fetchSpy = vi.fn<typeof fetch>(async () => new Response(fx.tgz));
  const deps = (extra: Partial<ProvisionDeps> = {}): Partial<ProvisionDeps> => ({
    env: { BLENDER_WASM_HOME: root },
    homedir: () => home,
    fetch: fetchSpy,
    pin: fx.pin,
    log: () => {},
    ...extra,
  });
  return { fx, home, root, versionDir: path.join(root, fx.pin.version), fetchSpy, deps };
}

function listAll(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listAll(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

const stagingDirs = (root: string): string[] => fs.readdirSync(root).filter((n) => n.startsWith(".staging-"));

/** A valid override layout (no stamp). */
function writeLayout(dir: string, opts: { license?: string | null; omit?: string[] } = {}): string {
  const pkg: Record<string, unknown> = { name: "layout", version: "1.2.3", type: "module" };
  if (opts.license !== null) pkg.license = opts.license ?? "MIT";
  for (const rel of REQUIRED_FILES) {
    if (opts.omit?.includes(rel)) continue;
    const file = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rel === "package.json" ? JSON.stringify(pkg) : `// ${rel}\n`);
  }
  return dir;
}

const noFetch = vi.fn<typeof fetch>(async () => {
  throw new Error("network must not be used");
});

const rejectsWith = async (p: Promise<unknown>, code: string): Promise<ProvisionError> => {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ProvisionError);
  expect((err as ProvisionError).code).toBe(code);
  return err as ProvisionError;
};

// ── 2.1 pin, SRI, cache root, layout ────────────────────────────────────────

describe("pin (2.1)", () => {
  it("default pin constants are the reviewed identity and the default dep", () => {
    expect(PIN).toEqual({
      name: "@knervous/blender-web",
      version: "0.0.5",
      bytes: 66057129,
      integrity: "sha512-2zvq0fCeoqEe7usry4k7hwgD7xc7gWHvzNq29vnk0VXL6PEaa+CoSiA95by1Z5P7BHwJUYtyXGHaY/j+4rv+rg==",
      tarball: "https://registry.npmjs.org/@knervous/blender-web/-/blender-web-0.0.5.tgz",
    });
    expect(defaultDeps().pin).toBe(PIN);
    expect(defaultDeps().totalTimeoutMs).toBe(600_000);
    expect(defaultDeps().stallTimeoutMs).toBe(60_000);
  });

  it("parseSri decodes sha512 and rejects anything else", () => {
    const { algorithm, digestHex } = parseSri(PIN.integrity);
    expect(algorithm).toBe("sha512");
    expect(digestHex).toMatch(/^[0-9a-f]{128}$/);
    expect(Buffer.from(digestHex, "hex").toString("base64")).toBe(PIN.integrity.slice("sha512-".length));
    for (const bad of ["", "sha1-abc", "sha512-", "sha512-!!!", "sha512-AAAA", `${PIN.integrity} extra`, PIN.integrity.replace("sha512-", "sha256-")]) {
      expect(() => parseSri(bad), bad).toThrow(ProvisionError);
    }
  });

  it("REQUIRED_FILES is the ordered D3 list", () => {
    expect([...REQUIRED_FILES]).toEqual([
      "package.json",
      "runtime/manifest.json",
      "runtime/session-worker.js",
      "runtime/st/blender.js",
      "runtime/st/blender.wasm",
      "runtime/st/blender.data",
      "runtime/st/manifest.json",
      "dist/browser/index.js",
      "dist/browser/brotli.js",
      "dist/project/protocol.generated.js",
    ]);
  });

  it("ARCHIVE_ALLOWLIST maps the allowlisted subset and nothing else", () => {
    const allowed: [string, string][] = [
      ["package/dist/browser/index.js", "dist/browser/index.js"],
      ["package/dist/browser/brotli.js", "dist/browser/brotli.js"],
      ["package/dist/project/protocol.generated.js", "dist/project/protocol.generated.js"],
      ["package/dist/project/project.js", "dist/project/project.js"],
      ["package/dist/project/protocol.py", "dist/project/protocol.py"],
      ["package/runtime/session-worker.js", "runtime/session-worker.js"],
      ["package/runtime/st/blender.js", "runtime/st/blender.js"],
      ["package/runtime/st/blender.wasm.br", "runtime/st/blender.wasm.br"],
      ["package/runtime/st/blender.data.br", "runtime/st/blender.data.br"],
      ["package/runtime/st/manifest.json", "runtime/st/manifest.json"],
      ["package/LICENSE", "LICENSE"],
      ["package/THIRD-PARTY-LICENSES.md", "THIRD-PARTY-LICENSES.md"],
      ["package/package.json", "package.json"],
    ];
    for (const [from, to] of allowed) expect(ARCHIVE_ALLOWLIST(from), from).toBe(to);
    for (const denied of [
      "package/runtime/mt/blender.js",
      "package/runtime/mt/blender.wasm.br",
      "package/runtime/manifest.json",
      "package/runtime/brotli-decode.wasm",
      "package/dist/browser/index.js.map",
      "package/dist/browser/index.d.ts",
      "package/dist/project/protocol.generated.js.map",
      "package/dist/project/protocol.generated.d.ts",
      "package/dist/project/sub/x.js",
      "package/dist/node/index.js",
      "package/README.md",
      "package/bin/blender-web.js",
      "other/package.json",
      "package/dist/browser/index.js/extra",
    ]) {
      expect(ARCHIVE_ALLOWLIST(denied), denied).toBeUndefined();
    }
  });
});

// ── E15 cache root ──────────────────────────────────────────────────────────

describe("cache root (E15)", () => {
  it("PI_CODING_AGENT_DIR without BLENDER_WASM_HOME → <dir>/tools/blender-wasm", () => {
    expect(resolveCacheRoot({ PI_CODING_AGENT_DIR: "/tmp/a" }, () => "/home/x")).toBe(path.join("/tmp/a", "tools", "blender-wasm"));
  });

  it("falls back to <home>/.pi/agent and lets BLENDER_WASM_HOME win (resolved)", () => {
    expect(resolveCacheRoot({}, "/home/x")).toBe(path.join("/home/x", ".pi", "agent", "tools", "blender-wasm"));
    expect(resolveCacheRoot({ BLENDER_WASM_HOME: "rel/cache", PI_CODING_AGENT_DIR: "/tmp/a" }, "/home/x")).toBe(path.resolve("rel/cache"));
  });

  it("a provisioned runtime is committed under $PI_CODING_AGENT_DIR/tools/blender-wasm/<version>/", async () => {
    const s = setup();
    const agent = tmp();
    const r = await provision(s.deps({ env: { PI_CODING_AGENT_DIR: agent } }));
    expect(r.dir).toBe(path.join(agent, "tools", "blender-wasm", s.fx.pin.version));
    expect(fs.existsSync(path.join(r.dir, STAMP_NAME))).toBe(true);
  });
});

// ── Tar guard (E6–E9) ───────────────────────────────────────────────────────

describe("listTar / extractAllowlisted", () => {
  const ok = [tarFile("package/package.json", "{}")];

  it("lists regular files, directories, PAX and GNU long-name entries", async () => {
    const long = `package/${"d".repeat(120)}/file.txt`;
    const tgz = gzipTar([
      tarDir("package"),
      paxHeader({ path: "package/pax-long-name.txt" }),
      tarFile("ignored-short-name", "abc"),
      gnuLongName(long),
      tarFile("short", "hello"),
      paxHeader({ comment: "global" }, true),
      tarFile("package/last", ""),
    ]);
    const entries = await listTar(tgz);
    expect(entries.map((e) => [e.path, e.type, e.size])).toEqual([
      ["package", "directory", 0],
      ["package/pax-long-name.txt", "file", 3],
      [long, "file", 5],
      ["package/last", "file", 0],
    ]);
    expect(entries[1].offset).toBeGreaterThan(entries[0].offset);
  });

  it("reads from a file path as well as a buffer", async () => {
    const file = path.join(tmp(), "a.tgz");
    fs.writeFileSync(file, gzipTar(ok));
    expect((await listTar(file)).map((e) => e.path)).toEqual(["package/package.json"]);
  });

  it("E6: traversal entry → unsafe-archive, nothing written outside (or inside) the dest", async () => {
    const base = tmp();
    const dest = path.join(base, "stage");
    fs.mkdirSync(dest);
    const tgz = gzipTar([tarFile("package/package.json", "{}"), tarFile("package/../evil", "x")]);
    await rejectsWith(listTar(tgz), "unsafe-archive");
    await rejectsWith(extractAllowlisted(tgz, dest, ARCHIVE_ALLOWLIST), "unsafe-archive");
    expect(fs.readdirSync(base)).toEqual(["stage"]);
    expect(fs.readdirSync(dest)).toEqual([]);
  });

  it.each([
    ["absolute path", () => tarFile("/etc/passwd", "x")],
    ["windows drive path", () => tarFile("C:/windows/x", "x")],
    ["backslash traversal", () => tarFile("package\\..\\evil", "x")],
    ["hard link", () => tarEntry({ name: "package/h", type: "1", linkname: "package/package.json" })],
    ["character device", () => tarEntry({ name: "package/c", type: "3" })],
    ["block device", () => tarEntry({ name: "package/b", type: "4" })],
    ["FIFO", () => tarEntry({ name: "package/f", type: "6" })],
  ])("rejects %s", async (_label, make) => {
    await rejectsWith(listTar(gzipTar([...ok, make()])), "unsafe-archive");
  });

  it("E7: symlink entry → unsafe-archive before any file is extracted", async () => {
    const dest = tmp();
    const tgz = gzipTar([tarFile("package/package.json", "{}"), tarSymlink("package/link", "/etc/passwd")]);
    await rejectsWith(extractAllowlisted(tgz, dest, ARCHIVE_ALLOWLIST), "unsafe-archive");
    expect(fs.readdirSync(dest)).toEqual([]);
  });

  it("E7: a traversal path delivered through PAX or GNU long names is rejected too", async () => {
    await rejectsWith(listTar(gzipTar([paxHeader({ path: "package/../../evil" }), tarFile("x", "y")])), "unsafe-archive");
    await rejectsWith(listTar(gzipTar([gnuLongName("/abs/evil"), tarFile("x", "y")])), "unsafe-archive");
  });

  it("E8: PAX header + directories + allowlisted files extract; only allowlisted files are written", async () => {
    const dest = tmp();
    const tgz = gzipTar([
      tarDir("package"),
      tarDir("package/dist"),
      paxHeader({ path: "package/dist/browser/index.js" }),
      tarFile("placeholder", "export const a = 1;"),
      tarFile("package/README.md", "docs"),
      tarFile("package/dist/browser/index.js.map", "{}"),
      tarFile("package/LICENSE", "lic"),
    ]);
    const written = await extractAllowlisted(tgz, dest, ARCHIVE_ALLOWLIST);
    expect(written.sort()).toEqual(["LICENSE", "dist/browser/index.js"]);
    expect(listAll(dest)).toEqual(["LICENSE", "dist/browser/index.js"]);
    expect(fs.readFileSync(path.join(dest, "dist/browser/index.js"), "utf8")).toBe("export const a = 1;");
  });

  it("E9: 500 entries accepted, 501 → unsafe-archive (metadata headers are not counted)", async () => {
    const files = (n: number) => Array.from({ length: n }, (_, i) => tarFile(`package/f${i}`, ""));
    expect(MAX_ENTRIES).toBe(500);
    expect(await listTar(gzipTar(files(500)))).toHaveLength(500);
    expect(await listTar(gzipTar([paxHeader({ comment: "x" }), paxHeader({ comment: "y" }, true), ...files(500)]))).toHaveLength(500);
    const err = await rejectsWith(listTar(gzipTar(files(501))), "unsafe-archive");
    expect(err.message).toMatch(/more than 500/);
    expect(await listTar(gzipTar([...Array.from({ length: 499 }, (_, i) => tarFile(`package/f${i}`, "")), tarDir("package/d")]))).toHaveLength(500);
  });

  it("refuses a destination that resolves outside dest", async () => {
    const dest = path.join(tmp(), "d");
    fs.mkdirSync(dest);
    await rejectsWith(extractAllowlisted(gzipTar(ok), dest, () => "../outside.txt"), "unsafe-archive");
    await rejectsWith(extractAllowlisted(gzipTar(ok), dest, () => path.join(os.tmpdir(), "abs-outside.txt")), "unsafe-archive");
    expect(fs.readdirSync(dest)).toEqual([]);
  });

  it("rejects a corrupt header checksum, truncation and non-gzip input as unsafe-archive", async () => {
    const tar = buildTar(ok);
    const corrupt = Buffer.from(tar);
    corrupt[0] ^= 0xff;
    await rejectsWith(listTar(gzipSync(corrupt)), "unsafe-archive");
    await rejectsWith(listTar(gzipSync(tar.subarray(0, 600))), "unsafe-archive");
    await rejectsWith(listTar(Buffer.from("not a tarball at all")), "unsafe-archive");
  });

  it("streams data larger than one chunk intact", async () => {
    const dest = tmp();
    const big = Buffer.alloc(300_000, 7);
    await extractAllowlisted(gzipTar([tarFile("package/LICENSE", big)]), dest, ARCHIVE_ALLOWLIST);
    expect(fs.readFileSync(path.join(dest, "LICENSE")).equals(big)).toBe(true);
  });
});

// ── Download, integrity, extraction through provision() ─────────────────────

describe("provision: download path", () => {
  it("fresh download commits the expanded runtime and reports it (spec: Fresh download report)", async () => {
    const s = setup();
    const r = await provision(s.deps());
    expect(r).toEqual({ version: "0.0.5", source: "download", dir: s.versionDir, bytes: dirBytes(s.versionDir), licence: FIXTURE_LICENCE });
    expect(stagingDirs(s.root)).toEqual([]);

    const rt = (rel: string) => fs.readFileSync(path.join(s.versionDir, rel));
    expect(rt("runtime/st/blender.wasm").equals(s.fx.raw.wasm)).toBe(true);
    expect(rt("runtime/st/blender.data").equals(s.fx.raw.data)).toBe(true);

    const manifest = JSON.parse(rt("runtime/manifest.json").toString()) as Record<string, unknown>;
    expect(Object.keys(manifest)).toEqual(["forkRevision", "flavors"]);
    expect(manifest.forkRevision).toBe("fixture-rev");
    expect(manifest).not.toHaveProperty("encoding");
    expect(Object.keys(manifest.flavors as object)).toEqual(["st"]);
    expect(JSON.parse(rt("runtime/st/manifest.json").toString())).toEqual((manifest.flavors as { st: unknown }).st);

    const report = provisionReport(r, "native");
    expect(report).toEqual({ version: "0.0.5", source: "download", dir: s.versionDir, bytes: r.bytes, licence: FIXTURE_LICENCE, jspi: "native" });
  });

  it("commits only the st runtime: no pthread flavour, maps, declarations, .br files or docs; stamp lists every file", async () => {
    const s = setup(makeRuntimeFixture({ withMetadata: true }));
    await provision(s.deps());
    expect(listAll(s.versionDir)).toEqual(
      [
        ".blender-wasm.json",
        "LICENSE",
        "THIRD-PARTY-LICENSES.md",
        "dist/browser/brotli.js",
        "dist/browser/index.js",
        "dist/project/project.js",
        "dist/project/protocol.generated.js",
        "dist/project/protocol.py",
        "package.json",
        "runtime/manifest.json",
        "runtime/session-worker.js",
        "runtime/st/blender.data",
        "runtime/st/blender.js",
        "runtime/st/blender.wasm",
        "runtime/st/manifest.json",
      ].sort(),
    );
    const stamp = readStamp(s.versionDir);
    expect(stamp?.version).toBe(s.fx.pin.version);
    expect(stamp?.integrity).toBe(s.fx.pin.integrity);
    expect(Object.keys(stamp?.files ?? {}).sort()).toEqual(listAll(s.versionDir).filter((f) => f !== STAMP_NAME));
    const wasm = stamp?.files["runtime/st/blender.wasm"];
    expect(wasm).toEqual({ bytes: s.fx.raw.wasm.length, sha256: sha256Hex(s.fx.raw.wasm) });
  });

  it("E1: one flipped byte → integrity-mismatch, nothing extracted, no version dir, staging gone", async () => {
    const s = setup();
    const bad = Buffer.from(s.fx.tgz);
    bad[bad.length >> 1] ^= 1;
    expect(bad.length).toBe(s.fx.pin.bytes);
    s.fetchSpy.mockImplementation(async () => new Response(bad));
    await rejectsWith(provision(s.deps()), "integrity-mismatch");
    expect(fs.existsSync(s.versionDir)).toBe(false);
    expect(fs.readdirSync(s.root)).toEqual([]);
  });

  it("E2: exactly one request — a GET of the pinned tarball URL", async () => {
    const s = setup();
    await provision(s.deps());
    expect(s.fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = s.fetchSpy.mock.calls[0];
    expect(url).toBe(s.fx.pin.tarball);
    expect(init?.method).toBe("GET");
  });

  it("E2: with the default pin the request goes to the real registry tarball URL", async () => {
    const home = tmp();
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response("nope", { status: 404 }));
    const err = await rejectsWith(provision({ env: { BLENDER_WASM_HOME: path.join(home, "c") }, fetch: fetchSpy, log: () => {} }), "download-failed");
    expect(err.message).toMatch(/HTTP 404/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://registry.npmjs.org/@knervous/blender-web/-/blender-web-0.0.5.tgz");
  });

  it("HTTP errors and rejected fetches are download-failed with no committed dir", async () => {
    const s = setup();
    s.fetchSpy.mockImplementation(async () => new Response("x", { status: 500 }));
    await rejectsWith(provision(s.deps()), "download-failed");
    s.fetchSpy.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    await rejectsWith(provision(s.deps()), "download-failed");
    expect(fs.existsSync(s.versionDir)).toBe(false);
    expect(stagingDirs(s.root)).toEqual([]);
  });

  it("an archive with a traversal entry fails unsafe-archive through provision()", async () => {
    const tgz = gzipTar([tarFile("package/package.json", "{}"), tarFile("package/../evil", "x")]);
    const s = setup({ tgz, pin: pinFor(tgz), raw: { wasm: Buffer.alloc(0), data: Buffer.alloc(0) } });
    await rejectsWith(provision(s.deps()), "unsafe-archive");
    expect(fs.existsSync(s.versionDir)).toBe(false);
    expect(stagingDirs(s.root)).toEqual([]);
    expect(fs.readdirSync(path.dirname(s.root)).sort()).toEqual(["cache"]);
  });

  it("an archive without runtime/st/manifest.json fails runtime-manifest-mismatch", async () => {
    const tgz = gzipTar([tarFile("package/package.json", "{}")]);
    const s = setup({ tgz, pin: pinFor(tgz), raw: { wasm: Buffer.alloc(0), data: Buffer.alloc(0) } });
    await rejectsWith(provision(s.deps()), "runtime-manifest-mismatch");
    expect(fs.existsSync(s.versionDir)).toBe(false);
  });

  it("E11: expanded blender.data sha256 ≠ manifest raw → runtime-manifest-mismatch, not committed", async () => {
    const s = setup(makeRuntimeFixture({ corruptDataSha: true }));
    const err = await rejectsWith(provision(s.deps()), "runtime-manifest-mismatch");
    expect(err.message).toMatch(/blender\.data/);
    expect(fs.existsSync(s.versionDir)).toBe(false);
    expect(stagingDirs(s.root)).toEqual([]);
  });
});

// ── Bounded download (X1–X3) ────────────────────────────────────────────────

describe("bounded download", () => {
  it("X1: no bytes for >60 s (fake clock) → download-failed, stream cancelled, no committed dir", async () => {
    const s = setup();
    vi.useFakeTimers();
    let cancelled = false;
    let pulls = 0;
    s.fetchSpy.mockImplementation(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(c) {
              if (pulls++ === 0) c.enqueue(new Uint8Array(10));
              else return new Promise<void>(() => undefined);
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    );
    const settled = rejectsWith(provision(s.deps()), "download-failed");
    await vi.advanceTimersByTimeAsync(59_000);
    expect(cancelled).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    const err = await settled;
    expect(err.message).toMatch(/no bytes for 60 s/);
    expect(cancelled).toBe(true);
    expect(fs.existsSync(s.versionDir)).toBe(false);
    expect(stagingDirs(s.root)).toEqual([]);
  });

  it("X1: a stall before the response headers arrive is bounded too", async () => {
    const s = setup();
    vi.useFakeTimers();
    s.fetchSpy.mockImplementation(() => new Promise<Response>(() => undefined));
    const settled = rejectsWith(provision(s.deps()), "download-failed");
    await vi.advanceTimersByTimeAsync(61_000);
    await settled;
    expect(fs.existsSync(s.versionDir)).toBe(false);
  });

  it("X2: pinned bytes + 1 → download-failed and reading stops at pinned size + 1", async () => {
    const s = setup();
    const pin: PinSpec = { ...s.fx.pin, bytes: 100 };
    let pulled = 0;
    let cancelled = false;
    s.fetchSpy.mockImplementation(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(c) {
              pulled++;
              c.enqueue(new Uint8Array(1));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    );
    const err = await rejectsWith(provision(s.deps({ pin })), "download-failed");
    expect(err.message).toMatch(/exceeds the pinned size of 100 bytes/);
    await new Promise((r) => setImmediate(r));
    expect(cancelled).toBe(true);
    expect(pulled).toBeGreaterThanOrEqual(101);
    expect(pulled).toBeLessThanOrEqual(104);
    expect(fs.existsSync(path.join(s.root, pin.version))).toBe(false);
    expect(stagingDirs(s.root)).toEqual([]);
  });

  it("X2: exactly the pinned size is not oversize (reaches the integrity check)", async () => {
    const s = setup();
    const bad = Buffer.alloc(s.fx.pin.bytes, 1);
    s.fetchSpy.mockImplementation(async () => new Response(bad));
    await rejectsWith(provision(s.deps()), "integrity-mismatch");
  });

  it("X2: a declared content-length above the pin fails before reading", async () => {
    const s = setup();
    s.fetchSpy.mockImplementation(async () => new Response(s.fx.tgz, { headers: { "content-length": String(s.fx.pin.bytes + 1) } }));
    const err = await rejectsWith(provision(s.deps()), "download-failed");
    expect(err.message).toMatch(/declares/);
  });

  it("X3: a steady stream that outlives 600 s (fake clock) → download-failed", async () => {
    const s = setup();
    vi.useFakeTimers();
    let cancelled = false;
    s.fetchSpy.mockImplementation(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            async pull(c) {
              await new Promise<void>((r) => setTimeout(r, 30_000));
              if (!cancelled) c.enqueue(new Uint8Array(1));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    );
    const pin: PinSpec = { ...s.fx.pin, bytes: 10_000 };
    const settled = rejectsWith(provision(s.deps({ pin })), "download-failed");
    for (let i = 0; i < 22; i++) await vi.advanceTimersByTimeAsync(30_000);
    const err = await settled;
    expect(err.message).toMatch(/600 s total/);
    expect(cancelled).toBe(true);
    expect(fs.existsSync(path.join(s.root, pin.version))).toBe(false);
    expect(stagingDirs(s.root)).toEqual([]);
  });
});

// ── Cache validity (E3–E5) ──────────────────────────────────────────────────

describe("cache validity", () => {
  it("E3: a valid stamped cache is reused with zero network calls (sha256 not rechecked on the hot path)", async () => {
    const s = setup();
    await provision(s.deps());
    s.fetchSpy.mockClear();
    // Same-size corruption must NOT be noticed by the hot path (that is `repairAfterBootFailure`'s job).
    const wasm = path.join(s.versionDir, "runtime/st/blender.wasm");
    const buf = fs.readFileSync(wasm);
    buf[0] ^= 1;
    fs.writeFileSync(wasm, buf);
    const r = await provision(s.deps({ fetch: noFetch }));
    expect(r.source).toBe("cache");
    expect(r.dir).toBe(s.versionDir);
    expect(r.licence).toBe(FIXTURE_LICENCE);
    expect(s.fetchSpy).not.toHaveBeenCalled();
    expect(noFetch).not.toHaveBeenCalled();
  });

  it("E4: blender.wasm one byte short → cache invalid, downloaded again", async () => {
    const s = setup();
    await provision(s.deps());
    const wasm = path.join(s.versionDir, "runtime/st/blender.wasm");
    fs.truncateSync(wasm, s.fx.raw.wasm.length - 1);
    const r = await provision(s.deps());
    expect(r.source).toBe("download");
    expect(s.fetchSpy).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(wasm).equals(s.fx.raw.wasm)).toBe(true);
  });

  it("E5: dist/browser/index.js missing → cache invalid, re-provisioned", async () => {
    const s = setup();
    await provision(s.deps());
    fs.rmSync(path.join(s.versionDir, "dist/browser/index.js"));
    const r = await provision(s.deps());
    expect(r.source).toBe("download");
    expect(fs.existsSync(path.join(s.versionDir, "dist/browser/index.js"))).toBe(true);
  });

  it("a stamp for a different integrity is not valid", async () => {
    const s = setup();
    await provision(s.deps());
    const stampFile = path.join(s.versionDir, STAMP_NAME);
    const stamp = JSON.parse(fs.readFileSync(stampFile, "utf8")) as { integrity: string };
    stamp.integrity = "sha512-other";
    fs.writeFileSync(stampFile, JSON.stringify(stamp));
    expect((await provision(s.deps())).source).toBe("download");
  });

  it("a directory without a stamp (interrupted copy) is replaced", async () => {
    const s = setup();
    writeLayout(s.versionDir);
    expect((await provision(s.deps())).source).toBe("download");
    expect(fs.existsSync(path.join(s.versionDir, STAMP_NAME))).toBe(true);
  });
});

// ── Atomic commit (E13, E14) ────────────────────────────────────────────────

describe("atomic commit", () => {
  it("E14: a >1 h-old staging dir is swept before the download; a fresh one is kept; no version dir pre-commit", async () => {
    const s = setup();
    fs.mkdirSync(path.join(s.root, ".staging-123-x"), { recursive: true });
    fs.writeFileSync(path.join(s.root, ".staging-123-x", "partial.tgz"), "partial");
    fs.mkdirSync(path.join(s.root, ".staging-999-fresh"));
    const old = (Date.now() - 61 * 60_000) / 1000;
    fs.utimesSync(path.join(s.root, ".staging-123-x"), old, old);
    const seen: { stale: boolean; fresh: boolean; versionDir: boolean }[] = [];
    s.fetchSpy.mockImplementation(async () => {
      seen.push({
        stale: fs.existsSync(path.join(s.root, ".staging-123-x")),
        fresh: fs.existsSync(path.join(s.root, ".staging-999-fresh")),
        versionDir: fs.existsSync(s.versionDir),
      });
      return new Response(s.fx.tgz);
    });
    await provision(s.deps());
    expect(seen).toEqual([{ stale: false, fresh: true, versionDir: false }]);
    expect(stagingDirs(s.root)).toEqual([".staging-999-fresh"]);
  });

  it("sweepStaleStaging only touches `.staging-*` older than 1 h", () => {
    const root = tmp();
    for (const n of [".staging-1-old", "0.0.5", "keep.txt"]) fs.mkdirSync(path.join(root, n));
    const old = (Date.now() - 2 * 3600_000) / 1000;
    for (const n of [".staging-1-old", "0.0.5"]) fs.utimesSync(path.join(root, n), old, old);
    sweepStaleStaging(root, Date.now());
    expect(fs.readdirSync(root).sort()).toEqual(["0.0.5", "keep.txt"]);
    expect(() => sweepStaleStaging(path.join(root, "missing"), Date.now())).not.toThrow();
  });

  it("concurrent in-process callers share one download (singleFlight)", async () => {
    const s = setup();
    const [a, b] = await Promise.all([provision(s.deps()), provision(s.deps())]);
    expect(s.fetchSpy).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    let runs = 0;
    const run = () => singleFlight("k", async () => ++runs);
    expect(await Promise.all([run(), run()])).toEqual([1, 1]);
    expect(await run()).toBe(2);
  });

  it("commitTree reuses a valid winner, rethrows for an invalid one", () => {
    const base = tmp();
    const mk = (name: string) => {
      const d = path.join(base, name);
      fs.mkdirSync(d);
      fs.writeFileSync(path.join(d, "f"), name);
      return d;
    };
    const winner = mk("final");
    expect(commitTree(mk("t1"), winner, () => true)).toBe(true);
    expect(() => commitTree(mk("t2"), winner, () => false)).toThrow();
    expect(commitTree(mk("t3"), path.join(base, "fresh"), () => false)).toBe(false);
    expect(fs.readFileSync(path.join(base, "fresh", "f"), "utf8")).toBe("t3");
  });

  it("E13: two processes provisioning at once end on the same dir, both succeed, no staging left", async () => {
    const s = setup();
    fs.mkdirSync(s.root, { recursive: true });
    const tgzPath = path.join(tmp(), "fixture.tgz");
    fs.writeFileSync(tgzPath, s.fx.tgz);
    const barrier = tmp();
    const child = fileURLToPath(new URL("./helpers/provision-child.ts", import.meta.url));
    const run = () =>
      new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
        const p = spawn(
          process.execPath,
          ["--import", createRequire(import.meta.url).resolve("tsx"), child, tgzPath, JSON.stringify(s.fx.pin), s.root, barrier, "2"],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        let out = "";
        let err = "";
        p.stdout.on("data", (d) => (out += d));
        p.stderr.on("data", (d) => (err += d));
        p.on("close", (code) => resolve({ code, out, err }));
      });
    const [a, b] = await Promise.all([run(), run()]);
    expect(a.err).toBe("");
    expect(b.err).toBe("");
    expect([a.code, b.code]).toEqual([0, 0]);
    const ra = JSON.parse(a.out) as ProvisionResult;
    const rb = JSON.parse(b.out) as ProvisionResult;
    expect(ra.dir).toBe(s.versionDir);
    expect(rb.dir).toBe(s.versionDir);
    expect([ra.source, rb.source].sort()).toEqual(["cache", "download"]);
    expect(stagingDirs(s.root)).toEqual([]);
    expect((await provision(s.deps({ fetch: noFetch }))).source).toBe("cache");
  }, 60_000);
});

// ── Override (E16–E18) ──────────────────────────────────────────────────────

describe("BLENDER_WASM_DIR override", () => {
  it("E16: a valid layout is used as-is: source override, no network, no cache root created", async () => {
    const s = setup();
    const dir = writeLayout(path.join(tmp(), "rt"), { license: "GPL-3.0-or-later" });
    const r = await provision(s.deps({ env: { BLENDER_WASM_DIR: dir, BLENDER_WASM_HOME: s.root }, fetch: noFetch }));
    expect(r).toEqual({ version: "1.2.3", source: "override", dir, bytes: dirBytes(dir), licence: "GPL-3.0-or-later" });
    expect(noFetch).not.toHaveBeenCalled();
    expect(fs.existsSync(s.root)).toBe(false);
    expect(listAll(dir)).toHaveLength(REQUIRED_FILES.length);
  });

  it.each(REQUIRED_FILES.map((f) => [f]))("E17: missing %s → override-invalid naming it", async (missing) => {
    const dir = writeLayout(path.join(tmp(), "rt"), { omit: [missing] });
    const err = await rejectsWith(provision({ env: { BLENDER_WASM_DIR: dir }, fetch: noFetch, log: () => {} }), "override-invalid");
    expect(err.message).toContain(missing);
    expect(listAll(dir)).toHaveLength(REQUIRED_FILES.length - 1);
  });

  it("E17: with several files missing the first in list order is named; a missing dir names package.json", async () => {
    const dir = writeLayout(path.join(tmp(), "rt"), { omit: ["runtime/st/blender.data", "runtime/session-worker.js", "dist/browser/brotli.js"] });
    const err = await rejectsWith(provision({ env: { BLENDER_WASM_DIR: dir }, log: () => {} }), "override-invalid");
    expect(err.message).toContain("runtime/session-worker.js");
    expect(err.message).not.toContain("blender.data");
    const gone = await rejectsWith(provision({ env: { BLENDER_WASM_DIR: path.join(tmp(), "nope") }, log: () => {} }), "override-invalid");
    expect(gone.message).toContain("package.json");
  });

  it("E18: no license field → licence unknown, report source override", async () => {
    const dir = writeLayout(path.join(tmp(), "rt"), { license: null });
    const r = await provision({ env: { BLENDER_WASM_DIR: dir }, fetch: noFetch, log: () => {} });
    expect(r.licence).toBe("unknown");
    expect(provisionReport(r, "flag")).toEqual({ version: "1.2.3", source: "override", dir, bytes: dirBytes(dir), licence: "unknown", jspi: "flag" });
  });

  it("an empty BLENDER_WASM_DIR is ignored (managed provisioning)", async () => {
    const s = setup();
    expect((await provision(s.deps({ env: { BLENDER_WASM_DIR: "", BLENDER_WASM_HOME: s.root } }))).source).toBe("download");
  });
});

// ── Repair ──────────────────────────────────────────────────────────────────

describe("repairAfterBootFailure", () => {
  it("leaves an intact copy alone, returns false", async () => {
    const s = setup();
    await provision(s.deps());
    expect(await repairAfterBootFailure(s.fx.pin.version, s.deps())).toBe(false);
    expect(fs.existsSync(s.versionDir)).toBe(true);
  });

  it("deletes the dir on a same-size content mismatch in ANY stamped file, then re-provisions", async () => {
    for (const rel of ["runtime/st/blender.data", "dist/browser/brotli.js", "package.json"]) {
      const s = setup();
      await provision(s.deps());
      const file = path.join(s.versionDir, rel);
      const buf = fs.readFileSync(file);
      buf[buf.length - 1] ^= 1;
      fs.writeFileSync(file, buf);
      expect(await repairAfterBootFailure(s.fx.pin.version, s.deps()), rel).toBe(true);
      expect(fs.existsSync(s.versionDir)).toBe(false);
      expect((await provision(s.deps())).source).toBe("download");
    }
  });

  it("deletes on a missing or resized stamped file or a missing stamp", async () => {
    const s = setup();
    await provision(s.deps());
    fs.rmSync(path.join(s.versionDir, "LICENSE"));
    expect(await repairAfterBootFailure(s.fx.pin.version, s.deps())).toBe(true);
    await provision(s.deps());
    fs.appendFileSync(path.join(s.versionDir, "runtime/st/blender.wasm"), "x");
    expect(await repairAfterBootFailure(s.fx.pin.version, s.deps())).toBe(true);
    await provision(s.deps());
    fs.rmSync(path.join(s.versionDir, STAMP_NAME));
    expect(await repairAfterBootFailure(s.fx.pin.version, s.deps())).toBe(true);
    expect(fs.existsSync(s.versionDir)).toBe(false);
  });

  it("is a no-op for a missing dir, an unsafe version and the override source", async () => {
    const s = setup();
    expect(await repairAfterBootFailure("0.0.5", s.deps())).toBe(false);
    expect(await repairAfterBootFailure("../escape", s.deps())).toBe(false);
    fs.mkdirSync(s.versionDir, { recursive: true });
    fs.writeFileSync(path.join(s.versionDir, "garbage"), "x");
    const override = writeLayout(path.join(tmp(), "rt"));
    expect(await repairAfterBootFailure("0.0.5", s.deps({ env: { BLENDER_WASM_HOME: s.root, BLENDER_WASM_DIR: override } }))).toBe(false);
    expect(fs.existsSync(path.join(s.versionDir, "garbage"))).toBe(true);
    expect(listAll(override)).toHaveLength(REQUIRED_FILES.length);
  });
});

// ── Reports ─────────────────────────────────────────────────────────────────

describe("reports", () => {
  it("failureReport maps ProvisionError codes and wraps anything else", () => {
    expect(failureReport(new ProvisionError("integrity-mismatch", "bad"))).toEqual({ code: "integrity-mismatch", message: "bad" });
    expect(failureReport(new Error("boom"))).toEqual({ code: "provision-failed", message: "boom" });
    expect(failureReport("str")).toEqual({ code: "provision-failed", message: "str" });
  });

  it("cacheStatus lists cached versions with bytes and never downloads", async () => {
    const s = setup();
    const empty = cacheStatus({ env: { BLENDER_WASM_HOME: s.root }, pin: s.fx.pin });
    expect(empty).toEqual({ pinned: { version: "0.0.5", cached: false, dir: s.versionDir }, root: s.root, source: "managed", versions: [], licence: "unknown" });
    expect(fs.existsSync(s.root)).toBe(false);

    await provision(s.deps());
    fs.mkdirSync(path.join(s.root, "0.0.1"));
    const status = cacheStatus({ env: { BLENDER_WASM_HOME: s.root }, pin: s.fx.pin });
    expect(status.pinned).toEqual({ version: "0.0.5", cached: true, dir: s.versionDir });
    expect(status.versions).toEqual([{ version: "0.0.5", bytes: dirBytes(s.versionDir), dir: s.versionDir }]);
    expect(status.licence).toBe(FIXTURE_LICENCE);
    expect(status.source).toBe("managed");
  });

  it("cacheStatus reports the override source and its licence", () => {
    const dir = writeLayout(path.join(tmp(), "rt"), { license: "MIT" });
    const status = cacheStatus({ env: { BLENDER_WASM_DIR: dir, BLENDER_WASM_HOME: path.join(tmp(), "c") } });
    expect(status.source).toBe("override");
    expect(status.licence).toBe("MIT");
    expect(status.pinned.version).toBe(PIN.version);
  });
});
