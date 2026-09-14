/**
 * Chrome profile discovery (change: add-browser-relay, task 2.7 / spec
 * `browser-relay` "Profile discovery and capability").
 *
 * The source of truth is Chrome's own `Local State → profile.info_cache`,
 * which carries the stable `profileDirectory` key plus the user-editable
 * `name` label and the signed-in `user_name`. Labels are NOT unique (two
 * profiles can both be "Person 1"), which is exactly why every config map,
 * instance map and REST parameter is keyed by `profileDirectory`.
 *
 * Nothing here is privileged: reading `Local State` needs no Chrome
 * cooperation and no permissions.
 *
 * Two failure modes are normal, not errors, and both yield the SAME answer —
 * a single synthetic `Default` row plus a `warning` naming the path:
 *  - the user-data directory does not exist (Chrome never run on this host);
 *  - `Local State` is absent or unparseable (fresh profile / concurrent write).
 * The caller only loses the label/email decoration; `connect` still proceeds
 * to the `installed` check, which is what actually gates a connection.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromeUserDataDir } from "./capability.js";
import { isExtensionInstalledInProfile } from "./relay/vendor/playwright-core/src/tools/utils/extension.js";

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
  /** Injectable for tests; defaults to the vendored upstream check. */
  isInstalled?: (profileDir: string) => boolean | Promise<boolean>;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

/** One `profile.info_cache` entry, narrowed. */
interface InfoCacheEntry {
  name?: unknown;
  user_name?: unknown;
}

function syntheticDefault(userDataDir: string, exists: (p: string) => boolean): ProfileSource {
  // `installed` still reflects reality — the Extensions dir is per-profile,
  // independent of whether `Local State` could be read.
  return {
    profileDirectory: "Default",
    label: "Default",
    installed: exists(path.join(userDataDir, "Default", "Extensions")),
  };
}

/** Parse `Local State` into its `profile.info_cache`, or undefined when unusable. */
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

/** One row: label/email decoration + the per-profile `installed` probe. */
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
  // `user_name` is the signed-in account; absent (not empty-string) signed out.
  if (typeof entry.user_name === "string" && entry.user_name.length > 0) {
    row.email = entry.user_name;
  }
  return row;
}

/**
 * Discover Chrome profiles. Never throws: any read/parse failure degrades to
 * the synthetic row + warning, which is a 200 (spec X9), not an error.
 */
export async function listChromeProfiles(
  deps: ProfileDiscoveryDeps = {},
): Promise<ProfileListResult> {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const userDataDir = deps.userDataDir ?? chromeUserDataDir(platform, env);
  const exists = deps.exists ?? existsSync;
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, "utf-8"));
  const isInstalled =
    deps.isInstalled ?? ((profileDir: string) => isExtensionInstalledInProfile(profileDir));

  const localStatePath = path.join(userDataDir, "Local State");
  const degrade = (): ProfileListResult => ({
    profiles: [syntheticDefault(userDataDir, exists)],
    warning: `Chrome profile cache not readable at ${localStatePath}`,
  });

  if (!exists(userDataDir)) return degrade();
  const infoCache = readInfoCache(localStatePath, readFile);
  // Chrome only writes `info_cache` once a profile has been used, so "absent",
  // "unparseable" and "empty" are one case: no usable profile list.
  if (!infoCache) return degrade();
  const directories = Object.keys(infoCache).filter((d) => typeof d === "string" && d.length > 0);
  if (directories.length === 0) return degrade();

  return {
    profiles: await Promise.all(
      directories.map((dir) => buildRow(userDataDir, dir, infoCache[dir] ?? {}, isInstalled)),
    ),
  };
}
