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
