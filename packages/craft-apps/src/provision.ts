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
 * See change: add-photocraft-plugin (design D1–D4), add-craft-apps-core (D2, D3).
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

async function extractArchive(deps: ProvisionDeps, archive: string, dest: string): Promise<void> {
  const names = lines((await deps.exec("tar", ["-tf", archive])).stdout);
  const verbose = lines((await deps.exec("tar", ["-tvf", archive])).stdout);
  assertSafeListing(names, verbose);
  if (deps.platform === "darwin") await deps.exec("ditto", ["-x", "-k", archive, dest]);
  else await deps.exec("tar", ["-xf", archive, "-C", dest]);
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

export async function downloadText(deps: ProvisionDeps, url: string): Promise<string> {
  const res = await deps.fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new ProvisionError(`download of ${SUMS_NAME} failed: HTTP ${res.status}`);
  return res.text();
}

/** Stream `url` to `dest`, hashing as it goes; returns the SHA-256 hex digest. */
export async function downloadFile(deps: ProvisionDeps, url: string, dest: string): Promise<string> {
  const res = await deps.fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15 * 60_000) });
  if (!res.ok || !res.body) throw new ProvisionError(`asset download failed: HTTP ${res.status} for ${url}`);
  const hash = createHash("sha256");
  await pipeline(
    Readable.fromWeb(res.body as never),
    async function* (src: AsyncIterable<Buffer>) {
      for await (const chunk of src) {
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
export async function downloadVerified(deps: ProvisionDeps, release: Release, assetName: string, dest: string): Promise<void> {
  const tag = release.tag_name;
  const assetInfo = release.assets.find((a) => a.name === assetName);
  if (!assetInfo) throw new ProvisionError(`release ${tag} has no asset named ${assetName}`);
  const sumsInfo = release.assets.find((a) => a.name === SUMS_NAME);
  if (!sumsInfo) throw new ProvisionError(`release ${tag} has no ${SUMS_NAME}; refusing to install an unverified binary`);
  const expected = parseSums(await downloadText(deps, sumsInfo.browser_download_url), assetName);
  const size = assetInfo.size ? ` (${(assetInfo.size / 1048576).toFixed(0)} MB)` : "";
  deps.log(`[pi-craft] downloading ${tag} ${assetName}${size}`);
  const actual = await downloadFile(deps, assetInfo.browser_download_url, dest);
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
    .filter((d) => /^\d+\.\d+\.\d+/.test(d) && !d.startsWith("."))
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

// ── Provision ───────────────────────────────────────────────────────────────

function sweepStaleStaging(root: string, now: number): void {
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
    if (typeof viaLauncher !== "string") return viaLauncher;
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

  const staging = path.join(root, `.staging-${process.pid}-${deps.randomId()}`);
  try {
    fs.mkdirSync(path.join(staging, "tree"), { recursive: true });
    const tag = `v${version}`;
    const release = resolved.release ?? (await apiJson(deps, `${deps.apiBase}/repos/${app.repo}/releases/tags/${tag}`));
    const asset = candidates.find((c) => release.assets.some((a) => a.name === c));
    if (!asset) throw new ProvisionError(`release ${tag} has no asset named ${candidates.join(" or ")}`);

    const archive = path.join(staging, asset);
    await downloadVerified(deps, release, asset, archive);

    const tree = path.join(staging, "tree");
    await extractArchive(deps, archive, tree);
    const located = locateBinary(app, tree, deps.platform, asset);
    if (!located) throw new ProvisionError(`no ${binName(app, deps.platform)} found in ${asset}`);
    const rel = path.relative(tree, located);
    fs.chmodSync(located, 0o755);
    fs.rmSync(path.join(path.dirname(located), desktopName(app, deps.platform)), { force: true });
    fs.writeFileSync(path.join(tree, ASSET_MARKER), `${asset}\n`);

    let raced = false;
    try {
      fs.renameSync(tree, versionDir);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EEXIST" || code === "ENOTEMPTY" || code === "EPERM") {
        if (!cachedBinary(app, versionDir, deps.platform)) throw e;
        raced = true;
      } else throw e;
    }
    const binary = raced ? (cachedBinary(app, versionDir, deps.platform) as string) : path.join(versionDir, rel);
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
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
