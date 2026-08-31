/**
 * Native-module ABI guard rail — byte-level N-API classification, a
 * contained out-of-process ABI probe, and the discovery manifest that
 * bounds the pre-spawn check (design D6–D7).
 *
 * Compiled native modules (`.node` files) in the shared extension tree are
 * ABI-bound to the Node they were built against — EXCEPT N-API modules,
 * which are ABI-stable across Node versions. The distinction is made by
 * inspecting the binary's symbol/string tables for the N-API registration
 * symbol, NEVER by distribution layout: per-platform prebuilds do not imply
 * ABI stability (better-sqlite3 v13 ships prebuilds and stays V8-bound).
 *
 * The authoritative ABI answer for a V8-bound module comes from Tier B: a
 * tiny child `process.dlopen` probe run under the RESOLVED spawn runtime
 * with a fixed argv, no shell — the same trust boundary as
 * `spawn-runtime.ts`'s version probe. Crash containment is absolute (the
 * child dies, the parent parses), and every failure mode collapses to a
 * `null` verdict: this module can never destabilise the server.
 *
 * The manifest walk (server start / Doctor demand) records each `.node`
 * file's stat signature `(path, size, mtimeMs)` plus the byte-level
 * classification — deliberately NOT probing during the walk. The pre-spawn
 * check is then exactly a re-stat (`checkManifestDrift`): no walk, no probe
 * while signatures hold; drift (an in-place `npm rebuild` rewriting a file
 * without changing tree shape) invalidates the verdict and re-evaluates.
 *
 * See change: unify-pi-runtime-identity (proposal Part 2, design D6–D7).
 */

import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "./exec.js";

// ── N-API classification (design D6) ─────────────────────────────────────────

/**
 * The N-API registration symbol. A binary exporting this registers through
 * N-API and is ABI-stable across NODE_MODULE_VERSIONs. The symbol name is
 * stored verbatim as a C string in every object format's symbol/string
 * tables (Mach-O `__LINKEDIT`, ELF `.dynstr`/`.strtab`, PE export rdata),
 * so a plain byte search is a faithful symbol-level inspection.
 */
const NAPI_REGISTER_SYMBOL = "napi_register_module_v1";
const NAPI_REGISTER_SYMBOL_BYTES = Buffer.from(NAPI_REGISTER_SYMBOL, "latin1");

/**
 * Byte-level N-API classification: true iff the binary contains the N-API
 * registration symbol name in its symbol/string tables. Pure inspection of
 * the given bytes — NEVER of distribution layout (`prebuilds/` paths etc.).
 * Uncertain (garbage, truncated, empty bytes) → false: the module is
 * treated as V8-bound and the Tier-B probe answers definitively (an N-API
 * module simply dlopens fine on any ABI, so a false "v8" costs one bounded
 * probe, while a false "napi" would skip a real mismatch).
 */
export function isNapiModuleFile(bytes: Buffer): boolean {
  return bytes.includes(NAPI_REGISTER_SYMBOL_BYTES);
}

// ── Tier B: the contained dlopen probe (design D6) ───────────────────────────

/** Result shape the injectable spawn returns (a `SpawnSyncReturns` subset). */
export interface SpawnOutcome {
  /** Child exit status; `null` = killed (timeout/signal) or failed to spawn. */
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Injectable spawn for `probeNativeModuleAbi` — tests fake child outcomes
 * (crash, mismatch message, success) without spawning anything, mirroring
 * how `spawn-runtime.ts` injects `versionProbe`.
 */
export type FakeableSpawn = (
  nodeBinary: string,
  args: readonly string[],
  options: { timeoutMs: number },
) => SpawnOutcome | null;

/** Verdict of a Tier-B probe; `null` (returned, never thrown) = unknown. */
export interface ProbeOutcome {
  compatible: boolean;
  /** NODE_MODULE_VERSION the module was compiled against. */
  builtAbi: number | null;
  /** NODE_MODULE_VERSION the probing child requires. */
  requiredAbi: number | null;
  /** Combined child output, for diagnostics. */
  raw: string;
}

const DEFAULT_PROBE_TIMEOUT_MS = 5000;

/**
 * The child script: dlopen the module IN THE CHILD, print the child's
 * `process.versions.modules` (its NODE_MODULE_VERSION) on success, or the
 * thrown message (the structured `ERR_DLOPEN_FAILED` ABI-mismatch text) on
 * stderr with a non-zero exit code. `exitCode` (not `process.exit`) so the
 * runtime flushes the pipes before exiting. The module path rides as the
 * last argv element — the spawn passes exactly one trailing argument.
 */
const DLOPEN_PROBE_SCRIPT = [
  "const p = process.argv[process.argv.length - 1];",
  "try {",
  "  process.dlopen({ exports: {} }, p);",
  "  process.stdout.write(String(process.versions.modules));",
  "} catch (err) {",
  "  process.stderr.write(String((err && err.message) || err));",
  "  process.exitCode = 1;",
  "}",
].join(" ");

/**
 * The well-known Node ABI-mismatch message shape, e.g.
 * `was compiled against a different Node.js version using NODE_MODULE_VERSION
 * 141. This version of Node.js requires NODE_MODULE_VERSION 137. Be sure
 * to recompile…`. Accepts the required side with or without the
 * `NODE_MODULE_VERSION` prefix so both historical wordings parse.
 */
const ABI_MISMATCH_RE =
  /NODE_MODULE_VERSION\s+(\d+)\.\s*This version of Node\.js requires\s+(?:NODE_MODULE_VERSION\s+)?(\d+)/;

/**
 * Default spawn: FIXED argv, no shell, `ELECTRON_RUN_AS_NODE=1` env (a
 * plain node ignores it; an Electron binary probed as candidate runs as
 * node instead of launching the GUI), piped stdio, bounded by a timeout.
 * Any spawn-level failure (ENOENT, killed, thrown) → null.
 */
function defaultSpawn(
  nodeBinary: string,
  args: readonly string[],
  options: { timeoutMs: number },
): SpawnOutcome | null {
  try {
    const result = spawnSync<string>(nodeBinary, args, {
      encoding: "utf-8",
      timeout: options.timeoutMs,
      env: { ...(process.env ?? {}), ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) return null;
    return {
      status: result.status,
      stdout: typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? ""),
      stderr: typeof result.stderr === "string" ? result.stderr : String(result.stderr ?? ""),
    };
  } catch {
    return null;
  }
}

/**
 * Tier-B authoritative ABI probe: spawn `nodeBinary` with a tiny `-e`
 * script that `process.dlopen`s the module in the CHILD.
 *
 * - exit 0 → `{ compatible: true, builtAbi: requiredAbi: <child's
 *   process.versions.modules> }` (the module loads under this runtime).
 * - non-zero output containing the well-known mismatch shape → parsed
 *   `{ compatible: false, builtAbi: X, requiredAbi: Y }`.
 * - crash / garbage / timeout / spawn failure → `null` — verdict unknown,
 *   NEVER thrown into the caller.
 */
export function probeNativeModuleAbi(
  dotNodePath: string,
  nodeBinary: string,
  opts: { spawn?: FakeableSpawn; timeoutMs?: number } = {},
): ProbeOutcome | null {
  try {
    const spawn = opts.spawn ?? defaultSpawn;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    const result = spawn(nodeBinary, ["-e", DLOPEN_PROBE_SCRIPT, dotNodePath], { timeoutMs });
    if (!result) return null;
    const raw = `${result.stdout}\n${result.stderr}`.trim();

    if (result.status === 0) {
      const out = result.stdout.trim();
      if (/^\d+$/.test(out)) {
        const abi = Number(out);
        return { compatible: true, builtAbi: abi, requiredAbi: abi, raw };
      }
      return null;
    }

    const mismatch = raw.match(ABI_MISMATCH_RE);
    if (mismatch) {
      return {
        compatible: false,
        builtAbi: Number(mismatch[1]),
        requiredAbi: Number(mismatch[2]),
        raw,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ── The two-tier entry (design D6) ───────────────────────────────────────────

/** Read a file's bytes; null on any failure (unreadable → uncertain). */
function defaultReadBytes(p: string): Buffer | null {
  try {
    return readFileSync(p);
  } catch {
    return null;
  }
}

export interface ReadNativeModuleAbiOpts {
  /** Runtime the module must load under — the RESOLVED spawn runtime. */
  nodeBinary: string;
  /** Default `readFileSync`; null on failure. Injectable for tests. */
  readBytes?: (p: string) => Buffer | null;
  /** Default `probeNativeModuleAbi`. Injectable for tests. */
  probe?: typeof probeNativeModuleAbi;
}

/**
 * The two-tier ABI reader for a single `.node` file:
 *
 * 1. Tier A — byte-level N-API check: an N-API module is ABI-stable →
 *    `null` (skip, no probe). Tier-A inspection of the `NODE_MODULE`
 *    struct's `nm_version` int is deliberately NOT attempted beyond this
 *    symbol check: format-specific struct walking (Mach-O/ELF/PE) is not a
 *    "small pure reader" (design D6 sanctions Tier A only that far), and
 *    Tier B answers definitively for one bounded child spawn.
 * 2. Tier B — the dlopen probe: returns the module's `builtAbi` EVEN when
 *    incompatible (that is exactly the mismatch datum), or `null` when the
 *    verdict is unknown (crash/garbage/timeout — never a throw).
 */
export function readNativeModuleAbi(
  dotNodePath: string,
  opts: ReadNativeModuleAbiOpts,
): number | null {
  const readBytes = opts.readBytes ?? defaultReadBytes;
  const probe = opts.probe ?? probeNativeModuleAbi;

  const bytes = readBytes(dotNodePath);
  // Unreadable bytes → classification uncertain → treated V8-bound; Tier B
  // decides (an N-API module simply loads fine, a mismatch parses).
  if (bytes && isNapiModuleFile(bytes)) return null;

  const outcome = probe(dotNodePath, opts.nodeBinary);
  return outcome && outcome.builtAbi !== null ? outcome.builtAbi : null;
}

// ── Discovery walk + manifest (design D7) ────────────────────────────────────

/**
 * Discovery-walk depth cap: 8 directory hops below the tree root,
 * inclusive. The real offenders live nested (`better-sqlite3/build/Release/
 * *.node`, `prebuilds/**` at ~5 levels); anything deeper is not a Node
 * dependency layout.
 */
const DEFAULT_WALK_DEPTH = 8;

/** Byte-level verdict per file; `builtAbi` is filled later by the probe. */
export interface NativeModuleEntry {
  path: string;
  size: number;
  mtimeMs: number;
  classification: "napi" | "v8";
}

/** Snapshot of the compiled-module files found under one tree root. */
export type NativeModuleManifest = {
  treeRoot: string;
  scannedAt: string;
  entries: NativeModuleEntry[];
};

/** Minimal stat surface the walk needs from lstat (injectable for tests). */
export interface WalkLstat {
  isDirectory(): boolean;
}

export interface WalkNativeModuleOpts {
  /** Default 8. Files whose parent dir sits deeper than this are excluded. */
  maxDepth?: number;
  /** Default `existsSync`. Injectable for tests. */
  exists?: (p: string) => boolean;
  /** Default `readdirSync` (null on failure). Injectable for tests. */
  readdir?: (p: string) => string[] | null;
  /** Default `lstatSync` (null on failure). Injectable for tests. */
  lstat?: (p: string) => WalkLstat | null;
}

/**
 * Depth-capped discovery walk: every `.node` file at or below `treeRoot`.
 * Nested `node_modules` dependency dirs are INCLUDED — the real offenders
 * live nested (`build/Release/**`, `prebuilds/**`). Depth semantics: the
 * root dir is depth 0; a file is included iff its parent dir is at most
 * `maxDepth` hops below the root (default 8 — test-plan E10 pins the
 * boundary: parent-depth 8 in, 9 out). Directory symlinks are not followed
 * (cycle safety); a `.node` entry that is not a directory counts, symlink
 * or not. Deterministic: the result is sorted by path.
 */
function readdirNamesOrNull(p: string): string[] | null {
  try {
    return readdirSync(p);
  } catch {
    return null;
  }
}

function lstatEntryOrNull(p: string): WalkLstat | null {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

function statSignatureOrNull(p: string): FileSignature | null {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

/** One directory-entry decision inside the walk (extracted to keep the walk flat). */
interface WalkEntryTarget {
  found: string[];
  pending: Array<{ dir: string; depth: number }>;
}

/** Collect a `.node` file, or queue a real (non-symlinked) subdirectory. */
function classifyWalkEntry(
  name: string,
  full: string,
  depth: number,
  maxDepth: number,
  lstat: (p: string) => WalkLstat | null,
  target: WalkEntryTarget,
): void {
  const lst = lstat(full);
  if (!lst) return;
  if (lst.isDirectory()) {
    if (depth + 1 <= maxDepth) target.pending.push({ dir: full, depth: depth + 1 });
  } else if (name.endsWith(".node")) {
    target.found.push(full);
  }
}

export function walkNativeModuleFiles(
  treeRoot: string,
  opts: WalkNativeModuleOpts = {},
): string[] {
  const maxDepth = opts.maxDepth ?? DEFAULT_WALK_DEPTH;
  const exists = opts.exists ?? existsSync;
  const readdir = opts.readdir ?? readdirNamesOrNull;
  const lstat = opts.lstat ?? lstatEntryOrNull;

  if (!exists(treeRoot)) return [];

  const target: WalkEntryTarget = {
    found: [],
    pending: [{ dir: treeRoot, depth: 0 }],
  };
  while (target.pending.length > 0) {
    const { dir, depth } = target.pending.pop() as { dir: string; depth: number };
    const names = readdir(dir);
    if (!names) continue;
    for (const name of names) {
      classifyWalkEntry(name, path.join(dir, name), depth, maxDepth, lstat, target);
    }
  }
  return target.found.sort();
}

/** Minimal stat surface the manifest needs (injectable for tests). */
export interface FileSignature {
  size: number;
  mtimeMs: number;
}

export interface BuildNativeModuleManifestOpts extends WalkNativeModuleOpts {
  /** Default `statSync` (null on failure). Injectable for tests. */
  stat?: (p: string) => FileSignature | null;
  /** Default `readFileSync` (null on failure). Injectable for tests. */
  readBytes?: (p: string) => Buffer | null;
}

/**
 * Discovery manifest: walk `treeRoot` (nested dependency dirs included),
 * stat each found file for its signature `(size, mtimeMs)`, and classify
 * each at the BYTE level. The walk deliberately does NOT probe —
 * `builtAbi` is determined later, at Doctor/pre-spawn evaluation time,
 * where probes are bounded and cached. A file that vanishes between walk
 * and stat is dropped here; the next discovery walk catches re-appearances.
 */
export function buildNativeModuleManifest(
  treeRoot: string,
  opts: BuildNativeModuleManifestOpts = {},
): NativeModuleManifest {
  const stat = opts.stat ?? statSignatureOrNull;
  const readBytes = opts.readBytes ?? defaultReadBytes;

  const entries: NativeModuleEntry[] = [];
  for (const file of walkNativeModuleFiles(treeRoot, opts)) {
    const sig = stat(file);
    if (!sig) continue;
    const bytes = readBytes(file);
    entries.push({
      path: file,
      size: sig.size,
      mtimeMs: sig.mtimeMs,
      // Unreadable bytes → uncertain → "v8": the later probe decides.
      classification: bytes && isNapiModuleFile(bytes) ? "napi" : "v8",
    });
  }
  return { treeRoot, scannedAt: new Date().toISOString(), entries };
}

export interface CheckManifestDriftOpts {
  /** Default `statSync` (null on failure). Injectable for tests. */
  stat?: (p: string) => FileSignature | null;
}

export interface ManifestDriftResult {
  /** Entries whose size/mtimeMs changed or that vanished. */
  driftedPaths: string[];
  /** Re-statted manifest: current signatures; vanished entries dropped. */
  fresh: NativeModuleManifest;
}

/**
 * The pre-spawn stat check (design D7): re-stat every manifest entry and
 * report drift. A file whose size or mtimeMs changed — the fingerprint of
 * an in-place rebuild, which changes no directory shape — or that vanished
 * is drifted; its verdict is invalid and must be re-evaluated. This is
 * EXACTLY the pre-spawn check's cheap half: no walk, no probe, a handful
 * of stat calls while signatures hold.
 */
export function checkManifestDrift(
  manifest: NativeModuleManifest,
  opts: CheckManifestDriftOpts = {},
): ManifestDriftResult {
  const stat = opts.stat ?? statSignatureOrNull;

  const driftedPaths: string[] = [];
  const freshEntries: NativeModuleEntry[] = [];
  for (const entry of manifest.entries) {
    const sig = stat(entry.path);
    if (!sig || sig.size !== entry.size || sig.mtimeMs !== entry.mtimeMs) {
      driftedPaths.push(entry.path);
    }
    if (sig) {
      freshEntries.push({ ...entry, size: sig.size, mtimeMs: sig.mtimeMs });
    }
  }
  return {
    driftedPaths,
    fresh: { treeRoot: manifest.treeRoot, scannedAt: new Date().toISOString(), entries: freshEntries },
  };
}

export interface FindAbiMismatchOpts {
  /** Runtime whose ABI the modules must match — the RESOLVED spawn runtime. */
  nodeBinary?: string;
  /** Default `probeNativeModuleAbi`. Injectable for tests. */
  probe?: typeof probeNativeModuleAbi;
  /** Default `statSync` (null on failure). Injectable for tests. */
  stat?: (p: string) => FileSignature | null;
  /** Default `readFileSync` (null on failure). Injectable for tests. */
  readBytes?: (p: string) => Buffer | null;
}

export interface AbiMismatchRow {
  /** Entry with the CURRENT (post-revalidation) signature. */
  entry: NativeModuleEntry;
  builtAbi: number;
}

/**
 * Evaluate manifest entries against the resolved runtime's ABI. N-API
 * entries NEVER appear, regardless of anything — they are ABI-stable.
 * V8-bound entries are probed for their `builtAbi`; a drifted stat
 * signature invalidates the byte-level classification, so the bytes are
 * re-read before the verdict (an in-place rebuild may have flipped the
 * module to N-API — such an entry is skipped, not condemned). A probe
 * failure yields NO row: unknown ≠ mismatch, and this check must never
 * destabilise the server.
 */
interface AbiMismatchDeps {
  nodeBinary: string;
  stat: (p: string) => FileSignature | null;
  readBytes: (p: string) => Buffer | null;
  probe: typeof probeNativeModuleAbi;
}

/**
 * Evaluate ONE V8-bound entry against the resolved ABI. Drifted stat →
 * bytes re-read first (a rebuild that flipped the module to N-API exempts
 * it); then the authoritative probe. Null = no row (vanished, re-read as
 * N-API, probe unknown, or ABI matches).
 */
function evaluateV8Entry(
  entry: NativeModuleEntry,
  resolvedAbi: number,
  deps: AbiMismatchDeps,
): AbiMismatchRow | null {
  const sig = deps.stat(entry.path);
  if (!sig) return null; // vanished — unknown, no row

  let current = entry;
  if (sig.size !== entry.size || sig.mtimeMs !== entry.mtimeMs) {
    const bytes = deps.readBytes(entry.path);
    if (bytes && isNapiModuleFile(bytes)) return null;
    current = { ...entry, size: sig.size, mtimeMs: sig.mtimeMs, classification: "v8" };
  }

  const outcome = deps.probe(entry.path, deps.nodeBinary);
  if (!outcome || outcome.builtAbi === null) return null;
  return outcome.builtAbi !== resolvedAbi
    ? { entry: current, builtAbi: outcome.builtAbi }
    : null;
}

export function findAbiMismatches(
  entries: readonly NativeModuleEntry[],
  resolvedAbi: number,
  opts: FindAbiMismatchOpts = {},
): AbiMismatchRow[] {
  const deps: AbiMismatchDeps = {
    nodeBinary: opts.nodeBinary ?? process.execPath,
    stat: opts.stat ?? statSignatureOrNull,
    readBytes: opts.readBytes ?? defaultReadBytes,
    probe: opts.probe ?? probeNativeModuleAbi,
  };

  const rows: AbiMismatchRow[] = [];
  for (const entry of entries) {
    if (entry.classification === "napi") continue;
    const row = evaluateV8Entry(entry, resolvedAbi, deps);
    if (row) rows.push(row);
  }
  return rows;
}
