/**
 * Provision the headless PhotoCraft CLI (`photocraft-cli`) for the host.
 *
 * Resolve the release (override → pin → latest), map host → asset, verify the
 * asset against `SHA256SUMS.txt` (fail closed), list-then-extract into a staging
 * dir, and move the tree to `<cache root>/<version>/`. Every external effect
 * (fetch, clock, env, platform, exec, C-library probe) is an injectable seam.
 *
 * See change: add-photocraft-plugin (design D1–D4).
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFileAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";

export const REPO = "storytold/photocraft";
export const API_BASE = "https://api.github.com";
const LATEST_TTL_MS = 24 * 60 * 60 * 1000;
const STALE_STAGING_MS = 60 * 60 * 1000;
const MIN_GLIBC = [2, 35] as const;
const SUMS_NAME = "SHA256SUMS.txt";

export type ProvisionSource = "override" | "pin" | "latest" | "latest-cached" | "fallback-installed";

export interface ProvisionReport {
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

const ASSETS: Record<string, (v: string) => string> = {
  "darwin/x64": (v) => `photocraft-cli-${v}-macos-universal.zip`,
  "darwin/arm64": (v) => `photocraft-cli-${v}-macos-universal.zip`,
  "linux/x64": (v) => `photocraft-${v}-linux-x86_64.tar.gz`,
  "linux/arm64": (v) => `photocraft-${v}-linux-aarch64.tar.gz`,
  "linux/riscv64": (v) => `photocraft-${v}-linux-riscv64.tar.gz`,
  "win32/x64": (v) => `photocraft-${v}-windows-x64-portable.zip`,
  "win32/arm64": (v) => `photocraft-${v}-windows-arm64-portable.zip`,
  "win32/ia32": (v) => `photocraft-${v}-windows-x86-portable.zip`,
  "freebsd/x64": (v) => `photocraft-${v}-freebsd-x86_64.tar.gz`,
};

export function assetFor(platform: string, arch: string, version: string): string {
  const make = ASSETS[`${platform}/${arch}`];
  if (!make) {
    throw new ProvisionError(
      `unsupported platform: ${platform}/${arch} has no PhotoCraft CLI release asset; set PHOTOCRAFT_BIN to a self-built photocraft-cli`,
    );
  }
  return make(version);
}

/** Linux only: PhotoCraft links glibc 2.35 symbols; musl cannot run it. */
function assertLibc(deps: ProvisionDeps): void {
  if (deps.platform !== "linux") return;
  const v = deps.glibcVersion();
  if (v === undefined) {
    throw new ProvisionError(
      "unsupported C library: musl (not glibc); the PhotoCraft CLI needs glibc ≥ 2.35. Set PHOTOCRAFT_BIN to a compatible photocraft-cli",
    );
  }
  const [maj, min] = v.split(".").map((n) => Number.parseInt(n, 10));
  if (maj < MIN_GLIBC[0] || (maj === MIN_GLIBC[0] && (min ?? 0) < MIN_GLIBC[1])) {
    throw new ProvisionError(
      `unsupported C library: glibc ${v}; the PhotoCraft CLI needs glibc ≥ 2.35. Set PHOTOCRAFT_BIN to a compatible photocraft-cli`,
    );
  }
}

// ── Paths, versions ─────────────────────────────────────────────────────────

export function cacheRoot(deps: Pick<ProvisionDeps, "env" | "homedir">): string {
  if (deps.env.PHOTOCRAFT_HOME) return path.resolve(deps.env.PHOTOCRAFT_HOME);
  const agentDir = deps.env.PI_CODING_AGENT_DIR || path.join(deps.homedir(), ".pi", "agent");
  return path.join(agentDir, "tools", "photocraft");
}

/** Strip one leading `v`; reject anything that cannot be a safe single path segment. */
export function normaliseVersion(raw: string): string {
  const v = raw.trim().replace(/^v/, "");
  if (!/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(v) || v.includes("..")) {
    throw new ProvisionError(`invalid PhotoCraft version "${raw}"`);
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

function binName(platform: string): string {
  return platform === "win32" ? "photocraft-cli.exe" : "photocraft-cli";
}

function desktopName(platform: string): string {
  return platform === "win32" ? "photocraft.exe" : "photocraft";
}

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
export function locateBinary(tree: string, platform: string, assetName: string): string | undefined {
  const name = binName(platform);
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
interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
}

async function apiJson(deps: ProvisionDeps, url: string): Promise<Release> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "pi-photocraft" };
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

async function downloadText(deps: ProvisionDeps, url: string): Promise<string> {
  const res = await deps.fetch(url, { headers: { "User-Agent": "pi-photocraft" }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new ProvisionError(`download of ${SUMS_NAME} failed: HTTP ${res.status}`);
  return res.text();
}

/** Stream `url` to `dest`, hashing as it goes; returns the SHA-256 hex digest. */
async function downloadFile(deps: ProvisionDeps, url: string, dest: string): Promise<string> {
  const res = await deps.fetch(url, { headers: { "User-Agent": "pi-photocraft" }, signal: AbortSignal.timeout(15 * 60_000) });
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

// ── Version resolution ──────────────────────────────────────────────────────

interface Resolved {
  version: string;
  source: ProvisionSource;
  release?: Release;
}

function readLatestCache(root: string, now: number): string | undefined {
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(root, "latest.json"), "utf8")) as { tag?: unknown; checkedAt?: unknown };
    if (typeof rec.tag !== "string" || typeof rec.checkedAt !== "number") return undefined;
    if (rec.checkedAt > now || now - rec.checkedAt >= LATEST_TTL_MS) return undefined;
    return rec.tag;
  } catch {
    return undefined;
  }
}

function installedVersions(root: string, platform: string): string[] {
  return subdirs(root)
    .filter((d) => /^\d+\.\d+\.\d+/.test(d) && !d.startsWith("."))
    .filter((d) => cachedBinary(path.join(root, d), platform) !== undefined)
    .sort((a, b) => compareSemver(b, a));
}

async function resolveVersion(deps: ProvisionDeps, root: string): Promise<Resolved> {
  const pin = deps.env.PHOTOCRAFT_VERSION?.trim();
  if (pin) return { version: normaliseVersion(pin), source: "pin" };

  const cached = readLatestCache(root, deps.now());
  if (cached) return { version: normaliseVersion(cached), source: "latest-cached" };

  try {
    const release = await apiJson(deps, `${deps.apiBase}/repos/${REPO}/releases/latest`);
    const version = normaliseVersion(release.tag_name);
    try {
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, "latest.json"), JSON.stringify({ tag: release.tag_name, checkedAt: deps.now() }));
    } catch {
      /* cache is best-effort */
    }
    return { version, source: "latest", release };
  } catch (e) {
    const reason = (e as Error).message;
    const installed = installedVersions(root, deps.platform);
    if (installed.length > 0) {
      deps.log(`[pi-photocraft] warning: latest-release lookup failed (${reason}); using installed ${installed[0]}`);
      return { version: installed[0], source: "fallback-installed" };
    }
    throw new ProvisionError(
      `${reason}. No PhotoCraft version is installed; set GITHUB_TOKEN (rate limit), PHOTOCRAFT_VERSION to pin a release, or PHOTOCRAFT_BIN to an existing photocraft-cli`,
    );
  }
}

// ── Override ────────────────────────────────────────────────────────────────

async function overrideReport(deps: ProvisionDeps, started: number): Promise<ProvisionReport> {
  const bin = deps.env.PHOTOCRAFT_BIN as string;
  let reason: string | undefined;
  try {
    const st = fs.statSync(bin);
    if (!st.isFile()) reason = "not a file";
    else if (deps.platform !== "win32" && (st.mode & 0o111) === 0) reason = "not executable";
  } catch {
    reason = "not found";
  }
  if (reason) throw new ProvisionError(`PHOTOCRAFT_BIN=${bin}: ${reason}`);
  let version: string | null = null;
  if (deps.probeVersion) {
    try {
      const out = (await deps.exec(bin, ["--version"], { timeout: 10_000 })).stdout.toString();
      version = /\b(\d+\.\d+\.\d+[^\s]*)/.exec(out)?.[1] ?? null;
    } catch {
      version = null;
    }
  }
  return { version, source: "override", asset: null, cacheHit: false, binary: path.resolve(bin), durationMs: deps.now() - started };
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

function cachedBinary(dir: string, platform: string): string | undefined {
  try {
    const bin = locateBinary(dir, platform, path.basename(dir));
    return bin && validBinary(bin, platform) ? bin : undefined;
  } catch {
    return undefined;
  }
}

export async function provision(partial: Partial<ProvisionDeps> = {}): Promise<ProvisionReport> {
  const deps: ProvisionDeps = { ...defaultDeps(), ...partial };
  const started = deps.now();

  if (deps.env.PHOTOCRAFT_BIN) return overrideReport(deps, started);

  // Host checks run before any network request.
  assetFor(deps.platform, deps.arch, "0.0.0");
  assertLibc(deps);

  const root = cacheRoot(deps);
  fs.mkdirSync(root, { recursive: true });
  sweepStaleStaging(root, deps.now());

  const resolved = await resolveVersion(deps, root);
  const { version } = resolved;
  const asset = assetFor(deps.platform, deps.arch, version);
  const versionDir = path.join(root, version);

  const report = (binary: string, cacheHit: boolean): ProvisionReport => ({
    version,
    source: resolved.source,
    asset,
    cacheHit,
    binary,
    durationMs: deps.now() - started,
  });

  if (fs.existsSync(versionDir)) {
    const hit = cachedBinary(versionDir, deps.platform);
    if (hit) return report(hit, true);
    deps.log(`[pi-photocraft] cache entry ${versionDir} is damaged; re-provisioning`);
    fs.rmSync(versionDir, { recursive: true, force: true });
  }

  const staging = path.join(root, `.staging-${process.pid}-${deps.randomId()}`);
  try {
    fs.mkdirSync(path.join(staging, "tree"), { recursive: true });
    const tag = `v${version}`;
    const release = resolved.release ?? (await apiJson(deps, `${deps.apiBase}/repos/${REPO}/releases/tags/${tag}`));
    const assetInfo = release.assets.find((a) => a.name === asset);
    if (!assetInfo) throw new ProvisionError(`release ${tag} has no asset named ${asset}`);
    const sumsInfo = release.assets.find((a) => a.name === SUMS_NAME);
    if (!sumsInfo) throw new ProvisionError(`release ${tag} has no ${SUMS_NAME}; refusing to install an unverified binary`);

    const expected = parseSums(await downloadText(deps, sumsInfo.browser_download_url), asset);
    const size = assetInfo.size ? ` (${(assetInfo.size / 1048576).toFixed(0)} MB)` : "";
    deps.log(`[pi-photocraft] downloading PhotoCraft ${tag} ${asset}${size}`);
    const archive = path.join(staging, asset);
    const actual = await downloadFile(deps, assetInfo.browser_download_url, archive);
    if (actual !== expected) {
      throw new ProvisionError(`checksum mismatch for ${asset}: expected ${expected}, got ${actual}`);
    }

    const tree = path.join(staging, "tree");
    await extractArchive(deps, archive, tree);
    const located = locateBinary(tree, deps.platform, asset);
    if (!located) throw new ProvisionError(`no ${binName(deps.platform)} found in ${asset}`);
    const rel = path.relative(tree, located);
    fs.chmodSync(located, 0o755);
    fs.rmSync(path.join(path.dirname(located), desktopName(deps.platform)), { force: true });

    let raced = false;
    try {
      fs.renameSync(tree, versionDir);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EEXIST" || code === "ENOTEMPTY" || code === "EPERM") {
        if (!cachedBinary(versionDir, deps.platform)) throw e;
        raced = true;
      } else throw e;
    }
    const binary = raced ? (cachedBinary(versionDir, deps.platform) as string) : path.join(versionDir, rel);
    const out = report(binary, false);
    if (deps.platform === "darwin") {
      try {
        await deps.exec("spctl", ["--assess", "--type", "install", binary]);
        out.gatekeeper = "accepted";
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          out.gatekeeper = "rejected";
          deps.log(`[pi-photocraft] warning: Gatekeeper rejected ${binary} (checksum verified; authenticity not claimed)`);
        }
      }
    }
    return out;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
