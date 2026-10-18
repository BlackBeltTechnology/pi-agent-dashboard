/**
 * Chrome reach + launch for the browser relay (change: add-browser-relay,
 * task 2.10 / design D4).
 *
 * Two separate questions, deliberately kept apart:
 *
 *  - `canOpenChrome()` — "could this host launch a URL in a named Chrome
 *    profile?" Requires BOTH that the host can reach a desktop (the shared
 *    `computeSystemOpen` probe, so this answer cannot disagree with
 *    `/api/health.capabilities.systemOpen`) AND that Chrome's user-data
 *    directory exists. Container/headless → false, and `GET /api/browser/status`
 *    reports it so the settings section can explain instead of offering a
 *    button that cannot work.
 *  - `buildChromeOpenCommand()` — the argv. macOS needs the `-n` (new
 *    instance) + `--args` dance to reach a SPECIFIC profile of an
 *    ALREADY-RUNNING Chrome; `open <url>` would hand the URL to whatever the
 *    default browser is and ignore `--profile-directory` entirely. That is the
 *    research-verified form (docs/research/browser-relay-playwright-extension.md §7).
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { chromeUserDataDir } from "@blackbelt-technology/pi-dashboard-shared/chrome-profiles.js";
import { computeSystemOpen } from "@blackbelt-technology/pi-dashboard-shared/platform/system-open.js";

// Pure helpers live in shared (consumed by Electron main too); re-exported
// unchanged. See change: add-operator-browser-relay (design D8).
export {
  buildChromeOpenCommand,
  chromeUserDataDir,
} from "@blackbelt-technology/pi-dashboard-shared/chrome-profiles.js";

export interface ChromeCapabilityDeps {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Injectable seams (tests) — default to the real probes. */
  systemOpen?: () => boolean;
  exists?: (path: string) => boolean;
}

/**
 * True iff the host can open a URL in a named Chrome profile: a reachable
 * desktop AND a Chrome user-data directory on disk.
 */
export function canOpenChrome(deps: ChromeCapabilityDeps = {}): boolean {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const systemOpen = deps.systemOpen ?? (() => computeSystemOpen(env, platform));
  const exists = deps.exists ?? existsSync;
  if (!systemOpen()) return false;
  return exists(chromeUserDataDir(platform, env));
}

// ── Dedicated agent browser (change: add-dedicated-agent-browser, D1) ────────

export interface ChromeBinaryDeps {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Home directory for `~/Applications` (default: `env.HOME`, else `os.homedir()`). */
  home?: string;
  exists?: (path: string) => boolean;
  /** Resolve a bare command on PATH → absolute path or null (default: PATH walk with `exists`). */
  which?: (name: string) => string | null;
}

/** Linux commands, in preference order. Flatpak/Snap/Chromium are deliberately not resolved. */
const LINUX_CHROME_COMMANDS: readonly string[] = ["google-chrome", "google-chrome-stable"];

function whichOnPath(
  name: string,
  env: NodeJS.ProcessEnv,
  exists: (p: string) => boolean,
): string | null {
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (dir === "") continue;
    const candidate = path.join(dir, name);
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Absolute path of a Google Chrome binary the dedicated browser can launch, or
 * `null`. Independent of Chrome's user-data directory (a host with the binary
 * but no default profile is still available). Pure over its injected seams.
 */
export function resolveChromeBinary(deps: ChromeBinaryDeps = {}): string | null {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const exists = deps.exists ?? existsSync;

  if (platform === "darwin") return resolveDarwinChrome(deps.home ?? env.HOME ?? homedir(), exists);
  if (platform === "win32") return resolveWin32Chrome(env, exists);
  if (platform === "linux") return resolveLinuxChrome(deps.which ?? ((name: string) => whichOnPath(name, env, exists)));
  return null;
}

function resolveDarwinChrome(home: string, exists: (p: string) => boolean): string | null {
  const rel = path.posix.join("Google Chrome.app", "Contents", "MacOS", "Google Chrome");
  for (const base of ["/Applications", path.posix.join(home, "Applications")]) {
    const candidate = path.posix.join(base, rel);
    if (exists(candidate)) return candidate;
  }
  return null;
}

function resolveWin32Chrome(env: NodeJS.ProcessEnv, exists: (p: string) => boolean): string | null {
  for (const key of ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]) {
    const base = env[key];
    if (!base) continue;
    const candidate = path.win32.join(base, "Google", "Chrome", "Application", "chrome.exe");
    if (exists(candidate)) return candidate;
  }
  return null;
}

function resolveLinuxChrome(which: (name: string) => string | null | undefined): string | null {
  for (const name of LINUX_CHROME_COMMANDS) {
    const found = which(name);
    if (found) return found;
  }
  return null;
}

type DedicatedUnavailableReason = "no-chrome" | "no-display";

export interface DedicatedAvailability {
  available: boolean;
  reason?: DedicatedUnavailableReason;
}

export interface DedicatedAvailabilityDeps extends ChromeBinaryDeps {
  /** Desktop reachability probe (default: shared `computeSystemOpen`). */
  systemOpen?: () => boolean;
}

/**
 * Can the host launch the dedicated (headed) Chrome? `no-chrome` is checked
 * first, then `no-display` via the same probe as `canOpenChrome`. Deliberately
 * does NOT require Chrome's default user-data dir.
 */
export function dedicatedAvailability(deps: DedicatedAvailabilityDeps = {}): DedicatedAvailability {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  if (resolveChromeBinary({ ...deps, env, platform }) === null) {
    return { available: false, reason: "no-chrome" };
  }
  const systemOpen = deps.systemOpen ?? (() => computeSystemOpen(env, platform));
  if (!systemOpen()) return { available: false, reason: "no-display" };
  return { available: true };
}
