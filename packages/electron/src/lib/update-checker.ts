/**
 * Checks for newer versions of pi and openspec.
 * Runs on launch and every 24 hours.
 *
 * Update strategy is derived from health.starter (Phase C):
 *   - "Electron"   → in-app updater handles version checks
 *   - "Standalone" → notify to run `npm update -g @blackbelt-technology/pi-agent-dashboard`
 *   - "Bridge"     → notify to update pi for a new dashboard version
 *
 * See change: simplify-electron-bootstrap-derived-state (task 6.7).
 *
 * Delegates all npm invocations to the shared `platform/npm.ts` module
 * so cross-cutting concerns (windowsHide, timeouts, exit-1 tolerance for
 * `npm outdated`) are centralized.
 * See change: platform-command-executor.
 */
import * as npm from "@blackbelt-technology/pi-dashboard-shared/platform/npm.js";
import os from "node:os";
import path from "node:path";
import { loadMinimalConfig } from "./server-lifecycle.js";

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

/** Fetch current server starter from /api/health. Returns null on error. */
async function getServerStarter(port: number): Promise<string | null> {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    return typeof data.starter === "string" ? data.starter : null;
  } catch {
    return null;
  }
}

/**
 * Check for outdated packages. Returns list of packages with available updates.
 * Strategy depends on the server's starter field.
 */
export function checkOutdated(starter?: string | null): OutdatedPackage[] {
  const results: OutdatedPackage[] = [];

  // Bridge: updates come via pi — nothing to check here.
  if (starter === "Bridge") return results;

  for (const pkg of PACKAGES_TO_CHECK) {
    const outdated = starter === "Standalone"
      ? checkGlobalOutdated(pkg)     // Standalone — check global install
      : checkManagedOutdated(pkg);   // Electron or unknown — check managed install
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
export function updatePackage(pkg: string, starter: string | null): void {
  if (starter === "Standalone") {
    const r = npm.installGlobal({ pkg, version: "latest" });
    if (!r.ok) throw new Error(`npm install -g failed: ${JSON.stringify(r.error)}`);
  } else {
    const managedDir = path.join(os.homedir(), ".pi-dashboard");
    const r = npm.install({ cwd: managedDir, pkg, version: "latest" });
    if (!r.ok) throw new Error(`npm install failed: ${JSON.stringify(r.error)}`);
  }
}

/**
 * Start the periodic update checker. Returns a cleanup function.
 */
export function startUpdateChecker(
  onUpdatesAvailable: (packages: OutdatedPackage[], starter: string | null) => void,
): () => void {
  const config = loadMinimalConfig();

  const runCheck = async () => {
    const starter = await getServerStarter(config.port);
    // Bridge starter: updates are pi's responsibility — skip.
    if (starter === "Bridge") return;
    const outdated = checkOutdated(starter);
    if (outdated.length > 0) onUpdatesAvailable(outdated, starter);
  };

  // Initial check after 30s delay (don't block startup)
  const initialTimer = setTimeout(() => void runCheck(), 30_000);

  // Periodic check every 24h
  const intervalTimer = setInterval(() => void runCheck(), CHECK_INTERVAL_MS);

  return () => {
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}
