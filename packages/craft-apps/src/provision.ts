/**
 * Provision the headless CLI (`<app>-cli`) of any ArtCraft Crafting App for the host.
 *
 * Resolve the release (override → pin → latest), map host → asset from the
 * registry, verify the asset against `SHA256SUMS.txt` (fail closed),
 * list-then-extract into a staging dir, and move the tree to
 * `<cache root>/<app>/<version>/`. `CRAFT_SOURCE` selects release provisioning
 * (`managed`, default), an ArtCraft Craft Launcher install (`launcher`) or both
 * (`auto`). Every external effect (fetch, clock, env, platform, exec, C-library
 * probe) is an injectable seam.
 *
 * `provisionWeb` installs the browser build `<app>-web-<ver>.zip` of an app through the same install core
 * into `<root>/<app>-web/<key>/` and points `current` at it (never touches the CLI cache).
 *
 * See change: add-photocraft-plugin (design D1–D4), add-craft-apps-core (D2, D3),
 * edit-office-in-pane-with-craft-web (D2).
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFileAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { launcherBinary } from "./launcher.js";
import { binName, type CraftApp, type CraftAppId, desktopName, envPrefix, getApp, hostKey } from "./registry.js";
import { extractZip, listZip } from "./zip-guard.js";

export const API_BASE = "https://api.github.com";
const LATEST_TTL_MS = 24 * 60 * 60 * 1000;
const STALE_STAGING_MS = 60 * 60 * 1000;
const SUMS_NAME = "SHA256SUMS.txt";

export type ProvisionSource = "override" | "pin" | "latest" | "latest-cached" | "fallback-installed" | "launcher";

export interface ProvisionReport {
  app: CraftAppId;
  version: string | null;
  source: ProvisionSource;
  asset: string | null;
  cacheHit: boolean;
  binary: string;
  durationMs: number;
  /** macOS install only: result of `spctl --assess --type install` (advisory). */
  gatekeeper?: "accepted" | "rejected";
}

/** Provisioning failure; the CLI maps it to exit code 69. */
export class ProvisionError extends Error {
  override name = "ProvisionError";
}

export type ExecFn = (
  file: string,
  args: string[],
  opts?: { timeout?: number; maxBuffer?: number },
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

export interface ProvisionDeps {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  arch: string;
  fetch: typeof fetch;
  now: () => number;
  homedir: () => string;
  exec: ExecFn;
  /** glibc version string, or undefined when the libc is not glibc (musl). */
  glibcVersion: () => string | undefined;
  /** Diagnostics: always stderr in the CLI (stdout may be an MCP channel). */
  log: (message: string) => void;
  apiBase: string;
  /** Override only: run `<bin> --version` to fill `report.version`. */
  probeVersion: boolean;
  randomId: () => string;
}

export function defaultDeps(): ProvisionDeps {
  return {
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    fetch: (...a) => fetch(...a),
    now: () => Date.now(),
    homedir: () => os.homedir(),
    exec: (file, args, opts) => execFileAsync(file, args, { maxBuffer: 64 * 1024 * 1024, ...opts }),
    glibcVersion: () => {
      const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
      return report?.header?.glibcVersionRuntime;
    },
    log: (m) => process.stderr.write(`${m}\n`),
    apiBase: API_BASE,
    probeVersion: false,
    randomId: () => Math.random().toString(36).slice(2, 10),
  };
}

// ── Host → asset ────────────────────────────────────────────────────────────

/** Candidate asset names for the host, most preferred first (CLI-only before portable). */
export function assetCandidates(app: CraftApp, platform: string, arch: string, version: string): string[] {
  const key = hostKey(platform, arch);
  const patterns = key ? app.assets[key] : undefined;
  if (!patterns?.length) {
    throw new ProvisionError(
      `unsupported platform: ${platform}/${arch} has no ${app.name} CLI release asset; set ${envPrefix(app)}_BIN to a self-built ${app.cli}`,
    );
  }
  return patterns.map((p) => p.replaceAll("{v}", version));
}

/** Default (most preferred) asset name for the host. */
export function assetFor(app: CraftApp, platform: string, arch: string, version: string): string {
  return assetCandidates(app, platform, arch, version)[0];
}

/** Linux only: the app links glibc symbols at its floor version; musl cannot run it. */
function assertLibc(app: CraftApp, deps: ProvisionDeps): void {
  if (deps.platform !== "linux") return;
  const [fMaj, fMin] = app.glibcMin;
  const floor = `${fMaj}.${fMin}`;
  const hint = `Set ${envPrefix(app)}_BIN to a compatible ${app.cli}`;
  const v = deps.glibcVersion();
  if (v === undefined) {
    throw new ProvisionError(`unsupported C library: musl (not glibc); the ${app.name} CLI needs glibc ≥ ${floor}. ${hint}`);
  }
  const [maj, min] = v.split(".").map((n) => Number.parseInt(n, 10));
  if (maj < fMaj || (maj === fMaj && (min ?? 0) < fMin)) {
    throw new ProvisionError(`unsupported C library: glibc ${v}; the ${app.name} CLI needs glibc ≥ ${floor}. ${hint}`);
  }
}

// ── Paths, versions ─────────────────────────────────────────────────────────

/** Cache root shared by all apps: `CRAFT_HOME`, else `<pi agent dir>/tools`. */
export function craftRoot(deps: Pick<ProvisionDeps, "env" | "homedir">): string {
  if (deps.env.CRAFT_HOME) return path.resolve(deps.env.CRAFT_HOME);
  const agentDir = deps.env.PI_CODING_AGENT_DIR || path.join(deps.homedir(), ".pi", "agent");
  return path.join(agentDir, "tools");
}

/** Per-app cache directory `<root>/<app>`; for PhotoCraft `PHOTOCRAFT_HOME`, when set, is that directory (back-compat). */
export function cacheRoot(app: CraftApp, deps: Pick<ProvisionDeps, "env" | "homedir">): string {
  if (app.id === "photocraft" && deps.env.PHOTOCRAFT_HOME) return path.resolve(deps.env.PHOTOCRAFT_HOME);
  return path.join(craftRoot(deps), app.id);
}

/** Strip one leading `v`; reject anything that cannot be a safe single path segment. */
export function normaliseVersion(raw: string, appName = "craft app"): string {
  const v = raw.trim().replace(/^v/, "");
  if (!/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(v) || v.includes("..")) {
    throw new ProvisionError(`invalid ${appName} version "${raw}"`);
  }
  return v;
}

function semverParts(v: string): number[] {
  return v.split(/[.+-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
}

export function compareSemver(a: string, b: string): number {
  const pa = semverParts(a);
  const pb = semverParts(b);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

// ── Binary validation / lookup ──────────────────────────────────────────────

/** Regular, non-empty, executable file (execute bit is not meaningful on Windows). */
function validBinary(file: string, platform: string): boolean {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size === 0) return false;
    return platform === "win32" || (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function subdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "__MACOSX")
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Walk for files named `name`, skipping `__MACOSX`. */
function findByBasename(dir: string, name: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === "__MACOSX") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findByBasename(p, name, out);
    else if (e.isFile() && e.name === name) out.push(p);
  }
  return out;
}

/**
 * Locate the CLI binary in an extracted tree: the platform's known relative
 * location (at the root, or under the archive's single top-level directory),
 * else the single file with that basename. Returns undefined for zero matches
 * and throws for more than one.
 */
export function locateBinary(app: CraftApp, tree: string, platform: string, assetName: string): string | undefined {
  const name = binName(app, platform);
  // Known location: tarballs (linux/freebsd) ship `<root>/bin/<cli>`; the macOS and Windows zips `<root>/<cli>`.
  const rel = platform === "linux" || platform === "freebsd" ? path.join("bin", name) : name;
  // `<root>` is the extraction dir itself or the archive's single top-level directory.
  for (const base of [tree, ...subdirs(tree).map((d) => path.join(tree, d))]) {
    const p = path.join(base, rel);
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      /* next candidate */
    }
  }
  const found = findByBasename(tree, name);
  if (found.length > 1) {
    throw new ProvisionError(`ambiguous archive: ${found.length} files named ${name} in ${assetName}`);
  }
  return found[0];
}

// ── Checksums ───────────────────────────────────────────────────────────────

/** Exactly one `<64-hex> [*]name` entry for `assetName`; returns the lower-cased digest. */
export function parseSums(text: string, assetName: string): string {
  const digests: string[] = [];
  for (const raw of text.split("\n")) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(?:\.\/)?(.+?)\s*$/.exec(raw.replace(/\r$/, ""));
    if (m && m[2] === assetName) digests.push(m[1].toLowerCase());
  }
  if (digests.length === 0) throw new ProvisionError(`${SUMS_NAME} has no entry for ${assetName}`);
  if (digests.length > 1) throw new ProvisionError(`${SUMS_NAME} has ${digests.length} entries for ${assetName}`);
  return digests[0];
}

// ── Archive listing guard ───────────────────────────────────────────────────

const MODE_RE = /^[-dlhcbps][-rwxsStTl+@.]{9}/;

/** Reject absolute, `..`, and non-file/non-directory entries before anything is extracted. */
export function assertSafeListing(names: string[], verbose: string[]): void {
  if (names.length !== verbose.length) {
    throw new ProvisionError(
      `archive listing mismatch (${names.length} names vs ${verbose.length} detailed entries); refusing to extract`,
    );
  }
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const line = verbose[i];
    if (!MODE_RE.test(line)) throw new ProvisionError("archive listing not understood; refusing to extract");
    const type = line[0];
    if (type !== "-" && type !== "d") {
      throw new ProvisionError(`archive entry "${name}" is not a regular file or directory (type "${type}"); refusing to extract`);
    }
    const segments = name.split(/[\\/]/);
    if (name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/.test(name) || segments.includes("..")) {
      throw new ProvisionError(`archive entry "${name}" escapes the install directory; refusing to extract`);
    }
  }
}

function lines(out: string | Buffer): string[] {
  const text = out.toString();
  const l = text.split("\n").map((s) => s.replace(/\r$/, ""));
  while (l.length && l[l.length - 1] === "") l.pop();
  return l;
}

/**
 * System tool name for `platform`. On Windows the `.exe` suffix keeps the shared `platform/exec` wrapper from
 * routing the call through `cmd.exe /c` (which would interpret `&`, `|`, `^`, `%VAR%` in file arguments).
 */
export function exe(name: string, platform: string = process.platform): string {
  return platform === "win32" ? `${name}.exe` : name;
}

/** Reject anything in an extracted tree that is not a regular file or directory (defence in depth after the listing guard). */
export function assertTreeSafe(tree: string): void {
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const st = fs.lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (!st.isFile()) {
        throw new ProvisionError(`extracted entry "${path.relative(tree, p)}" is not a regular file or directory; refusing to install`);
      }
    }
  };
  walk(tree);
}

/** CLI list guard: `tar -tf` + `tar -tvf` must agree and show only regular files/directories under the install dir. */
async function listArchive(deps: ProvisionDeps, archive: string): Promise<void> {
  const tar = exe("tar", deps.platform);
  const names = lines((await deps.exec(tar, ["-tf", archive])).stdout);
  const verbose = lines((await deps.exec(tar, ["-tvf", archive])).stdout);
  assertSafeListing(names, verbose);
}

async function extractArchive(deps: ProvisionDeps, archive: string, dest: string): Promise<void> {
  if (deps.platform === "darwin") await deps.exec("ditto", ["-x", "-k", archive, dest]);
  else await deps.exec(exe("tar", deps.platform), ["-xf", archive, "-C", dest]);
}

// ── GitHub ──────────────────────────────────────────────────────────────────

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
}
export interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
}

const UA = "pi-craft";

export async function apiJson(deps: ProvisionDeps, url: string): Promise<Release> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": UA };
  if (deps.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${deps.env.GITHUB_TOKEN}`;
  let res: Response;
  try {
    res = await deps.fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new ProvisionError(`GitHub API request failed: ${(e as Error).message}`);
  }
  if (!res.ok) throw new ProvisionError(`GitHub API returned HTTP ${res.status} for ${url}`);
  return (await res.json()) as Release;
}

const MAX_SUMS_BYTES = 1024 * 1024;
const MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024;

export async function downloadText(deps: ProvisionDeps, url: string): Promise<string> {
  const res = await deps.fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new ProvisionError(`download of ${SUMS_NAME} failed: HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_SUMS_BYTES) throw new ProvisionError(`${SUMS_NAME} is larger than ${MAX_SUMS_BYTES} bytes; refusing`);
  return text;
}

/** Stream `url` to `dest`, hashing as it goes; returns the SHA-256 hex digest. */
export async function downloadFile(deps: ProvisionDeps, url: string, dest: string, maxBytes: number = MAX_ASSET_BYTES): Promise<string> {
  const res = await deps.fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15 * 60_000) });
  if (!res.ok || !res.body) throw new ProvisionError(`asset download failed: HTTP ${res.status} for ${url}`);
  const hash = createHash("sha256");
  let received = 0;
  await pipeline(
    Readable.fromWeb(res.body as never),
    async function* (src: AsyncIterable<Buffer>) {
      for await (const chunk of src) {
        received += chunk.length;
        if (received > maxBytes) throw new ProvisionError(`download exceeds ${maxBytes} bytes; aborting (${url})`);
        hash.update(chunk);
        yield chunk;
      }
    },
    fs.createWriteStream(dest),
  );
  return hash.digest("hex");
}

/**
 * Download `assetName` and `SHA256SUMS.txt` from `release` into `dest`, failing
 * closed: no sums file, no entry, or a digest mismatch aborts (the caller deletes
 * its staging dir). Shared by app provisioning and the launcher installer.
 */
export async function downloadVerified(deps: ProvisionDeps, release: Release, assetName: string, dest: string, repo?: string): Promise<void> {
  const tag = release.tag_name;
  const assetInfo = release.assets.find((a) => a.name === assetName);
  if (!assetInfo) throw new ProvisionError(`release ${tag} has no asset named ${assetName}`);
  const sumsInfo = release.assets.find((a) => a.name === SUMS_NAME);
  if (!sumsInfo) throw new ProvisionError(`release ${tag} has no ${SUMS_NAME}; refusing to install an unverified binary`);
  // Against the real GitHub API both URLs must stay on the repo's release-download path (tests use a loopback fixture).
  if (repo && deps.apiBase === API_BASE) {
    const prefix = `https://github.com/${repo}/releases/download/`;
    for (const info of [assetInfo, sumsInfo]) {
      if (!info.browser_download_url.startsWith(prefix)) {
        throw new ProvisionError(`release ${tag}: ${info.name} points outside ${prefix}; refusing`);
      }
    }
  }
  const expected = parseSums(await downloadText(deps, sumsInfo.browser_download_url), assetName);
  const size = assetInfo.size ? ` (${(assetInfo.size / 1048576).toFixed(0)} MB)` : "";
  deps.log(`[pi-craft] downloading ${tag} ${assetName}${size}`);
  // The advertised size bounds the stream (small slack); without it the 2 GiB cap applies.
  const cap = assetInfo.size ? assetInfo.size + 1024 * 1024 : MAX_ASSET_BYTES;
  const actual = await downloadFile(deps, assetInfo.browser_download_url, dest, cap);
  if (actual !== expected) {
    fs.rmSync(dest, { force: true });
    throw new ProvisionError(`checksum mismatch for ${assetName}: expected ${expected}, got ${actual}`);
  }
}

// ── Version resolution ──────────────────────────────────────────────────────

interface Resolved {
  version: string;
  source: ProvisionSource;
  release?: Release;
}

export function readLatestCache(root: string, now: number): string | undefined {
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(root, "latest.json"), "utf8")) as { tag?: unknown; checkedAt?: unknown };
    if (typeof rec.tag !== "string" || typeof rec.checkedAt !== "number") return undefined;
    if (rec.checkedAt > now || now - rec.checkedAt >= LATEST_TTL_MS) return undefined;
    return rec.tag;
  } catch {
    return undefined;
  }
}

export function installedVersions(app: CraftApp, root: string, platform: string): string[] {
  return subdirs(root)
    .filter((d) => /^\d+\.\d+\.\d+[0-9A-Za-z._+-]*$/.test(d) && !d.includes(".."))
    .filter((d) => cachedBinary(app, path.join(root, d), platform) !== undefined)
    .sort((a, b) => compareSemver(b, a));
}

async function resolveVersion(app: CraftApp, deps: ProvisionDeps, root: string): Promise<Resolved> {
  const prefix = envPrefix(app);
  const pin = deps.env[`${prefix}_VERSION`]?.trim();
  if (pin) return { version: normaliseVersion(pin, app.name), source: "pin" };

  const cached = readLatestCache(root, deps.now());
  if (cached) return { version: normaliseVersion(cached, app.name), source: "latest-cached" };

  try {
    const release = await apiJson(deps, `${deps.apiBase}/repos/${app.repo}/releases/latest`);
    const version = normaliseVersion(release.tag_name, app.name);
    try {
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, "latest.json"), JSON.stringify({ tag: release.tag_name, checkedAt: deps.now() }));
    } catch {
      /* cache is best-effort */
    }
    return { version, source: "latest", release };
  } catch (e) {
    const reason = (e as Error).message;
    const installed = installedVersions(app, root, deps.platform);
    if (installed.length > 0) {
      deps.log(`[pi-craft] warning: ${app.id}: latest-release lookup failed (${reason}); using installed ${installed[0]}`);
      return { version: installed[0], source: "fallback-installed" };
    }
    throw new ProvisionError(
      `${reason}. No ${app.name} version is installed; set GITHUB_TOKEN (rate limit), ${prefix}_VERSION to pin a release, or ${prefix}_BIN to an existing ${app.cli}`,
    );
  }
}

// ── Override ────────────────────────────────────────────────────────────────

/** Run `<bin> --version` and pull the first `x.y.z` out of it. */
async function probeBinaryVersion(deps: ProvisionDeps, bin: string): Promise<string | null> {
  try {
    const out = (await deps.exec(bin, ["--version"], { timeout: 10_000 })).stdout.toString();
    return /\b(\d+\.\d+\.\d+[^\s]*)/.exec(out)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function overrideReport(app: CraftApp, deps: ProvisionDeps, started: number): Promise<ProvisionReport> {
  const varName = `${envPrefix(app)}_BIN`;
  const bin = deps.env[varName] as string;
  let reason: string | undefined;
  try {
    const st = fs.statSync(bin);
    if (!st.isFile()) reason = "not a file";
    else if (deps.platform !== "win32" && (st.mode & 0o111) === 0) reason = "not executable";
  } catch {
    reason = "not found";
  }
  if (reason) throw new ProvisionError(`${varName}=${bin}: ${reason}`);
  const version = deps.probeVersion ? await probeBinaryVersion(deps, bin) : null;
  return { app: app.id, version, source: "override", asset: null, cacheHit: false, binary: path.resolve(bin), durationMs: deps.now() - started };
}

// ── Shared install core ─────────────────────────────────────────────────────

const inflight = new Map<string, Promise<unknown>>();

/** In-process single-flight: concurrent callers with the same `key` share one run (and its result). */
export function singleFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  if (inflight.has(key)) return inflight.get(key) as Promise<T>;
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

export interface InstallVerifiedOptions<T> {
  deps: ProvisionDeps;
  /** `storytold/<id>`; pins the download URLs to the repo's release path. */
  repo: string;
  asset: string;
  release: Release;
  /** Directory that holds the staging dirs (the target's parent). */
  cacheDir: string;
  /** Final target; created by an atomic rename of the validated staging tree. */
  finalDir: string;
  /** List guard: inspect the archive and throw before anything is extracted. */
  list: (archive: string) => void | Promise<void>;
  extract: (archive: string, dest: string) => void | Promise<void>;
  /** Runs on the extracted, `assertTreeSafe`-checked tree; may finalize it in place. Its result is returned as `value`. */
  validate: (tree: string) => T | Promise<T>;
  /** Race branch: is the tree another process put at `finalDir` usable? */
  verifyExisting: (dir: string) => boolean;
}

export interface InstallResult<T> {
  /** `true`: another process installed `finalDir` first and `verifyExisting` accepted it; `value` is then undefined. */
  raced: boolean;
  value: T | undefined;
}

/**
 * Download-verified → list guard → extract into staging → `assertTreeSafe` → validate → atomic rename.
 * Staging is always removed. Single-flight per `finalDir` within the process. Shared by the CLI install
 * (tar listing, `locateBinary` validation) and the web-build install (zip-native list guard).
 */
export function installVerified<T>(o: InstallVerifiedOptions<T>): Promise<InstallResult<T>> {
  return singleFlight(`install:${o.finalDir}`, async () => {
    const staging = path.join(o.cacheDir, `.staging-${process.pid}-${o.deps.randomId()}`);
    try {
      const tree = path.join(staging, "tree");
      fs.mkdirSync(tree, { recursive: true });
      const archive = path.join(staging, o.asset);
      await downloadVerified(o.deps, o.release, o.asset, archive, o.repo);
      await o.list(archive);
      await o.extract(archive, tree);
      assertTreeSafe(tree);
      const value = await o.validate(tree);
      const raced = commitTree(tree, o.finalDir, o.verifyExisting);
      return { raced, value: raced ? undefined : value };
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  });
}

// ── Provision ───────────────────────────────────────────────────────────────

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

function cachedBinary(app: CraftApp, dir: string, platform: string): string | undefined {
  try {
    const bin = locateBinary(app, dir, platform, path.basename(dir));
    return bin && validBinary(bin, platform) ? bin : undefined;
  } catch {
    return undefined;
  }
}

/** Marker written beside an install so a cache hit can report which asset produced it. */
const ASSET_MARKER = ".pi-craft-asset";

function readAssetMarker(versionDir: string): string | undefined {
  try {
    return fs.readFileSync(path.join(versionDir, ASSET_MARKER), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

export type CraftSource = "managed" | "launcher" | "auto";

export function craftSource(env: NodeJS.ProcessEnv): CraftSource {
  const raw = env.CRAFT_SOURCE?.trim().toLowerCase();
  if (!raw) return "managed";
  if (raw === "managed" || raw === "launcher" || raw === "auto") return raw;
  throw new ProvisionError(`invalid CRAFT_SOURCE "${env.CRAFT_SOURCE}"; use managed, launcher or auto`);
}

async function launcherReport(app: CraftApp, deps: ProvisionDeps, started: number): Promise<ProvisionReport | string> {
  const found = launcherBinary(app, deps);
  if (found.binary === undefined) return found.reason;
  let out: string;
  try {
    out = (await deps.exec(found.binary, ["--version"], { timeout: 10_000 })).stdout.toString();
  } catch {
    return `${app.cli} at ${found.binary} does not run --version`;
  }
  const version = /\b(\d+\.\d+\.\d+[^\s]*)/.exec(out)?.[1] ?? null;
  return { app: app.id, version, source: "launcher", asset: null, cacheHit: false, binary: found.binary, durationMs: deps.now() - started };
}

/** Provision `app` (a registry row or an app id). Unknown ids fail before any I/O. */
export async function provision(appOrId: CraftApp | string, partial: Partial<ProvisionDeps> = {}): Promise<ProvisionReport> {
  const app = typeof appOrId === "string" ? getApp(appOrId) : appOrId;
  const deps: ProvisionDeps = { ...defaultDeps(), ...partial };
  const started = deps.now();

  if (deps.env[`${envPrefix(app)}_BIN`]) return overrideReport(app, deps, started);

  const source = craftSource(deps.env);
  if (source === "launcher" || source === "auto") {
    const viaLauncher = await launcherReport(app, deps, started);
    if (typeof viaLauncher !== "string") {
      const pin = deps.env[`${envPrefix(app)}_VERSION`]?.trim();
      if (pin) deps.log(`[pi-craft] ${app.id}: ${envPrefix(app)}_VERSION=${pin} is ignored by the launcher source (it uses the launcher-installed CLI)`);
      return viaLauncher;
    }
    if (source === "launcher") {
      throw new ProvisionError(
        `${viaLauncher}; the launcher source never downloads — install ${app.name} with the launcher (\`pi-craft launcher install\`) or set CRAFT_SOURCE=managed`,
      );
    }
    deps.log(`[pi-craft] ${app.id}: ${viaLauncher}; falling back to managed provisioning`);
  }
  return provisionManaged(app, deps, started);
}

async function provisionManaged(app: CraftApp, deps: ProvisionDeps, started: number): Promise<ProvisionReport> {
  // Host checks run before any network request.
  assetCandidates(app, deps.platform, deps.arch, "0.0.0");
  assertLibc(app, deps);

  const root = cacheRoot(app, deps);
  fs.mkdirSync(root, { recursive: true });
  sweepStaleStaging(root, deps.now());

  const resolved = await resolveVersion(app, deps, root);
  const { version } = resolved;
  const candidates = assetCandidates(app, deps.platform, deps.arch, version);
  const versionDir = path.join(root, version);

  const report = (binary: string, cacheHit: boolean, asset: string): ProvisionReport => ({
    app: app.id,
    version,
    source: resolved.source,
    asset,
    cacheHit,
    binary,
    durationMs: deps.now() - started,
  });

  if (fs.existsSync(versionDir)) {
    const hit = cachedBinary(app, versionDir, deps.platform);
    if (hit) return report(hit, true, readAssetMarker(versionDir) ?? candidates[candidates.length - 1]);
    deps.log(`[pi-craft] cache entry ${versionDir} is damaged; re-provisioning`);
    fs.rmSync(versionDir, { recursive: true, force: true });
  }

  const tag = `v${version}`;
  const release = resolved.release ?? (await apiJson(deps, `${deps.apiBase}/repos/${app.repo}/releases/tags/${tag}`));
  const asset = candidates.find((c) => release.assets.some((a) => a.name === c));
  if (!asset) throw new ProvisionError(`release ${tag} has no asset named ${candidates.join(" or ")}`);

  const installed = await installVerified<string>({
    deps,
    repo: app.repo,
    asset,
    release,
    cacheDir: root,
    finalDir: versionDir,
    list: (archive) => listArchive(deps, archive),
    extract: (archive, dest) => extractArchive(deps, archive, dest),
    validate: (tree) => {
      const located = locateBinary(app, tree, deps.platform, asset);
      if (!located) throw new ProvisionError(`no ${binName(app, deps.platform)} found in ${asset}`);
      const rel = path.relative(tree, located);
      fs.chmodSync(located, 0o755);
      fs.rmSync(path.join(path.dirname(located), desktopName(app, deps.platform)), { force: true });
      fs.writeFileSync(path.join(tree, ASSET_MARKER), `${asset}\n`);
      return rel;
    },
    verifyExisting: (dir) => cachedBinary(app, dir, deps.platform) !== undefined,
  });
  const binary = installed.raced ? (cachedBinary(app, versionDir, deps.platform) as string) : path.join(versionDir, installed.value as string);
  const out = report(binary, false, asset);
  if (deps.platform === "darwin") {
    try {
      await deps.exec("spctl", ["--assess", "--type", "install", binary]);
      out.gatekeeper = "accepted";
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        out.gatekeeper = "rejected";
        deps.log(`[pi-craft] warning: Gatekeeper rejected ${binary} (checksum verified; authenticity not claimed)`);
      }
    }
  }
  return out;
}

// ── Web build (browser) ─────────────────────────────────────────────────────

/** Typed failure reasons the plugin maps to status reasons. */
export type WebErrorCode =
  | "checksum-mismatch"
  | "offline"
  | "launcher-source"
  | "extract-failed"
  | "not-verified"
  | "release-unavailable"
  | "invalid-dir";

export class ProvisionWebError extends ProvisionError {
  override name = "ProvisionWebError";
  readonly code: WebErrorCode;
  constructor(code: WebErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type WebSource = "registry" | "env-version" | "env-dir";

export interface WebReport {
  app: CraftAppId;
  /** Release version, or `dir-<digest12>` for a `<APP>_WEB_DIR` override. */
  version: string;
  source: WebSource;
  /** `<app>-web-<version>.zip`; null for a `<APP>_WEB_DIR` override. */
  asset: string | null;
  cacheHit: boolean;
  /** Absolute path of the installed tree `<root>/<app>-web/<key>/`. */
  dir: string;
  /** Absolute path of the `current` pointer (what the plugin serves). */
  current: string;
  shimVersion: number;
  durationMs: number;
}

export interface WebPostInstallContext {
  /** The staging tree (moved into place atomically after the hook returns). */
  dir: string;
  app: CraftAppId;
  version: string;
  shimVersion: number;
}

export interface ProvisionWebOptions extends Partial<ProvisionDeps> {
  /** Parent of `<app>-web/`; default `craftRoot(deps)` (`CRAFT_HOME`). The plugin passes its data dir. */
  root?: string;
  /** Version of the plugin's shim; part of the target key so a new shim always gets a new tree. */
  shimVersion: number;
  /** Plugin-supplied shim injection, run on the validated staging tree. Keeps this package dashboard-agnostic. */
  postInstall?: (ctx: WebPostInstallContext) => void | Promise<void>;
  /** Test seam: called inside the win32 `current` swap window (pointer absent). */
  onSwapWindow?: () => void;
}

export type ProvisionWebFn = typeof provisionWeb;

/** `<root>/<app>-web` (the plugin reads `<this>/current`). */
export function webAppRoot(app: CraftApp | string, root: string): string {
  const id = typeof app === "string" ? app : app.id;
  return path.resolve(root, `${id}-web`);
}

interface TreeFile {
  rel: string;
  abs: string;
  hash: string;
}

/** Sorted regular files of a directory tree; anything else (symlink, device…) is rejected. */
function scanTree(dir: string): TreeFile[] {
  const out: TreeFile[] = [];
  const walk = (d: string, prefix: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      const st = fs.lstatSync(abs);
      if (st.isDirectory()) walk(abs, rel);
      else if (st.isFile()) out.push({ rel, abs, hash: createHash("sha256").update(fs.readFileSync(abs)).digest("hex") });
      else throw new ProvisionWebError("invalid-dir", `override entry "${rel}" is not a regular file or directory; refusing`);
    }
  };
  walk(dir, "");
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

function webTreeValid(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, "index.html")).isFile();
  } catch {
    return false;
  }
}

/** Point `<appRoot>/current` at `<appRoot>/<key>`: symlink + rename (atomic) on POSIX; junction + rename-then-remove on win32. */
export function swapCurrent(appRoot: string, key: string, platform: NodeJS.Platform, randomId: () => string, onSwapWindow?: () => void): void {
  const target = path.join(appRoot, key);
  const link = path.join(appRoot, "current");
  try {
    if (fs.realpathSync(link) === fs.realpathSync(target)) return;
  } catch {
    /* absent or dangling: swap */
  }
  const tmp = path.join(appRoot, `.staging-current-${process.pid}-${randomId()}`);
  if (platform !== "win32") {
    fs.symlinkSync(key, tmp);
    try {
      fs.renameSync(tmp, link);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
    return;
  }
  // win32: a junction needs no privilege but cannot be renamed over; remove-then-rename leaves a short window
  // in which `current` is absent (requests get 503, never a partial tree).
  fs.symlinkSync(target, tmp, "junction");
  const old = path.join(appRoot, `.staging-old-${process.pid}-${randomId()}`);
  let hadOld = false;
  try {
    fs.renameSync(link, old);
    hadOld = true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw e;
    }
  }
  try {
    onSwapWindow?.();
    fs.renameSync(tmp, link);
  } catch (e) {
    if (hadOld) fs.renameSync(old, link);
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  if (hadOld) fs.rmSync(old, { recursive: true, force: true });
}

/** Map a raw install failure to a typed web error (unknown errors, e.g. disk full, pass through). */
function toWebError(e: unknown): unknown {
  if (e instanceof ProvisionWebError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (/^checksum mismatch/.test(msg)) return new ProvisionWebError("checksum-mismatch", msg);
  if (e instanceof TypeError || (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) || /^GitHub API request failed/.test(msg)) {
    return new ProvisionWebError("offline", `cannot reach GitHub: ${msg}`);
  }
  if (e instanceof ProvisionError) return new ProvisionWebError("release-unavailable", msg);
  return e;
}

/** Wrap a guard/extract step so any failure is `extract-failed`. */
async function asExtractFailed<T>(step: () => T | Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (e) {
    if (e instanceof ProvisionWebError) throw e;
    throw new ProvisionWebError("extract-failed", e instanceof Error ? e.message : String(e));
  }
}

interface WebSourceResolution {
  source: WebSource;
  version: string;
  /** `env-dir` only: the scanned override files to copy. */
  overrideFiles?: TreeFile[];
}

/** `<APP>_WEB_DIR` → `<APP>_WEB_VERSION` → registry `webVersion`; no network, never "latest". */
function resolveWebSource(app: CraftApp, deps: ProvisionDeps): WebSourceResolution {
  const prefix = envPrefix(app);
  const dirEnv = deps.env[`${prefix}_WEB_DIR`]?.trim();
  if (dirEnv) {
    const dir = path.resolve(dirEnv);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw new ProvisionWebError("invalid-dir", `${prefix}_WEB_DIR=${dirEnv}: ${fs.existsSync(dir) ? "not a directory" : "not found"}`);
    }
    const files = scanTree(dir);
    if (!files.some((f) => f.rel === "index.html")) throw new ProvisionWebError("invalid-dir", `${prefix}_WEB_DIR=${dirEnv}: no index.html`);
    const digest = createHash("sha256");
    for (const f of files) digest.update(`${f.rel}\0${f.hash}\n`);
    return { source: "env-dir", version: `dir-${digest.digest("hex").slice(0, 12)}`, overrideFiles: files };
  }
  if (craftSource(deps.env) === "launcher") {
    throw new ProvisionWebError(
      "launcher-source",
      `CRAFT_SOURCE=launcher never downloads the ${app.name} web build; set ${prefix}_WEB_DIR to a build directory or CRAFT_SOURCE=managed`,
    );
  }
  const pin = deps.env[`${prefix}_WEB_VERSION`]?.trim();
  if (pin) return { source: "env-version", version: normaliseVersion(pin, `${app.name} web`) };
  if (app.webVersion) return { source: "registry", version: normaliseVersion(app.webVersion, `${app.name} web`) };
  throw new ProvisionWebError("not-verified", `${app.name} has no verified web build (no registry webVersion); set ${prefix}_WEB_VERSION or ${prefix}_WEB_DIR`);
}

/** Copy scanned files into `tree`, normalising modes so a read-only override does not make the copy read-only. */
function copyFiles(files: TreeFile[], tree: string): void {
  for (const f of files) {
    const dest = path.join(tree, ...f.rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.abs, dest);
    fs.chmodSync(dest, 0o644);
  }
}

/**
 * Release zips of browser builds usually wrap the site in one top-level directory
 * (`<app>-web-<ver>/index.html`). When the root has no `index.html` but its only entry is a
 * directory that has one, hoist that directory's contents to the root.
 */
function hoistSingleTopLevelDir(tree: string): void {
  if (fs.existsSync(path.join(tree, "index.html"))) return;
  const entries = fs.readdirSync(tree, { withFileTypes: true });
  const only = entries.length === 1 && entries[0].isDirectory() ? entries[0].name : undefined;
  if (!only || !fs.existsSync(path.join(tree, only, "index.html"))) return;
  const inner = path.join(tree, only);
  for (const name of fs.readdirSync(inner)) fs.renameSync(path.join(inner, name), path.join(tree, name));
  fs.rmdirSync(inner);
}

/**
 * Provision the browser build of `app` into `<root>/<app>-web/<key>/` and point `current` at it.
 *
 * Resolution: `<APP>_WEB_DIR` (copied; key `dir-<digest>`) → `<APP>_WEB_VERSION` → registry `webVersion`;
 * never "latest"; `<APP>_BIN`/`<APP>_VERSION` are ignored. `CRAFT_SOURCE=launcher` without `WEB_DIR`
 * fails closed before any network. Key = `<version>-s<shimVersion>` so a new shim never rewrites a tree.
 */
export async function provisionWeb(appOrId: CraftApp | string, opts: ProvisionWebOptions): Promise<WebReport> {
  const app = typeof appOrId === "string" ? getApp(appOrId) : appOrId;
  const { root, shimVersion, postInstall, onSwapWindow, ...partial } = opts;
  const deps: ProvisionDeps = { ...defaultDeps(), ...partial };
  const started = deps.now();
  if (!Number.isInteger(shimVersion) || shimVersion < 1) throw new ProvisionError(`invalid shimVersion ${String(shimVersion)}`);

  const appRoot = webAppRoot(app, root ?? craftRoot(deps));
  const { source, version, overrideFiles } = resolveWebSource(app, deps);
  const key = `${version}-s${shimVersion}`;
  const finalDir = path.join(appRoot, key);
  const asset = source === "env-dir" ? null : `${app.id}-web-${version}.zip`;
  const ctx = (dir: string): WebPostInstallContext => ({ dir, app: app.id, version, shimVersion });
  // Validate the tree, then let the plugin finalize it; both before the atomic rename.
  const finalize = async (tree: string): Promise<void> => {
    const indexOk = () => fs.existsSync(path.join(tree, "index.html"));
    hoistSingleTopLevelDir(tree);
    if (!indexOk()) throw new ProvisionWebError("extract-failed", `${asset ?? "web build"} has no index.html`);
    await asExtractFailed(async () => {
      await postInstall?.(ctx(tree));
      if (!indexOk()) throw new Error("post-install removed index.html");
    });
  };

  return singleFlight(`web:${finalDir}`, async () => {
    try {
      fs.mkdirSync(appRoot, { recursive: true });
      sweepStaleStaging(appRoot, deps.now());
      let cacheHit = false;
      if (fs.existsSync(finalDir)) {
        if (webTreeValid(finalDir)) cacheHit = true;
        else {
          deps.log(`[pi-craft] web cache entry ${finalDir} is damaged; re-provisioning`);
          fs.rmSync(finalDir, { recursive: true, force: true });
        }
      }
      if (!cacheHit && overrideFiles) {
        const staging = path.join(appRoot, `.staging-${process.pid}-${deps.randomId()}`);
        try {
          const tree = path.join(staging, "tree");
          fs.mkdirSync(tree, { recursive: true });
          copyFiles(overrideFiles, tree);
          await finalize(tree);
          commitTree(tree, finalDir, webTreeValid);
        } finally {
          fs.rmSync(staging, { recursive: true, force: true });
        }
      } else if (!cacheHit) {
        const tag = `v${version}`;
        const release = await apiJson(deps, `${deps.apiBase}/repos/${app.repo}/releases/tags/${tag}`);
        await installVerified<void>({
          deps,
          repo: app.repo,
          asset: asset as string,
          release,
          cacheDir: appRoot,
          finalDir,
          list: (archive) => asExtractFailed(() => listZip(archive).then(() => undefined)),
          extract: (archive, dest) => asExtractFailed(() => extractZip(archive, dest)),
          validate: finalize,
          verifyExisting: webTreeValid,
        });
      }
      swapCurrent(appRoot, key, deps.platform, deps.randomId, onSwapWindow);
      return {
        app: app.id,
        version,
        source,
        asset,
        cacheHit,
        dir: finalDir,
        current: path.join(appRoot, "current"),
        shimVersion,
        durationMs: deps.now() - started,
      };
    } catch (e) {
      throw toWebError(e);
    }
  });
}
