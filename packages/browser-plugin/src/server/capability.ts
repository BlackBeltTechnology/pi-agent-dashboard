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
import { computeSystemOpen } from "@blackbelt-technology/pi-dashboard-shared/platform/system-open.js";

/** Chrome's per-user data directory, by platform. */
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

export interface OpenerCommand {
  cmd: string;
  args: string[];
}

/**
 * argv for "open `url` in Chrome profile `profileDirectory`". No shell string
 * anywhere — `profileDirectory` is user-supplied config and lands as its own
 * argv element, so a quote/space cannot inject.
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
    return {
      cmd: "chrome.exe",
      args: [`--profile-directory=${profileDirectory}`, url],
    };
  }
  return {
    cmd: "google-chrome",
    args: [`--profile-directory=${profileDirectory}`, url],
  };
}
