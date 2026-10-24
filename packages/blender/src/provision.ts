/**
 * Provision the pinned headless Blender WebAssembly runtime (`@knervous/blender-web`) on demand.
 *
 * Pipeline (design D3): `BLENDER_WASM_DIR` override → valid-cache check (stamp + required files + stamped
 * sizes) → stale-staging sweep → bounded streamed download of the one pinned tarball → sha512 vs pin →
 * list-then-extract the allowlist → brotli-expand wasm/data and verify against the runtime's own `raw`
 * manifest entries → write `runtime/manifest.json` (st only, no `encoding`) → write the stamp last →
 * atomic rename to `<root>/<version>/`. Every external effect is an injectable seam (`ProvisionDeps`).
 * No subprocesses, no dependencies beyond `node:*`.
 *
 * `singleFlight`, `commitTree` and `sweepStaleStaging` are deliberate copies of the craft-apps helpers
 * (extraction into a shared module is an out-of-scope follow-up).
 *
 * See change: add-blender-wasm-mcp (design D3, tasks 2.3).
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress } from "node:zlib";
import {
  ARCHIVE_ALLOWLIST,
  firstMissingRequired,
  isValidCache,
  PIN,
  type PinSpec,
  ProvisionError,
  parseSri,
  readStamp,
  resolveCacheRoot,
  STAMP_NAME,
  type Stamp,
  type StampedFile,
} from "./pin.js";
import { dirBytes, readLicence, readPackageVersion } from "./report.js";
import { extractAllowlisted, listTar } from "./tar.js";

export { ProvisionError, type ProvisionErrorCode } from "./pin.js";

const STALE_STAGING_MS = 60 * 60 * 1000;
const TOTAL_TIMEOUT_MS = 600_000;
const STALL_TIMEOUT_MS = 60_000;

export type ProvisionSource = "cache" | "download" | "override";

export interface ProvisionResult {
  version: string;
  source: ProvisionSource;
  dir: string;
  /** Total on-disk bytes of the runtime directory. */
  bytes: number;
  /** `license` field of the runtime's package.json, else `"unknown"`. */
  licence: string;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface ProvisionDeps {
  env: NodeJS.ProcessEnv;
  homedir: () => string;
  fetch: typeof fetch;
  now: () => number;
  randomId: () => string;
  pid: number;
  /** Timer seam (default resolves the global lazily, so `vi.useFakeTimers` applies). */
  setTimeout: (fn: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
  /** Diagnostics only: stderr in the CLI (stdout may be an MCP channel). */
  log: (message: string) => void;
  /** Pinned runtime identity; unit tests inject small fixtures. */
  pin: PinSpec;
  /** Overall download budget (ms). */
  totalTimeoutMs: number;
  /** Maximum time without received bytes (ms). */
  stallTimeoutMs: number;
}

export function defaultDeps(): ProvisionDeps {
  return {
    env: process.env,
    homedir: () => os.homedir(),
    fetch: (...a) => fetch(...a),
    now: () => Date.now(),
    randomId: () => Math.random().toString(36).slice(2, 10),
    pid: process.pid,
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h),
    log: (m) => process.stderr.write(`${m}\n`),
    pin: PIN,
    totalTimeoutMs: TOTAL_TIMEOUT_MS,
    stallTimeoutMs: STALL_TIMEOUT_MS,
  };
}

// ── Races: single-flight, commit, stale staging ─────────────────────────────

const inflight = new Map<string, Promise<unknown>>();

/** In-process single-flight: concurrent callers with the same `key` share one run (and its result). */
export function singleFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/**
 * Atomically move a finished staging `tree` to `finalDir`. `EEXIST`/`ENOTEMPTY`/`EPERM` means another
 * process won the race: when `verifyExisting` accepts the winner's tree, reuse it (`true`), else rethrow.
 */
export function commitTree(tree: string, finalDir: string, verifyExisting: (dir: string) => boolean): boolean {
  try {
    fs.renameSync(tree, finalDir);
    return false;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ENOTEMPTY" || code === "EPERM") {
      if (!verifyExisting(finalDir)) throw e;
      return true;
    }
    throw e;
  }
}

/** Remove `.staging-*` entries under `root` last modified more than one hour before `now`. */
export function sweepStaleStaging(root: string, now: number): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith(".staging-")) continue;
    const p = path.join(root, name);
    try {
      if (now - fs.statSync(p).mtimeMs > STALE_STAGING_MS) fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* raced with its owner */
    }
  }
}

// ── Hashing ─────────────────────────────────────────────────────────────────

async function hashFile(file: string): Promise<StampedFile> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) {
    const buf = chunk as Buffer;
    bytes += buf.length;
    hash.update(buf);
  }
  return { bytes, sha256: hash.digest("hex") };
}

// ── Download ────────────────────────────────────────────────────────────────

const downloadFailed = (message: string, cause?: unknown): ProvisionError => new ProvisionError("download-failed", message, { cause });

function asDownloadFailed(url: string, e: unknown): ProvisionError {
  if (e instanceof ProvisionError) return e;
  return downloadFailed(`download of ${url} failed: ${e instanceof Error ? e.message : String(e)}`, e);
}

function writeAll(fd: number, chunk: Uint8Array): void {
  let off = 0;
  while (off < chunk.length) off += fs.writeSync(fd, chunk, off, chunk.length - off);
}

/** Total + stall watchdog: `expired` rejects (and `signal` aborts) when either budget is exceeded. */
function startWatchdog(deps: ProvisionDeps): { signal: AbortSignal; expired: Promise<never>; touch: () => void; stop: () => void } {
  const ac = new AbortController();
  let fire!: (e: Error) => void;
  const expired = new Promise<never>((_, reject) => {
    fire = reject;
  });
  expired.catch(() => undefined);
  const expire = (message: string): void => {
    fire(downloadFailed(message));
    ac.abort();
  };
  const total = deps.setTimeout(() => expire(`download exceeded the ${deps.totalTimeoutMs / 1000} s total budget`), deps.totalTimeoutMs);
  const arm = (): TimerHandle => deps.setTimeout(() => expire(`download received no bytes for ${deps.stallTimeoutMs / 1000} s`), deps.stallTimeoutMs);
  let stall = arm();
  return {
    signal: ac.signal,
    expired,
    touch: () => {
      deps.clearTimeout(stall);
      stall = arm();
    },
    stop: () => {
      deps.clearTimeout(total);
      deps.clearTimeout(stall);
    },
  };
}

/**
 * One GET of the pinned tarball URL streamed to `dest`: 600 s total, 60 s without bytes, never more than
 * `pin.bytes` (reading stops as soon as one byte more is seen). Returns the sha512 hex digest.
 * Synchronous file writes keep the loop microtask-driven (deterministic under fake timers).
 */
async function downloadTarball(deps: ProvisionDeps, dest: string): Promise<string> {
  const { pin } = deps;
  const dog = startWatchdog(deps);
  let fd: number | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const res = await Promise.race([deps.fetch(pin.tarball, { method: "GET", signal: dog.signal }), dog.expired]);
    if (!res.ok || !res.body) throw downloadFailed(`download of ${pin.tarball} failed: HTTP ${res.status}`);
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > pin.bytes) throw downloadFailed(`response declares ${declared} bytes, more than the pinned ${pin.bytes}`);
    reader = res.body.getReader();
    fd = fs.openSync(dest, "w");
    const hash = createHash("sha512");
    let received = 0;
    for (;;) {
      const r = await Promise.race([reader.read(), dog.expired]);
      if (r.done) break;
      dog.touch();
      received += r.value.byteLength;
      if (received > pin.bytes) throw downloadFailed(`response exceeds the pinned size of ${pin.bytes} bytes; aborting`);
      hash.update(r.value);
      writeAll(fd, r.value);
    }
    return hash.digest("hex");
  } catch (e) {
    throw asDownloadFailed(pin.tarball, e);
  } finally {
    dog.stop();
    if (reader) void reader.cancel().catch(() => undefined);
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// ── Expansion ───────────────────────────────────────────────────────────────

interface RawEntry {
  bytes: number;
  sha256: string;
}

interface StManifest {
  forkRevision?: unknown;
  raw: Record<"blender.wasm" | "blender.data", RawEntry>;
  [key: string]: unknown;
}

const mismatch = (message: string, cause?: unknown): ProvisionError => new ProvisionError("runtime-manifest-mismatch", message, { cause });

function isRawEntry(v: unknown): v is RawEntry {
  const e = v as Partial<RawEntry> | null;
  return typeof e === "object" && e !== null && Number.isSafeInteger(e.bytes) && typeof e.sha256 === "string";
}

function readStManifest(tree: string): StManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(tree, "runtime", "st", "manifest.json"), "utf8"));
  } catch (e) {
    throw mismatch(`runtime/st/manifest.json is missing or not valid JSON: ${(e as Error).message}`, e);
  }
  const raw = (parsed as { raw?: Record<string, unknown> } | null)?.raw;
  if (!raw || !isRawEntry(raw["blender.wasm"]) || !isRawEntry(raw["blender.data"])) {
    throw mismatch("runtime/st/manifest.json has no raw entries for blender.wasm and blender.data");
  }
  return parsed as StManifest;
}

/** Stream-expand `<name>.br` to `<name>`, bounded by the expected size, and verify bytes + sha256. */
async function expandBrotli(dir: string, name: string, expected: RawEntry): Promise<StampedFile> {
  const hash = createHash("sha256");
  let size = 0;
  const out = path.join(dir, name);
  try {
    await pipeline(
      fs.createReadStream(`${out}.br`),
      createBrotliDecompress(),
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          size += chunk.length;
          if (size > expected.bytes) throw mismatch(`${name} expands to more than the manifest's ${expected.bytes} bytes`);
          hash.update(chunk);
          yield chunk;
        }
      },
      fs.createWriteStream(out, { mode: 0o644 }),
    );
  } catch (e) {
    if (e instanceof ProvisionError) throw e;
    throw mismatch(`cannot expand ${name}.br: ${(e as Error).message}`, e);
  }
  const sha256 = hash.digest("hex");
  if (size !== expected.bytes || sha256 !== expected.sha256) {
    throw mismatch(`${name} does not match runtime/st/manifest.json (bytes ${size}/${expected.bytes}, sha256 ${sha256}/${expected.sha256})`);
  }
  return { bytes: size, sha256 };
}

/** Expand both `.br` files, delete them, and return the verified hashes by relative path. */
async function expandRuntime(tree: string): Promise<{ manifest: StManifest; known: Record<string, StampedFile> }> {
  const manifest = readStManifest(tree);
  const dir = path.join(tree, "runtime", "st");
  const known: Record<string, StampedFile> = {};
  for (const name of ["blender.wasm", "blender.data"] as const) {
    if (!fs.existsSync(path.join(dir, `${name}.br`))) throw mismatch(`runtime/st/${name}.br is missing from the archive`);
    known[`runtime/st/${name}`] = await expandBrotli(dir, name, manifest.raw[name]);
    fs.rmSync(path.join(dir, `${name}.br`), { force: true });
  }
  return { manifest, known };
}

// ── Stamp ───────────────────────────────────────────────────────────────────

function listFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(path.join(dir, e.name), rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

/** Write the completion stamp (last): bytes + sha256 of every committed file except the stamp itself. */
async function writeStamp(tree: string, pin: PinSpec, known: Record<string, StampedFile>): Promise<void> {
  const files: Record<string, StampedFile> = {};
  for (const rel of listFiles(tree).filter((r) => r !== STAMP_NAME).sort()) {
    files[rel] = known[rel] ?? (await hashFile(path.join(tree, ...rel.split("/"))));
  }
  const stamp: Stamp = { version: pin.version, integrity: pin.integrity, files };
  fs.writeFileSync(path.join(tree, STAMP_NAME), `${JSON.stringify(stamp, null, 2)}\n`);
}

// ── Build one tree ──────────────────────────────────────────────────────────

/** Verify, list, extract, expand, write manifest + stamp into `<staging>/tree`; returns the tree path. */
async function buildTree(deps: ProvisionDeps, staging: string): Promise<string> {
  const { pin } = deps;
  const archive = path.join(staging, "runtime.tgz");
  const digest = await downloadTarball(deps, archive);
  if (digest !== parseSri(pin.integrity).digestHex) {
    fs.rmSync(archive, { force: true });
    throw new ProvisionError("integrity-mismatch", `${pin.name}@${pin.version}: downloaded bytes do not match the pinned sha512 integrity`);
  }
  const tree = path.join(staging, "tree");
  fs.mkdirSync(tree, { recursive: true });
  await listTar(archive);
  await extractAllowlisted(archive, tree, ARCHIVE_ALLOWLIST);
  fs.rmSync(archive, { force: true });

  const { manifest, known } = await expandRuntime(tree);
  fs.writeFileSync(
    path.join(tree, "runtime", "manifest.json"),
    `${JSON.stringify({ forkRevision: manifest.forkRevision, flavors: { st: manifest } }, null, 2)}\n`,
  );
  const missing = firstMissingRequired(tree);
  if (missing) throw new ProvisionError("provision-failed", `the pinned archive lacks required file ${missing}`);
  await writeStamp(tree, pin, known);
  return tree;
}

// ── provision ───────────────────────────────────────────────────────────────

function overrideResult(deps: ProvisionDeps, overrideDir: string): ProvisionResult {
  const dir = path.resolve(overrideDir);
  const missing = firstMissingRequired(dir);
  if (missing) throw new ProvisionError("override-invalid", `BLENDER_WASM_DIR=${overrideDir}: missing required file ${missing}`);
  deps.log(`[pi-blender] using BLENDER_WASM_DIR override ${dir}`);
  return { version: readPackageVersion(dir), source: "override", dir, bytes: dirBytes(dir), licence: readLicence(dir) };
}

function cacheResult(deps: ProvisionDeps, dir: string, source: ProvisionSource): ProvisionResult {
  return { version: deps.pin.version, source, dir, bytes: dirBytes(dir), licence: readLicence(dir) };
}

async function provisionManaged(deps: ProvisionDeps, root: string, versionDir: string): Promise<ProvisionResult> {
  fs.mkdirSync(root, { recursive: true });
  sweepStaleStaging(root, deps.now());
  if (isValidCache(versionDir, deps.pin)) return cacheResult(deps, versionDir, "cache");
  if (fs.existsSync(versionDir)) {
    deps.log(`[pi-blender] cache entry ${versionDir} is damaged; re-provisioning`);
    fs.rmSync(versionDir, { recursive: true, force: true });
  }
  const staging = path.join(root, `.staging-${deps.pid}-${deps.randomId()}`);
  fs.mkdirSync(staging, { recursive: true });
  try {
    deps.log(`[pi-blender] downloading ${deps.pin.name}@${deps.pin.version} (${(deps.pin.bytes / 1048576).toFixed(0)} MB)`);
    const tree = await buildTree(deps, staging);
    const raced = commitTree(tree, versionDir, (dir) => isValidCache(dir, deps.pin));
    return cacheResult(deps, versionDir, raced ? "cache" : "download");
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** Provision the pinned runtime: override, valid cache, or a verified download (see the file header). */
export async function provision(partial: Partial<ProvisionDeps> = {}): Promise<ProvisionResult> {
  const deps: ProvisionDeps = { ...defaultDeps(), ...partial };
  if (deps.env.BLENDER_WASM_DIR) return overrideResult(deps, deps.env.BLENDER_WASM_DIR);

  const root = resolveCacheRoot(deps.env, deps.homedir);
  const versionDir = path.join(root, deps.pin.version);
  if (isValidCache(versionDir, deps.pin)) return cacheResult(deps, versionDir, "cache");
  try {
    return await singleFlight(`provision:${versionDir}`, () => provisionManaged(deps, root, versionDir));
  } catch (e) {
    if (e instanceof ProvisionError) throw e;
    throw new ProvisionError("provision-failed", `provisioning ${deps.pin.name}@${deps.pin.version} failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
}

// ── Repair ──────────────────────────────────────────────────────────────────

const SAFE_SEGMENT = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;

async function stampMatchesDisk(dir: string): Promise<boolean> {
  const stamp = readStamp(dir);
  if (!stamp) return false;
  for (const [rel, want] of Object.entries(stamp.files)) {
    const file = path.join(dir, ...rel.split("/"));
    try {
      if (!fs.statSync(file).isFile()) return false;
      const got = await hashFile(file);
      if (got.bytes !== want.bytes || got.sha256 !== want.sha256) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * After a boot failure on a downloaded copy: re-hash EVERY stamped file in `<root>/<version>`; delete the
 * directory on any mismatch, missing file or size difference (the next call re-provisions).
 * No-op (`false`) for the override source or a missing directory; `true` when it deleted.
 */
export async function repairAfterBootFailure(version: string, partial: Partial<ProvisionDeps> = {}): Promise<boolean> {
  const deps: ProvisionDeps = { ...defaultDeps(), ...partial };
  if (deps.env.BLENDER_WASM_DIR || !SAFE_SEGMENT.test(version) || version.includes("..")) return false;
  const dir = path.join(resolveCacheRoot(deps.env, deps.homedir), version);
  if (!fs.existsSync(dir)) return false;
  if (await stampMatchesDisk(dir)) return false;
  deps.log(`[pi-blender] cached runtime ${dir} failed verification; removing it`);
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}
