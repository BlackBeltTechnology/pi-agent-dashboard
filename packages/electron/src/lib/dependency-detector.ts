/**
 * Detects whether required CLI tools are installed.
 * Checks system PATH first, then the managed install at ~/.pi-dashboard/.
 */
import { execSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import * as npm from "@blackbelt-technology/pi-dashboard-shared/platform/npm.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { MANAGED_DIR, MANAGED_BIN } from "./managed-paths.js";

export interface DetectionResult {
  found: boolean;
  path?: string;
  source?: "system" | "managed" | "settings";
}

/** Resolve a command on PATH. Returns the absolute path or null.
 *  On macOS/Linux, falls back to a login shell to pick up nvm/volta/homebrew paths
 *  that GUI apps don't inherit from the system PATH.
 */
function whichSync(cmd: string): string | null {
  const whichCmd = process.platform === "win32" ? "where" : "which";
  // 1. Try current process PATH
  try {
    return execSync(`${whichCmd} ${cmd}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim().split("\n")[0];
  } catch { /* not on process PATH */ }

  // 2. On macOS/Linux, try a login shell to get the full user PATH
  //    (GUI apps don't inherit shell rc files where nvm/volta/homebrew are configured)
  if (process.platform !== "win32") {
    const shell = process.env.SHELL || "/bin/zsh";
    try {
      const output = execSync(`${shell} -ilc "which ${cmd}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 5000,
      }).trim();
      // Extract the absolute path from output (login shells may emit session
      // restore noise like "Restored session:..." and "Saving session...")
      const pathLine = output.split("\n").find(l => l.trim().startsWith("/"));
      return pathLine?.trim() || null;
    } catch { /* not found in login shell either */ }
  }

  return null;
}

/** Check system PATH, then managed install. */
function detect(binaryName: string): DetectionResult {
  // 1. System PATH
  const systemPath = whichSync(binaryName);
  if (systemPath) {
    return { found: true, path: systemPath, source: "system" };
  }

  // 2. Managed install
  const ext = process.platform === "win32" ? ".cmd" : "";
  const managedPath = path.join(MANAGED_BIN, binaryName + ext);
  if (existsSync(managedPath)) {
    return { found: true, path: managedPath, source: "managed" };
  }

  return { found: false };
}

export function detectPi(): DetectionResult {
  return detect("pi");
}

export function detectOpenSpec(): DetectionResult {
  return detect("openspec");
}

export function detectSystemNode(): DetectionResult {
  const nodePath = whichSync("node");
  if (!nodePath) return { found: false };

  // Check version >= 20.6
  try {
    const version = execSync(`"${nodePath}" --version`, { encoding: "utf-8" }).trim();
    const match = version.match(/^v(\d+)\.(\d+)/);
    if (match) {
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      if (major > 20 || (major === 20 && minor >= 6)) {
        return { found: true, path: nodePath, source: "system" };
      }
    }
  } catch { /* ignore */ }

  return { found: false };
}

export function detectDashboardPackage(): DetectionResult {
  // Check managed install
  const managedPkg = path.join(MANAGED_DIR, "node_modules", "@blackbelt-technology", "pi-agent-dashboard", "package.json");
  if (existsSync(managedPkg)) {
    return { found: true, path: managedPkg, source: "managed" };
  }

  // Check global npm install (shared npm module handles windowsHide + caching).
  const npmRoot = npm.rootGlobalOr("");
  if (npmRoot) {
    const globalPkg = path.join(npmRoot, "@blackbelt-technology", "pi-agent-dashboard", "package.json");
    if (existsSync(globalPkg)) {
      return { found: true, path: globalPkg, source: "system" };
    }
  }

  return { found: false };
}

/**
 * Detect the bridge extension by checking:
 * 1. pi's settings.json packages[] for any entry containing "pi-dashboard"
 * 2. npm package locations (managed + global) as fallback
 */
export function detectBridgeExtension(): DetectionResult {
  // 1. Check pi's settings.json packages array
  const settingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
  try {
    const settingsExist = existsSync(settingsPath);
    if (settingsExist) {
      const raw = readFileSync(settingsPath, "utf-8").trim();
      if (raw) {
        const data = JSON.parse(raw);
        const packages = Array.isArray(data?.packages) ? data.packages : [];
        for (const entry of packages) {
          if (typeof entry === "string" && (entry.includes("pi-dashboard") || entry.includes("pi-agent-dashboard"))) {
            return { found: true, path: entry, source: "settings" };
          }
        }
      }
    }
  } catch { /* corrupt or unreadable settings */ }

  // 2. Fall back to npm package location checks
  return detectDashboardPackage();
}

/**
 * Detect the pi-dashboard CLI on PATH.
 * Excludes npx cache shims (.npm/_npx/) to avoid matching ephemeral installs.
 */
export function detectPiDashboardCli(): DetectionResult {
  const cliPath = whichSync("pi-dashboard");
  if (!cliPath) return { found: false };

  // Exclude npx cache paths
  if (cliPath.includes(".npm/_npx") || cliPath.includes(".npm\\_npx")) {
    return { found: false };
  }

  return { found: true, path: cliPath, source: "system" };
}
