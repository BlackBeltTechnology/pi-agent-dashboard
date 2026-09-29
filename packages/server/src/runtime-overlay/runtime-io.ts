/**
 * Real I/O for the runtime overlay checker + stager.
 *
 *   - npm is resolved exactly like pi-core updates (ToolRegistry: managed /
 *     bundled Node first, never a bare "npm"), with the managed Node prepended
 *     to PATH; the user's npm config (`.npmrc`, registry) applies.
 *   - `tar` is the system tar (bsdtar on macOS / Windows 10+, GNU tar on Linux).
 *   - GitHub: public Releases API + per-platform asset
 *     `pi-dashboard-runtime-<X>-<platform>-<arch>.tgz` and `<asset>.sha512`
 *     (spike 1.1 deferred → conservative per-platform assets).
 *
 * See change: electron-runtime-overlay-updates (D5).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { normalizeEnvPathKey } from "@blackbelt-technology/pi-dashboard-shared/platform/env-path-key.js";
import { execFileAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { prependManagedNodeToPath } from "@blackbelt-technology/pi-dashboard-shared/platform/managed-node-path.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import type { RuntimeLock, StagerDeps } from "./runtime-stager.js";
import { RUNTIME_GITHUB_REPO, RUNTIME_SERVER_PACKAGE, type RuntimeReleaseFeeds } from "./runtime-update-checker.js";

const NPM_TIMEOUT_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 64 * 1024 * 1024;

function npmArgv(): string[] {
  const r = getDefaultRegistry().resolveExecutor("npm");
  if (!r.ok || !r.path) {
    throw new Error("npm could not be resolved (no managed runtime, no npm on PATH)");
  }
  return r.argv;
}

async function npm(args: string[], cwd: string, timeoutMs = NPM_TIMEOUT_MS): Promise<string> {
  const [cmd, ...prefix] = npmArgv();
  const { stdout } = await execFileAsync(cmd, [...prefix, ...args], {
    cwd,
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
    env: prependManagedNodeToPath(normalizeEnvPathKey(process.env)),
  });
  return String(stdout);
}

/** List members; refuse any that are absolute, climb out (`..`), or are links — before extracting. */
async function safeMembers(tgz: string): Promise<string[]> {
  const { stdout } = await execFileAsync("tar", ["-tzf", tgz], { timeout: NPM_TIMEOUT_MS, maxBuffer: MAX_BUFFER });
  const names = String(stdout).split(/\r?\n/).filter(Boolean);
  for (const name of names) {
    if (path.isAbsolute(name) || /^[a-zA-Z]:/.test(name) || name.startsWith("\\") || name.split(/[\\/]/).includes("..")) {
      throw new Error(`unsafe_archive member ${JSON.stringify(name)}`);
    }
  }
  // Links could point out of the staging dir and a later member write through
  // them. A runtime tree has no links (npm ci output, plugins copied), so refuse
  // all. `tar -tv` (bsdtar and GNU) starts each line with the entry type.
  const { stdout: verbose } = await execFileAsync("tar", ["-tvzf", tgz], { timeout: NPM_TIMEOUT_MS, maxBuffer: MAX_BUFFER });
  const link = String(verbose).split(/\r?\n/).find((line) => /^[lh]/.test(line));
  if (link) throw new Error(`unsafe_archive link member ${JSON.stringify(link.trim())}`);
  return names;
}

async function tarExtract(tgz: string, destDir: string, members: string[] = []): Promise<void> {
  const present = new Set(await safeMembers(tgz));
  const missing = members.filter((m) => !present.has(m));
  if (missing.length) throw new Error(`archive lacks ${missing.join(", ")}`);
  fs.mkdirSync(destDir, { recursive: true });
  await execFileAsync("tar", ["-xzf", tgz, "-C", destDir, ...members], { timeout: NPM_TIMEOUT_MS, maxBuffer: MAX_BUFFER });
}

async function fetchOk(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "pi-dashboard-runtime-updater", accept: "application/vnd.github+json, */*" },
  });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res;
}

function githubAssetName(version: string, platform: string, arch: string): string {
  return `pi-dashboard-runtime-${version}-${platform}-${arch}.tgz`;
}

export const runtimeReleaseFeeds: RuntimeReleaseFeeds = {
  npmDistTags: async () => {
    // Neutral cwd: inside an npm workspace `npm view --json` answers per
    // workspace (an array). Unwrap defensively too.
    const out = await npm(["view", RUNTIME_SERVER_PACKAGE, "dist-tags", "--json"], os.tmpdir(), FETCH_TIMEOUT_MS);
    const parsed = JSON.parse(out) as Record<string, string> | Array<Record<string, string>>;
    return Array.isArray(parsed) ? (parsed[0] ?? {}) : parsed;
  },
  githubReleases: async () => {
    const res = await fetchOk(`https://api.github.com/repos/${RUNTIME_GITHUB_REPO}/releases?per_page=50`);
    const rels = (await res.json()) as Array<{ tag_name?: string; prerelease?: boolean; draft?: boolean }>;
    return rels
      .filter((r) => typeof r.tag_name === "string")
      .map((r) => ({ tag: r.tag_name as string, prerelease: !!r.prerelease, draft: !!r.draft }));
  },
};

export function createStagerDeps(): StagerDeps {
  return {
    platform: process.platform,
    arch: process.arch,
    runNpm: async (args, cwd) => {
      await npm(args, cwd);
    },
    fetchRuntimeLock: async (version, workDir) => {
      // The --json shape differs across npm majors (array ≤ 11, object keyed by
      // name in 12); the tarball written to the empty workDir is unambiguous.
      await npm(["pack", `${RUNTIME_SERVER_PACKAGE}@${version}`, "--pack-destination", workDir], workDir);
      const tarballs = fs.readdirSync(workDir).filter((f) => f.endsWith(".tgz"));
      if (tarballs.length !== 1) throw new Error(`npm pack produced ${tarballs.length} tarballs`);
      const tgz = path.join(workDir, tarballs[0] as string);
      try {
        await tarExtract(tgz, workDir, ["package/runtime-lock.json"]);
      } catch (err) {
        throw new Error(
          `${RUNTIME_SERVER_PACKAGE}@${version} ships no runtime-lock.json — it predates runtime overlay releases (${err instanceof Error ? err.message : String(err)})`,
        );
      }
      const lockFile = path.join(workDir, "package", "runtime-lock.json");
      return JSON.parse(fs.readFileSync(lockFile, "utf8")) as RuntimeLock;
    },
    fetchGithubAsset: async (version, dest, target) => {
      const assetName = githubAssetName(version, target.platform, target.arch);
      const base = `https://github.com/${RUNTIME_GITHUB_REPO}/releases/download/v${version}/${assetName}`;
      const sha = (await (await fetchOk(`${base}.sha512`)).text()).trim().split(/\s+/)[0] ?? "";
      const res = await fetchOk(base, NPM_TIMEOUT_MS);
      if (!res.body) throw new Error(`empty body for ${assetName}`);
      await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), fs.createWriteStream(dest));
      return { sha512: sha, assetName };
    },
    extractTgz: (tgz, destDir) => tarExtract(tgz, destDir),
  };
}
