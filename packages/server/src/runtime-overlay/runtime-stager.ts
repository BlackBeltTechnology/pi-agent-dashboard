/**
 * Runtime stager (D1, D2, D5, D9): installs runtime release X into
 * `~/.pi/dashboard/runtime/versions/X.partial/`, verifies it, materializes
 * first-party plugins, writes `runtime-manifest.json`, renames to
 * `versions/X/` and marks it `pending` in request.json. Never activates.
 *
 *   npm    — `runtime-lock.json` from server@X → synthetic root → `npm ci --omit=dev`
 *   github — per-platform asset + `.sha512` (spike 1.1 interim decision),
 *            verified BEFORE extraction
 *
 * Any failure removes the `.partial` tree and leaves request.json untouched.
 * All I/O that reaches the network or spawns is injected (`StagerDeps`).
 *
 * See change: electron-runtime-overlay-updates.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readRuntimeManifest, writeRuntimeManifest } from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/manifest.mjs";
import {
  materializeBundledPlugins,
  readBundledPluginIds,
} from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/materialize-plugins.mjs";
import { patchRuntimeRequest, readRuntimeState } from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/state.js";
import semver from "semver";

const SCOPE = "@blackbelt-technology";
const SERVER_PKG = `${SCOPE}/pi-dashboard-server`;

export type StageSource = "npm" | "github";

export interface StageProgress {
  version: string;
  phase: "fetch" | "install" | "verify" | "materialize" | "done" | "error";
  message?: string;
}

export interface StagerDeps {
  /** `runtime-lock.json` shipped inside server@X (npm source). */
  fetchRuntimeLock: (version: string, workDir: string) => Promise<RuntimeLock>;
  /** Run npm (resolved like pi-core updates) in `cwd`; rejects on non-zero exit. */
  runNpm: (args: string[], cwd: string, onOutput?: (line: string) => void) => Promise<void>;
  /** Download the platform asset of release X to `dest`; returns the published sha512 (hex). */
  fetchGithubAsset: (version: string, dest: string, target: { platform: string; arch: string }) => Promise<{ sha512: string; assetName: string }>;
  /** Extract a .tgz whose root is the runtime tree into `destDir`. */
  extractTgz: (tgzPath: string, destDir: string) => Promise<void>;
  platform: string;
  arch: string;
}

export interface RuntimeLock {
  lockfileVersion?: number;
  packages: Record<string, { version?: string; integrity?: string; dependencies?: Record<string, string>; name?: string }>;
  [k: string]: unknown;
}

class RuntimeStageError extends Error {
  constructor(public readonly code: string, detail: string) {
    super(`${code} ${detail}`.trim());
    this.name = "RuntimeStageError";
  }
}

/** Deterministic synthetic root for `npm ci`: package.json from the lock root + the lock verbatim (E8). */
export function buildSyntheticRoot(lock: RuntimeLock, version: string): { packageJson: string; packageLock: string } {
  const root = lock.packages?.[""];
  if (!root || root.version !== version) {
    throw new RuntimeStageError("lock_version_mismatch", `lock root ${root?.version ?? "missing"} ≠ ${version}`);
  }
  const deps = Object.fromEntries(Object.entries(root.dependencies ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  const pkg = { name: root.name ?? "pi-dashboard-runtime", version, private: true, dependencies: deps };
  return { packageJson: `${JSON.stringify(pkg, null, 2)}\n`, packageLock: `${JSON.stringify(lock, null, 2)}\n` };
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Every `@blackbelt-technology/*` package ANYWHERE in the tree — including
 * below unscoped / third-party packages — whose version ≠ X, as `name@version`.
 */
export function lockstepCheck(root: string, version: string): string[] {
  const mismatched: string[] = [];
  const visitPackage = (pkgDir: string, name: string, depth: number) => {
    if (name.startsWith(`${SCOPE}/`)) {
      const pkg = readJson(path.join(pkgDir, "package.json"));
      if (pkg && pkg.version !== version) mismatched.push(`${name}@${String(pkg.version)}`);
    }
    walk(path.join(pkgDir, "node_modules"), depth + 1);
  };
  const walk = (nodeModules: string, depth: number) => {
    if (depth > 12) return;
    for (const entry of safeReaddir(nodeModules)) {
      if (entry.startsWith(".")) continue;
      if (entry.startsWith("@")) {
        for (const sub of safeReaddir(path.join(nodeModules, entry))) visitPackage(path.join(nodeModules, entry, sub), `${entry}/${sub}`, depth);
      } else {
        visitPackage(path.join(nodeModules, entry), entry, depth);
      }
    }
  };
  walk(path.join(root, "node_modules"), 0);
  return mismatched.sort();
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Materialize the first-party plugins DECLARED by X (`piDashboard.bundledPlugins`
 * of the staged server) into `resources/plugins/<id>/` — the same layout and
 * shared helper as the bundle. Each id maps to the installed package whose
 * published `repository.directory` is `packages/<id>`. The materialized id set
 * must equal the declaration exactly (no missing, no substitutes).
 */
function materializeOverlayPlugins(root: string): void {
  const scopeDir = path.join(root, "node_modules", SCOPE);
  const declared = readBundledPluginIds(path.join(scopeDir, "pi-dashboard-server", "package.json"));
  const byDirectory = new Map<string, string>();
  for (const name of safeReaddir(scopeDir)) {
    const pkg = readJson(path.join(scopeDir, name, "package.json"));
    const dir = (pkg?.repository as { directory?: unknown } | undefined)?.directory;
    if (typeof dir === "string") byDirectory.set(dir, path.join(scopeDir, name));
  }
  const destDir = path.join(root, "resources", "plugins");
  // Fresh directory: nothing shipped by an archive may survive next to the
  // declared set (no extra / substituted plugins).
  fs.rmSync(destDir, { recursive: true, force: true });
  materializeBundledPlugins({ ids: declared, resolveSource: (id) => byDirectory.get(`packages/${id}`) ?? null, destDir });
  const actual = safeReaddir(destDir).sort();
  const expected = [...declared].sort();
  if (actual.join("\n") !== expected.join("\n")) {
    throw new RuntimeStageError("plugin_set_mismatch", `resources/plugins has [${actual.join(", ")}], release declares [${expected.join(", ")}]`);
  }
}

/**
 * Defence in depth for extracted archives: every symlink in the tree must
 * resolve inside it (the extractor already refuses absolute / `..` members).
 */
function assertContainedTree(root: string): void {
  const realRoot = fs.realpathSync(root);
  const stack = [root];
  while (stack.length) {
    const dirPath = stack.pop() as string;
    for (const ent of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const p = path.join(dirPath, ent.name);
      if (ent.isSymbolicLink()) assertLinkInside(realRoot, root, p);
      else if (ent.isDirectory()) stack.push(p);
    }
  }
}

function assertLinkInside(realRoot: string, root: string, link: string): void {
  const target = path.resolve(path.dirname(link), fs.readlinkSync(link));
  const rel = path.relative(realRoot, fs.existsSync(target) ? fs.realpathSync(target) : target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new RuntimeStageError("unsafe_archive", `symlink ${path.relative(root, link)} escapes the runtime tree`);
  }
}

function sha512File(file: string): string {
  return createHash("sha512").update(fs.readFileSync(file)).digest("hex");
}

async function installFromNpm(version: string, partial: string, deps: StagerDeps, progress: (p: StageProgress) => void): Promise<string | undefined> {
  progress({ version, phase: "fetch", message: `runtime-lock.json of ${SERVER_PKG}@${version}` });
  const work = path.join(partial, ".pack");
  fs.mkdirSync(work, { recursive: true });
  const lock = await deps.fetchRuntimeLock(version, work);
  const root = buildSyntheticRoot(lock, version);
  fs.writeFileSync(path.join(partial, "package.json"), root.packageJson);
  fs.writeFileSync(path.join(partial, "package-lock.json"), root.packageLock);
  fs.rmSync(work, { recursive: true, force: true });
  progress({ version, phase: "install", message: "npm ci --omit=dev" });
  // --allow-remote=all: npm 12 defaults to `none` and refuses URL-tarball deps
  // (xlsx from cdn.sheetjs.com). Safe: every lock entry pins its integrity.
  await deps.runNpm(["ci", "--omit=dev", "--no-audit", "--no-fund", "--allow-remote=all"], partial, (line) => progress({ version, phase: "install", message: line }));
  return lock.packages[`node_modules/${SERVER_PKG}`]?.integrity;
}

async function installFromGithub(version: string, partial: string, deps: StagerDeps, progress: (p: StageProgress) => void): Promise<string> {
  const asset = path.join(partial, ".asset.tgz");
  progress({ version, phase: "fetch", message: `GitHub release v${version} (${deps.platform}-${deps.arch})` });
  const { sha512 } = await deps.fetchGithubAsset(version, asset, { platform: deps.platform, arch: deps.arch });
  progress({ version, phase: "verify", message: "sha512" });
  const actual = sha512File(asset);
  if (actual.toLowerCase() !== sha512.trim().toLowerCase()) {
    throw new RuntimeStageError("checksum_mismatch", `asset sha512 ${actual.slice(0, 16)}… ≠ published ${sha512.trim().slice(0, 16)}…`);
  }
  progress({ version, phase: "install", message: "extract" });
  await deps.extractTgz(asset, partial);
  fs.rmSync(asset, { force: true });
  assertContainedTree(partial);
  return `sha512:${actual}`;
}

function writeOverlayManifest(root: string, version: string, source: StageSource, integrity: string | undefined): void {
  const server = readJson(path.join(root, "node_modules", SERVER_PKG, "package.json")) ?? {};
  const pi = readJson(path.join(root, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"));
  const pd = server.piDashboard as { minShellVersion?: string } | undefined;
  const engines = server.engines as { node?: string } | undefined;
  if (!pd?.minShellVersion || !engines?.node) {
    throw new RuntimeStageError("invalid_release", "server package lacks piDashboard.minShellVersion or engines.node");
  }
  writeRuntimeManifest(root, {
    version,
    minShellVersion: pd.minShellVersion,
    nodeEngines: engines.node,
    origin: source,
    ...(integrity ? { integrity } : {}),
    ...(typeof pi?.version === "string" ? { piVersion: pi.version } : {}),
  });
}

/**
 * Stage release X. Idempotent: an existing `versions/X` with a valid manifest
 * for X is kept (only `pending` is set). Throws `RuntimeStageError` / the
 * underlying error; on ANY failure the `.partial` tree is removed and
 * request.json is untouched.
 */
export async function stageRuntime(opts: {
  dir: string;
  version: string;
  source: StageSource;
  deps: StagerDeps;
  onProgress?: (p: StageProgress) => void;
}): Promise<{ root: string }> {
  const version = semver.valid(opts.version);
  if (!version || version !== opts.version) throw new RuntimeStageError("invalid_version", JSON.stringify(opts.version));
  const progress = opts.onProgress ?? (() => {});
  const versions = path.join(opts.dir, "versions");
  const finalRoot = path.join(versions, version);
  const partial = `${finalRoot}.partial`;

  if (readRuntimeManifest(finalRoot)?.version === version) {
    patchRuntimeRequest(opts.dir, { pending: version, pendingNonce: randomUUID() });
    progress({ version, phase: "done", message: "already staged" });
    return { root: finalRoot };
  }

  const state = readRuntimeState(opts.dir);
  if (fs.existsSync(finalRoot) && (state.current === version || state.previous === version)) {
    // Never replace a runtime Electron may be running / roll back to.
    throw new RuntimeStageError("in_use", `versions/${version} is the current or previous runtime`);
  }
  fs.rmSync(partial, { recursive: true, force: true }); // interrupted earlier run → start clean (X2)
  fs.mkdirSync(partial, { recursive: true });
  try {
    const integrity =
      opts.source === "npm"
        ? await installFromNpm(version, partial, opts.deps, progress)
        : await installFromGithub(version, partial, opts.deps, progress);

    progress({ version, phase: "verify", message: "lockstep" });
    const mismatched = lockstepCheck(partial, version);
    if (mismatched.length) throw new RuntimeStageError("lockstep_mismatch", mismatched.join(", "));

    progress({ version, phase: "materialize", message: "first-party plugins" });
    materializeOverlayPlugins(partial);
    writeOverlayManifest(partial, version, opts.source, integrity);

    fs.rmSync(finalRoot, { recursive: true, force: true });
    fs.renameSync(partial, finalRoot);
  } catch (err) {
    fs.rmSync(partial, { recursive: true, force: true });
    progress({ version, phase: "error", message: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  // An explicit Update is a user action on X: the fresh pendingNonce tells
  // Electron to clear bad[X] + attempts (D2).
  patchRuntimeRequest(opts.dir, { pending: version, pendingNonce: randomUUID() });
  progress({ version, phase: "done" });
  return { root: finalRoot };
}
