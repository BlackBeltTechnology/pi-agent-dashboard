/**
 * Pure Chrome helpers shared by the browser plugin (dashboard host) and the
 * Electron main process (operator host). No Electron, no Fastify, no plugin
 * imports — `node:` built-ins only.
 *
 *  - `chromeUserDataDir` — Chrome's per-user data directory by platform.
 *  - `buildChromeOpenCommand` — argv for "open URL in profile X" (no shell).
 *  - `listChromeProfiles` — `Local State → profile.info_cache` parsing + the
 *    pinned-extension `installed` probe; never throws (degrades to a synthetic
 *    `Default` row + `warning`).
 *
 * See change: add-operator-browser-relay (design D8).
 */
import { existsSync, readFileSync } from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";

/** The pinned Playwright Chrome Extension id. */
export const PLAYWRIGHT_EXTENSION_ID = "mmlmfjhmonkocbjadbfplnigmagldckm";

export function chromeUserDataDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === "darwin") {
    return `${env.HOME ?? ""}/Library/Application Support/Google/Chrome`;
  }
  if (platform === "win32") {
    return `${env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\User Data`;
  }
  return `${env.HOME ?? ""}/.config/google-chrome`;
}

export interface OpenerCommand {
  cmd: string;
  args: string[];
}

/**
 * argv for "open `url` in Chrome profile `profileDirectory`". No shell string
 * anywhere — `profileDirectory` lands as its own argv element.
 */
export function buildChromeOpenCommand(
  platform: NodeJS.Platform,
  profileDirectory: string,
  url: string,
): OpenerCommand {
  if (platform === "darwin") {
    return {
      cmd: "open",
      args: ["-na", "Google Chrome", "--args", `--profile-directory=${profileDirectory}`, url],
    };
  }
  if (platform === "win32") {
    return { cmd: "chrome.exe", args: [`--profile-directory=${profileDirectory}`, url] };
  }
  return { cmd: "google-chrome", args: [`--profile-directory=${profileDirectory}`, url] };
}

export interface ProfileSource {
  profileDirectory: string;
  label: string;
  email?: string;
  /** Pinned Playwright extension present in this profile. */
  installed: boolean;
}

export interface ProfileListResult {
  profiles: ProfileSource[];
  /** Set only on the synthetic-`Default` fallback; names the offending path. */
  warning?: string;
}

export interface ProfileDiscoveryDeps {
  userDataDir?: string;
  readFile?: (p: string) => string;
  exists?: (p: string) => boolean;
  isInstalled?: (profileDir: string) => boolean | Promise<boolean>;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

interface InfoCacheEntry {
  name?: unknown;
  user_name?: unknown;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function hasExtensionSettingsRecord(prefsPath: string): Promise<boolean> {
  let prefs: { extensions?: { settings?: Record<string, unknown> } } | undefined;
  try {
    prefs = JSON.parse(await fsp.readFile(prefsPath, "utf-8"));
  } catch {
    return false;
  }
  const record = prefs?.extensions?.settings?.[PLAYWRIGHT_EXTENSION_ID];
  return !!record && typeof record === "object" && Object.keys(record as object).length > 0;
}

/**
 * Pinned-extension installed check, same semantics as the vendored upstream
 * `isExtensionInstalledInProfile`: web-store install dir, or a populated
 * settings record in (Secure) Preferences.
 */
export async function isPlaywrightExtensionInstalled(profileDir: string): Promise<boolean> {
  if (await pathExists(path.join(profileDir, "Extensions", PLAYWRIGHT_EXTENSION_ID))) return true;
  for (const f of ["Preferences", "Secure Preferences"]) {
    if (await hasExtensionSettingsRecord(path.join(profileDir, f))) return true;
  }
  return false;
}

function syntheticDefault(userDataDir: string, exists: (p: string) => boolean): ProfileSource {
  return {
    profileDirectory: "Default",
    label: "Default",
    installed: exists(path.join(userDataDir, "Default", "Extensions")),
  };
}

function readInfoCache(
  localStatePath: string,
  readFile: (p: string) => string,
): Record<string, InfoCacheEntry> | undefined {
  try {
    const parsed = JSON.parse(readFile(localStatePath)) as {
      profile?: { info_cache?: Record<string, InfoCacheEntry> };
    };
    const cache = parsed?.profile?.info_cache;
    if (!cache || typeof cache !== "object") return undefined;
    return cache;
  } catch {
    return undefined;
  }
}

async function buildRow(
  userDataDir: string,
  profileDirectory: string,
  entry: InfoCacheEntry,
  isInstalled: (profileDir: string) => boolean | Promise<boolean>,
): Promise<ProfileSource> {
  const row: ProfileSource = {
    profileDirectory,
    label:
      typeof entry.name === "string" && entry.name.length > 0 ? entry.name : profileDirectory,
    installed: await isInstalled(path.join(userDataDir, profileDirectory)),
  };
  if (typeof entry.user_name === "string" && entry.user_name.length > 0) {
    row.email = entry.user_name;
  }
  return row;
}

/** Discover Chrome profiles. Never throws. */
export async function listChromeProfiles(deps: ProfileDiscoveryDeps = {}): Promise<ProfileListResult> {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const userDataDir = deps.userDataDir ?? chromeUserDataDir(platform, env);
  const exists = deps.exists ?? existsSync;
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, "utf-8"));
  const isInstalled = deps.isInstalled ?? isPlaywrightExtensionInstalled;

  const localStatePath = path.join(userDataDir, "Local State");
  const degrade = (): ProfileListResult => ({
    profiles: [syntheticDefault(userDataDir, exists)],
    warning: `Chrome profile cache not readable at ${localStatePath}`,
  });

  if (!exists(userDataDir)) return degrade();
  const infoCache = readInfoCache(localStatePath, readFile);
  if (!infoCache) return degrade();
  const directories = Object.keys(infoCache).filter((d) => typeof d === "string" && d.length > 0);
  if (directories.length === 0) return degrade();

  return {
    profiles: await Promise.all(
      directories.map((dir) => buildRow(userDataDir, dir, infoCache[dir] ?? {}, isInstalled)),
    ),
  };
}
