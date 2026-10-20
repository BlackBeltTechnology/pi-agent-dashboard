/**
 * Release-lock helpers for `bundle-server.mjs` (plain Node — no TS, no
 * workspace install required) and for the pre-publish lock lint
 * (`scripts/lint-runtime-lock.mjs`).
 *
 * A release installer for X installs its bundled server's third-party tree
 * from `@blackbelt-technology/pi-dashboard-server@X`'s `runtime-lock.json`
 * (the same lock the runtime overlay installs) instead of resolving floating
 * ranges. The published lock is shaped for the overlay layout (first-party
 * packages from the registry), so it is REBASED onto the bundle's workspace
 * layout first (`rebaseRuntimeLock`), installed with `npm ci`, then the
 * installed tree is audited (`auditInstalledTree`).
 *
 * Everything here fails closed: any lock defect throws; nothing falls back to
 * a floating install.
 *
 * See change: pin-electron-bundle-dependency-tree (design D1–D6).
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertSafeArchiveListing } from "../../../shared/src/runtime-overlay/archive-safety.mjs";

export const SCOPE_PREFIX = "@blackbelt-technology/";
export const SERVER_PACKAGE = `${SCOPE_PREFIX}pi-dashboard-server`;
/** Pinned only by the overlay lock; the bundle materializes it from local `packages/client`. */
export const WEB_PACKAGE = `${SCOPE_PREFIX}pi-dashboard-web`;
/** Name of the bundle's synthetic root (`bundle-server.mjs` `bundlePkg.name`). */
export const SYNTHETIC_ROOT_NAME = "pi-dashboard-bundled-server";

const LOCK_FILE_IN_TARBALL = "package/runtime-lock.json";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const isFirstParty = (name) => name.startsWith(SCOPE_PREFIX);

// ── argv (D1) ──────────────────────────────────────────────────────────────

/**
 * Parse the bundle script's release-lock argv.
 *
 * Exactly one form is accepted: `--release-lock=<version>`. Throws (message
 * names the misuse) for a bare flag, a space-separated value, an empty value,
 * the flag combined with `--source-only`, or a value that differs from the
 * stamped server workspace version.
 *
 * @param {string[]} argv  `process.argv.slice(2)`
 * @param {{ serverVersion: string }} ctx
 * @returns {{ mode: "floating" } | { mode: "release-lock", version: string }}
 */
export function parseReleaseLockArgs(argv, { serverVersion }) {
  const flags = argv.filter((a) => a === "--release-lock" || a.startsWith("--release-lock="));
  if (flags.length === 0) return { mode: "floating" };
  if (flags.length > 1) throw new Error(`--release-lock given ${flags.length} times (${flags.join(" ")}); pass it exactly once`);
  const arg = flags[0];
  if (arg === "--release-lock") {
    throw new Error(
      "--release-lock needs the form --release-lock=<version> (bare flag or space-separated value refused)",
    );
  }
  const version = arg.slice("--release-lock=".length);
  if (version === "") throw new Error("--release-lock= has an empty version");
  if (argv.includes("--source-only")) {
    throw new Error("--release-lock cannot be combined with --source-only (source-only installs nothing)");
  }
  if (version !== serverVersion) {
    throw new Error(
      `--release-lock=${version} differs from the server workspace version ${serverVersion} (version stamping must precede the bundle)`,
    );
  }
  return { mode: "release-lock", version };
}

// ── workspaces ────────────────────────────────────────────────────────────

/**
 * `const BUNDLED_WORKSPACE_PKGS = [ ... ]` directory names from
 * `bundle-server.mjs` (same regex `bundle-watch-paths.mjs` uses), so the lock
 * lint and the bundle share the one list.
 */
export function readBundledWorkspaceDirs(repoRoot) {
  const src = readFileSync(path.join(repoRoot, "packages", "electron", "scripts", "bundle-server.mjs"), "utf8");
  const block = /const BUNDLED_WORKSPACE_PKGS\s*=\s*\[([\s\S]*?)\]/.exec(src);
  if (!block) throw new Error("BUNDLED_WORKSPACE_PKGS not found in bundle-server.mjs");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Directory names (`bus-client`) → package names
 * (`@blackbelt-technology/pi-dashboard-bus-client`) read from each
 * `packages/<dir>/package.json`. Returns `Map<name, { dir, manifest }>`.
 */
export function readBundledWorkspaces(repoRoot, dirs) {
  const out = new Map();
  for (const dir of dirs) {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, "packages", dir, "package.json"), "utf8"));
    if (typeof manifest.name !== "string") throw new Error(`packages/${dir}/package.json has no name`);
    out.set(manifest.name, { dir, manifest });
  }
  return out;
}

// ── rebase (D3) ───────────────────────────────────────────────────────────

/** `loopback http` is allowed: the nightly lock is generated against a Verdaccio. */
function isAllowedTarballSource(resolved) {
  if (typeof resolved !== "string" || resolved === "") return false;
  let url;
  try {
    url = new URL(resolved);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

function assertThirdPartyEntry(key, entry) {
  if (entry.link) return;
  // Bundled inside its parent package's tarball: no `resolved`/`integrity` of
  // its own; the parent's integrity covers it.
  if (entry.inBundle === true) return;
  if (typeof entry.integrity !== "string" || entry.integrity === "") {
    throw new Error(`runtime lock entry ${key} has no integrity (npm ci would install it unverified)`);
  }
  if (!isAllowedTarballSource(entry.resolved)) {
    throw new Error(
      `runtime lock entry ${key} resolves to ${JSON.stringify(entry.resolved)} — only https tarball URLs (or loopback http) are allowed`,
    );
  }
}

/** `node_modules/@scope/name/rest…` → `{ owner: "@scope/name", rest: "/rest…" }`. */
function splitKey(key) {
  const m = /^node_modules\/((?:@[^/]+\/)?[^/]+)(\/.*)?$/.exec(key);
  if (!m) throw new Error(`unexpected runtime lock key ${JSON.stringify(key)}`);
  return { owner: m[1], rest: m[2] ?? "" };
}

const WORKSPACE_ENTRY_FIELDS = [
  "version",
  "license",
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
];

function workspaceEntry(manifest) {
  const entry = {};
  for (const field of WORKSPACE_ENTRY_FIELDS) {
    if (manifest[field] !== undefined) entry[field] = manifest[field];
  }
  return entry;
}

function thirdPartyRootDeps(root) {
  const out = {};
  for (const [dep, spec] of Object.entries(root?.dependencies ?? {})) {
    if (!isFirstParty(dep)) out[dep] = spec;
  }
  return out;
}

/**
 * Rebase the published runtime lock onto the bundle's workspace layout.
 *
 * Rules apply per lock key, by the package that owns the key's top-level
 * `node_modules/<name>` segment; the first match wins:
 *   1. bundled workspace → link to `packages/<dir>` (+ a `packages/<dir>`
 *      entry from the bundled manifest; nested entries re-keyed under it);
 *   2. `pi-dashboard-web` → removed (materialized from local `packages/client`);
 *   3. bundled plugin that is not a workspace → removed (copied locally);
 *   4. any other `@blackbelt-technology/*` → throw (unmapped first-party);
 *   5. third-party → kept verbatim; throws without integrity / on a non-https
 *      source (loopback http allowed; `inBundle` entries exempt);
 *   6. root → synthetic name, version X, bundle workspaces, plugin union.
 *
 * @param {object} published  parsed `runtime-lock.json`
 * @param {{
 *   workspaces: Map<string, { dir: string, manifest: object }>,
 *   bundledPlugins: Set<string>,
 *   pluginUnion: Record<string, string>,
 *   version: string,
 *   rootName?: string,
 * }} ctx
 * @returns {{ lock: object, stats: { linked: number, dropped: number, thirdParty: number } }}
 */
export function rebaseRuntimeLock(published, { workspaces, bundledPlugins, pluginUnion, version, rootName = SYNTHETIC_ROOT_NAME }) {
  const pubRoot = published?.packages?.[""];
  if (!pubRoot || typeof published.packages !== "object") throw new Error("runtime lock has no root entry");
  if (pubRoot.version !== version) {
    throw new Error(`runtime lock root is ${pubRoot.version ?? "missing"}, expected ${version}`);
  }
  assertUnionParity(thirdPartyRootDeps(pubRoot), pluginUnion);

  const out = {};
  const stats = { linked: 0, dropped: 0, thirdParty: 0 };

  // Rule 1 (also for a workspace with no entry in the published lock): link +
  // workspace entry, written from the bundled manifests.
  for (const [name, { dir, manifest }] of workspaces) {
    out[`node_modules/${name}`] = { resolved: `packages/${dir}`, link: true };
    out[`packages/${dir}`] = workspaceEntry(manifest);
    stats.linked += 1;
  }

  for (const [key, entry] of Object.entries(published.packages)) {
    if (key !== "") rebaseEntry(key, entry, { workspaces, bundledPlugins }, out, stats);
  }

  const wsDirs = [...workspaces.values()].map((w) => `packages/${w.dir}`);
  const packages = {
    "": { name: rootName, version, workspaces: wsDirs, dependencies: { ...pluginUnion } },
  };
  for (const key of Object.keys(out).sort((x, y) => x.localeCompare(y, "en"))) packages[key] = out[key];

  return {
    lock: { name: rootName, version, lockfileVersion: published.lockfileVersion ?? 3, requires: true, packages },
    stats,
  };
}

/** Rules 1–5 for one non-root lock entry; writes into `out`, counts into `stats`. */
function rebaseEntry(key, entry, { workspaces, bundledPlugins }, out, stats) {
  const { owner, rest } = splitKey(key);
  if (!isFirstParty(owner)) {
    assertThirdPartyEntry(key, entry);
    out[key] = entry;
    stats.thirdParty += 1;
    return;
  }
  const ws = workspaces.get(owner);
  if (ws) {
    // Rule 1: the top entry was already written as a link; keep nested entries, re-keyed.
    if (rest !== "") {
      assertThirdPartyEntry(key, entry);
      out[`packages/${ws.dir}${rest}`] = entry;
    }
  } else if (owner === WEB_PACKAGE || bundledPlugins.has(owner)) {
    stats.dropped += 1; // rules 2 and 3
  } else {
    throw new Error(`unmapped first-party package in runtime lock: ${owner} (${key})`); // rule 4
  }
}

/** Rule 6 precondition: the lock's root third-party set equals the bundle's union. */
function assertUnionParity(lockUnion, pluginUnion) {
  const names = [...new Set([...Object.keys(lockUnion), ...Object.keys(pluginUnion)])].sort();
  const differing = names.filter((n) => lockUnion[n] !== pluginUnion[n]);
  if (differing.length > 0) {
    throw new Error(
      `runtime lock root third-party dependencies differ from the bundle's plugin union: ${differing
        .map((n) => `${n} (lock ${lockUnion[n] ?? "absent"}, bundle ${pluginUnion[n] ?? "absent"})`)
        .join(", ")}`,
    );
  }
}

// ── audit (D4) ────────────────────────────────────────────────────────────

/**
 * Verify the installed tree against the rebased lock — what `npm ci` does not
 * check. Run right after `npm ci`, BEFORE workspace links are materialized.
 *
 * Fails when: an installed third-party package is not in the lock at that key
 * with that version (absence is never an error: pruned / dev / other-platform
 * entries are expected); an `@blackbelt-technology/*` entry is not a symlink to
 * `packages/<dir>`; any `packages/<dir>/node_modules` exists.
 *
 * @param {{ bundleDir: string, lock: object, workspaces: Map<string, { dir: string }> }} args
 * @returns {{ thirdParty: number, firstParty: number, lockEntries: number }}
 */
export function auditInstalledTree({ bundleDir, lock, workspaces }) {
  const problems = [];
  const counts = { thirdParty: 0, firstParty: 0 };

  for (const { dir } of workspaces.values()) {
    if (existsSync(path.join(bundleDir, "packages", dir, "node_modules"))) {
      problems.push(`packages/${dir}/node_modules exists (nested workspace dependency would be dropped when workspaces are materialized)`);
    }
  }

  /** Audit one installed package dir; true => descend into its nested node_modules. */
  const checkPackage = (pkgDir, key, name) => {
    if (isFirstParty(name)) {
      const problem = firstPartyLinkProblem(bundleDir, pkgDir, key, name, workspaces);
      if (problem) problems.push(problem);
      else counts.firstParty += 1;
      return false; // never descend into a first-party link
    }
    const installed = readInstalledVersion(pkgDir);
    if (installed === null) return true; // not a package dir — nothing to audit
    const locked = lock.packages[key];
    if (!locked) problems.push(`${name}@${installed} at ${key} is not in the lock`);
    else if (locked.version !== installed) problems.push(`${name}@${installed} at ${key} but the lock pins ${locked.version}`);
    else counts.thirdParty += 1;
    return !lstatSync(pkgDir).isSymbolicLink();
  };

  const walk = (nmDir, keyPrefix) => {
    for (const [name, pkgDir] of listInstalledPackages(nmDir)) {
      const key = `${keyPrefix}node_modules/${name}`;
      if (checkPackage(pkgDir, key, name)) walk(path.join(pkgDir, "node_modules"), `${key}/`);
    }
  };
  walk(path.join(bundleDir, "node_modules"), "");

  if (problems.length > 0) {
    throw new Error(`installed tree does not match the runtime lock:\n  ${problems.join("\n  ")}`);
  }
  return { ...counts, lockEntries: Object.keys(lock.packages).length - 1 };
}

/** `[name, dir]` for every package directly under `nmDir` (scopes flattened, dot entries skipped). */
function listInstalledPackages(nmDir) {
  let entries;
  try {
    entries = readdirSync(nmDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.name.startsWith("@")) {
      for (const child of readdirSync(path.join(nmDir, e.name))) out.push([`${e.name}/${child}`, path.join(nmDir, e.name, child)]);
    } else {
      out.push([e.name, path.join(nmDir, e.name)]);
    }
  }
  return out;
}

function readInstalledVersion(pkgDir) {
  try {
    return JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

/** Null when `pkgDir` is a link (symlink / junction) to its bundled workspace; else the problem text. */
function firstPartyLinkProblem(bundleDir, pkgDir, key, name, workspaces) {
  const ws = workspaces.get(name);
  const bad = `${name} at ${key} is not a symlink to its bundled workspace (first-party package must not come from the registry)`;
  if (!ws) return bad;
  // realpath equality proves a link (a real copy resolves to itself, never to
  // packages/<dir>); this also holds for Windows junctions.
  try {
    return realpathSync(pkgDir) === realpathSync(path.join(bundleDir, "packages", ws.dir)) ? null : bad;
  } catch {
    return bad;
  }
}

// ── temporary lock file lifecycle ─────────────────────────────────────────

/**
 * Run `fn` with `file` as a temporary `package-lock.json`: removed first (stale
 * leftovers) and ALWAYS removed afterwards, success or throw. Callers that exit
 * the process on failure must do so AFTER this returns/throws — `process.exit`
 * inside `fn`'s try block would skip the cleanup.
 */
export async function withTempLockFile(file, fn) {
  rmSync(file, { force: true });
  try {
    return await fn();
  } finally {
    rmSync(file, { force: true });
  }
}

// ── fetch (D2) ────────────────────────────────────────────────────────────

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32" && cmd === "npm.cmd", ...opts });
  if (r.error) throw r.error;
  return r;
}

/** Default I/O: `npm pack` + system `tar` (bsdtar / GNU tar). */
export function createFetchDeps({ env = process.env } = {}) {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  return {
    pack(spec, destDir) {
      const r = run(npmCmd, ["pack", spec, "--pack-destination", destDir, "--prefer-online", "--ignore-scripts"], {
        cwd: destDir,
        env,
      });
      if (r.status !== 0) throw new Error(`npm pack ${spec} exited ${r.status}: ${String(r.stderr ?? "").trim().split(/\r?\n/).slice(-3).join(" | ")}`);
      const tgz = readdirSync(destDir).filter((f) => f.endsWith(".tgz"));
      if (tgz.length !== 1) throw new Error(`npm pack ${spec} produced ${tgz.length} tarballs`);
      return path.join(destDir, tgz[0]);
    },
    listArchive(tgz) {
      const names = run("tar", ["-tzf", tgz]);
      const verbose = run("tar", ["-tvzf", tgz]);
      if (names.status !== 0 || verbose.status !== 0) throw new Error(`tar could not list ${tgz}`);
      return { names: String(names.stdout), verbose: String(verbose.stdout) };
    },
    extractMember(tgz, member, destDir) {
      const r = run("tar", ["-xzf", tgz, "-C", destDir, member]);
      if (r.status !== 0) throw new Error(`tar could not extract ${member}: ${String(r.stderr ?? "").trim()}`);
      return readFileSync(path.join(destDir, member), "utf8");
    },
  };
}

/**
 * Fetch `server@X`'s `runtime-lock.json` fail-closed: bounded retry on `npm
 * pack` (stale packument right after a publish), safe archive extraction (no
 * absolute / `..` / link members), the lock must exist and be for X. Throws —
 * never returns a fallback.
 *
 * @param {{ version: string, deps?: ReturnType<typeof createFetchDeps>, attempts?: number, backoffMs?: number, sleep?: (ms: number) => Promise<void>, tmpRoot?: string }} args
 * @returns {Promise<object>} parsed lock
 */
export async function fetchPublishedLock({
  version,
  deps = createFetchDeps(),
  attempts = 3,
  backoffMs = 5_000,
  sleep = sleepMs,
  tmpRoot = tmpdir(),
}) {
  const spec = `${SERVER_PACKAGE}@${version}`;
  const work = mkdtempSync(path.join(tmpRoot, "release-lock-"));
  try {
    const tgz = await packWithRetry({ spec, work, deps, attempts, backoffMs, sleep });
    const lock = readLockFromTarball({ spec, tgz, work, deps });
    const rootVersion = lock?.packages?.[""]?.version;
    if (rootVersion !== version) {
      throw new Error(`${spec} carries a runtime lock for ${rootVersion ?? "no version"}, expected ${version}`);
    }
    return lock;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function packWithRetry({ spec, work, deps, attempts, backoffMs, sleep }) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return deps.pack(spec, work);
    } catch (err) {
      lastErr = err;
      if (i < attempts) await sleep(backoffMs * i);
    }
  }
  throw new Error(`could not fetch ${spec} after ${attempts} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

/** Safe-list the archive, require the lock member, parse it. */
function readLockFromTarball({ spec, tgz, work, deps }) {
  const { names, verbose } = deps.listArchive(tgz);
  const members = assertSafeArchiveListing(names, verbose);
  if (!members.includes(LOCK_FILE_IN_TARBALL)) {
    throw new Error(`${spec} ships no runtime-lock.json (${LOCK_FILE_IN_TARBALL} absent from the tarball)`);
  }
  try {
    return JSON.parse(deps.extractMember(tgz, LOCK_FILE_IN_TARBALL, work));
  } catch (err) {
    throw new Error(`${spec} runtime-lock.json is unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }
}
