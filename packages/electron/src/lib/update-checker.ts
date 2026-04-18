/**
 * Checks for newer versions of pi and openspec.
 * Runs on launch and every 24 hours.
 *
 * Delegates all npm invocations to the shared `platform/npm.ts` module
 * so cross-cutting concerns (windowsHide, timeouts, exit-1 tolerance for
 * `npm outdated`) are centralized.
 * See change: platform-command-executor.
 */
import * as npm from "@blackbelt-technology/pi-dashboard-shared/platform/npm.js";
import os from "node:os";
import path from "node:path";
import { readModeFile } from "./wizard-state.js";

export interface OutdatedPackage {
  name: string;
  current: string;
  latest: string;
}

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

const PACKAGES_TO_CHECK = [
  "@mariozechner/pi-coding-agent",
  "@fission-ai/openspec",
];

/**
 * Check for outdated packages. Returns list of packages with available updates.
 */
export function checkOutdated(): OutdatedPackage[] {
  const modeConfig = readModeFile();
  const results: OutdatedPackage[] = [];

  for (const pkg of PACKAGES_TO_CHECK) {
    const outdated = modeConfig?.mode === "standalone"
      ? checkManagedOutdated(pkg)
      : checkGlobalOutdated(pkg);
    if (outdated) results.push(outdated);
  }

  return results;
}

function checkManagedOutdated(pkg: string): OutdatedPackage | null {
  const managedDir = path.join(os.homedir(), ".pi-dashboard");
  const data = npm.outdatedOr({ cwd: managedDir, pkg }) as Record<string, any> | null;
  return parseOutdatedEntry(pkg, data);
}

function checkGlobalOutdated(pkg: string): OutdatedPackage | null {
  const data = npm.outdatedGlobalOr({ pkg }) as Record<string, any> | null;
  return parseOutdatedEntry(pkg, data);
}

function parseOutdatedEntry(pkg: string, data: Record<string, any> | null): OutdatedPackage | null {
  if (!data) return null;
  const info = data[pkg];
  if (info?.current && info?.latest && info.current !== info.latest) {
    return { name: pkg, current: info.current, latest: info.latest };
  }
  return null;
}

/**
 * Run update for a specific package.
 */
export function updatePackage(pkg: string): void {
  const modeConfig = readModeFile();
  if (modeConfig?.mode === "standalone") {
    const managedDir = path.join(os.homedir(), ".pi-dashboard");
    const r = npm.install({ cwd: managedDir, pkg, version: "latest" });
    if (!r.ok) throw new Error(`npm install failed: ${JSON.stringify(r.error)}`);
  } else {
    const r = npm.installGlobal({ pkg, version: "latest" });
    if (!r.ok) throw new Error(`npm install -g failed: ${JSON.stringify(r.error)}`);
  }
}

/**
 * Start the periodic update checker. Returns a cleanup function.
 */
export function startUpdateChecker(
  onUpdatesAvailable: (packages: OutdatedPackage[]) => void,
): () => void {
  // Initial check after 30s delay (don't block startup)
  const initialTimer = setTimeout(() => {
    const outdated = checkOutdated();
    if (outdated.length > 0) onUpdatesAvailable(outdated);
  }, 30_000);

  // Periodic check every 24h
  const intervalTimer = setInterval(() => {
    const outdated = checkOutdated();
    if (outdated.length > 0) onUpdatesAvailable(outdated);
  }, CHECK_INTERVAL_MS);

  return () => {
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}
