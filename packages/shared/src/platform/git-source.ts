/**
 * Process-lifetime git-source state + env augmentation entrypoint.
 *
 * Holds the configured `windowsGitSource` setting and a cached resolution
 * ({ source, gitDir }) computed once per process (probing host PATH is
 * the expensive part). The server seeds the setting at startup and
 * invalidates on config-write; `/api/restart` is a fresh process so the
 * cache resets for free.
 *
 * `augmentEnvWithGitSource` is the single call wired into the spawn-env
 * chokepoint (`ToolResolver.buildSpawnEnv`) and the PTY path. `which` is
 * injected by the caller to avoid a binary-lookup ↔ git-source import
 * cycle.
 *
 * See change: embed-git-bash-on-windows, fix-windows-bundled-bash-exe.
 */
import {
  selectGitSource,
  type GitSource,
  type WindowsBashSourceSetting,
  type WindowsGitSourceSetting,
} from "./select-git-source.js";
import { ensureWindowsSystemPath } from "./ensure-windows-path.js";
import { normalizeEnvPathKey } from "./env-path-key.js";
import { resolvePiShell } from "./resolve-pi-shell.js";
import {
  ensureBundledGitOnPath,
  resolveBundledGitDir,
} from "./ensure-bundled-git.js";
import { spawnSync } from "./exec.js";
import path from "node:path";

export type WhichFn = (cmd: string) => string | null;

export interface ActiveGitSource {
  source: GitSource;
  setting: WindowsGitSourceSetting;
  /** Bundled git root when source is "bundled" and present, else null. */
  gitDir: string | null;
  /** Where bundled `usr/bin` sits on PATH (only matters when source is "bundled"). */
  bashSetting: WindowsBashSourceSetting;
}

let configuredSetting: WindowsGitSourceSetting = "auto";
let bashSetting: WindowsBashSourceSetting = "bundled";
let cached: ActiveGitSource | null = null;

/**
 * Seed the configured bash placement (server reads `windowsBashSource` from
 * DashboardConfig). Invalidates both caches. See change: fix-windows-bundled-bash-exe.
 */
export function setWindowsBashSourceSetting(setting: WindowsBashSourceSetting): void {
  const next: WindowsBashSourceSetting = setting === "host" ? "host" : "bundled";
  if (next !== bashSetting) {
    bashSetting = next;
    invalidateGitSourceCache();
  }
}

/** Seed the configured setting (server reads it from DashboardConfig). */
export function setWindowsGitSourceSetting(setting: WindowsGitSourceSetting): void {
  if (setting !== configuredSetting) {
    configuredSetting = setting;
    invalidateGitSourceCache(); // resets BOTH cached + readoutCache
  }
}

/** Drop the cached resolution (config-write, manual re-check). */
export function invalidateGitSourceCache(): void {
  cached = null;
  readoutCache = null;
}

export interface GitSourceResolveOpts {
  /** Override `process.resourcesPath` for tests / standalone bundles. */
  resourcesPath?: string;
  candidates?: string[];
  /** Override `process.platform` (test seam). */
  platform?: NodeJS.Platform;
  /** Override `fs.existsSync` (test seam). */
  exists?: (p: string) => boolean;
}

/**
 * Resolve (and cache) the active git source for this process. `which`
 * probes host PATH (only consulted on Windows + non-"bundled" settings).
 */
export function getActiveGitSource(which: WhichFn, opts: GitSourceResolveOpts = {}): ActiveGitSource {
  if (cached) return cached;
  const source = selectGitSource({ setting: configuredSetting, which, platform: opts.platform });
  const gitDir =
    source === "bundled"
      ? resolveBundledGitDir({
          platform: opts.platform,
          resourcesPath: opts.resourcesPath ?? (process as { resourcesPath?: string }).resourcesPath,
          candidates: opts.candidates,
          exists: opts.exists,
        })
      : null;
  cached = { source, setting: configuredSetting, gitDir, bashSetting };
  return cached;
}

/**
 * Augment a spawn env with bundled git/sh when the active source is
 * "bundled". No-op on non-Windows, host source, or absent bundle.
 * Defensive: a probe failure never breaks spawning — returns env as-is.
 */
export function augmentEnvWithGitSource(
  env: NodeJS.ProcessEnv,
  which: WhichFn,
  opts: GitSourceResolveOpts = {},
): NodeJS.ProcessEnv {
  try {
    const { source, gitDir, bashSetting: bashSource } = getActiveGitSource(which, opts);
    return ensureBundledGitOnPath(env, {
      source,
      gitDir,
      bashSource,
      platform: opts.platform,
      exists: opts.exists,
    });
  } catch {
    return env;
  }
}

export interface GitSourceReadout {
  setting: WindowsGitSourceSetting;
  source: GitSource;
  /** Resolved git.exe path (bundled or host), or null. */
  gitPath: string | null;
  /** `git --version` output, or null when unresolved. */
  gitVersion: string | null;
  /**
   * The `bash.exe` pi-coding-agent would resolve for a fresh spawn (pi's
   * getShellConfig order over the augmented spawn env), or null. Never `sh.exe`.
   */
  shellPath: string | null;
  /** Effective `windowsBashSource` placement. */
  bashSetting: WindowsBashSourceSetting;
  /** `shellPath` is the System32/Sysnative WSL launcher (pi stdin-transport shell). */
  shellIsWslLauncher: boolean;
}

export interface GitSourceReadoutOpts extends GitSourceResolveOpts {
  /**
   * The env a real spawn would receive (`ToolResolver.buildSpawnEnv(process.env)`),
   * or a thunk for it — evaluated only on a readout-cache miss on win32, so
   * health polls on other platforms / cache hits pay nothing. When omitted, a
   * minimal equivalent is derived from `process.env` (normalised PATH key +
   * System32 + bundled git).
   */
  spawnEnv?: NodeJS.ProcessEnv | (() => NodeJS.ProcessEnv);
}

let readoutCache: GitSourceReadout | null = null;

function probeVersion(gitPath: string): string | null {
  try {
    const r = spawnSync<string>(gitPath, ["--version"], { encoding: "utf8", timeout: 5000 });
    return r.status === 0 ? (r.stdout || "").trim() || null : null;
  } catch {
    return null;
  }
}

/**
 * Windows-only diagnostic readout for /api/health + Diagnostics. Returns
 * null on macOS/Linux (the setting is a no-op there). Cached for the life
 * of the process; reset by invalidateGitSourceCache() (config write) — NOT
 * re-probed when Git for Windows is installed/removed at runtime.
 *
 * Documented residuals: the session cwd (`where.exe` searches it first) and a
 * user-set pi `shellPath` (applies to the bash tool and `!` only).
 */
export function getGitSourceReadout(which: WhichFn, opts: GitSourceReadoutOpts = {}): GitSourceReadout | null {
  const platform = opts.platform ?? process.platform;
  if (platform !== "win32") return null;
  if (readoutCache) return readoutCache;
  const { source, setting, gitDir, bashSetting: bashSource } = getActiveGitSource(which, opts);
  const exists = opts.exists;
  const join = path.win32.join;

  const gitPath = source === "bundled" && gitDir ? join(gitDir, "cmd", "git.exe") : which("git");

  const spawnEnv =
    (typeof opts.spawnEnv === "function" ? opts.spawnEnv() : opts.spawnEnv) ??
    augmentEnvWithGitSource(
      ensureWindowsSystemPath(normalizeEnvPathKey({ ...process.env }, platform), { platform, exists }),
      which,
      opts,
    );
  const shell = resolvePiShell({ env: spawnEnv, exists });

  readoutCache = {
    setting,
    source,
    gitPath,
    gitVersion: gitPath ? probeVersion(gitPath) : null,
    shellPath: shell?.path ?? null,
    bashSetting: bashSource,
    shellIsWslLauncher: shell?.isWslLauncher ?? false,
  };
  return readoutCache;
}
