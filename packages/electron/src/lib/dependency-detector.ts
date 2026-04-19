/**
 * Detects whether required CLI tools are installed.
 *
 * All detection delegates to the shared `ToolRegistry`. This module
 * translates `Resolution` records into the `DetectionResult` shape
 * still consumed by the Electron wizard and `doctor.ts`. New code
 * SHOULD read the registry directly via
 * `getDefaultRegistry().resolve(name)` to access the full diagnostic
 * trail.
 *
 * See change: consolidate-tool-resolution.
 */
import { execSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  getDefaultRegistry,
  type Resolution,
} from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import { MANAGED_BIN, MANAGED_DIR } from "./managed-paths.js";

// Local resolver for inline lookups (pi-dashboard existence check).
// The registry doesn't cover `pi-dashboard` since it's the package
// this code is part of, not a spawn target.
const resolver = new ToolResolver({ processExecPath: process.execPath, useLoginShell: true });

export interface DetectionResult {
  found: boolean;
  path?: string;
  source?: "system" | "managed" | "settings";
  /** Full resolution trail from the ToolRegistry (new field — optional for callers). */
  resolution?: Resolution;
}

// ── Registry → DetectionResult adapter ──────────────────────────────────────

/**
 * Convert a registry `Resolution` into the legacy `DetectionResult`
 * shape. `source` collapses the richer Source union into the three
 * values existing callers understand: "managed" (from managed-install
 * strategy) or "system" (everything else that resolved).
 */
function fromResolution(res: Resolution): DetectionResult {
  if (!res.ok || !res.path) {
    return { found: false, resolution: res };
  }
  const source: DetectionResult["source"] = res.source === "managed" ? "managed" : "system";
  return { found: true, path: res.path, source, resolution: res };
}

function detect(toolName: string): DetectionResult {
  const registry = getDefaultRegistry();
  if (!registry.has(toolName)) return { found: false };
  return fromResolution(registry.resolve(toolName));
}

// ── Public API ──────────────────────────────────────────────────────────────

export function detectPi(): DetectionResult {
  return detect("pi");
}

export function detectOpenSpec(): DetectionResult {
  return detect("openspec");
}

/**
 * Detect Node.js with version ≥ 20.6 enforcement.
 *
 * The registry only resolves a path; the version gate is a downstream
 * policy concern, so we check it here. A resolved-but-too-old Node is
 * reported as `{ found: false }` so the installer prompts for an
 * upgrade (existing behavior preserved).
 */
export function detectSystemNode(): DetectionResult {
  const base = detect("node");
  if (!base.found || !base.path) return { found: false };

  try {
    const version = execSync(`"${base.path}" --version`, { encoding: "utf-8" }).trim();
    const match = version.match(/^v(\d+)\.(\d+)/);
    if (match) {
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      if (major > 20 || (major === 20 && minor >= 6)) return base;
    }
  } catch { /* ignore */ }
  return { found: false, resolution: base.resolution };
}

/**
 * Detect the dashboard package itself. `pi-dashboard` is deliberately
 * NOT a registered tool (it's the package this code is part of, not an
 * external dep) — so we do the managed + npm-global existence check
 * inline instead of going through the registry.
 */
export function detectDashboardPackage(): DetectionResult {
  const pkg = "@blackbelt-technology/pi-agent-dashboard";
  const managedPkg = path.join(MANAGED_DIR, "node_modules", pkg, "package.json");
  if (existsSync(managedPkg)) {
    return { found: true, path: managedPkg, source: "managed" };
  }
  // Fall back to the global npm tree. `resolver.which` finds the pi
  // binary; we derive the global node_modules from its package.json.
  try {
    const npmRoot = resolver.which("npm");
    if (!npmRoot) return { found: false };
    // Best-effort: check the standard global layout derived from pi's install.
    const globalPkg = path.join(path.dirname(path.dirname(npmRoot)), "node_modules", pkg, "package.json");
    if (existsSync(globalPkg)) {
      return { found: true, path: globalPkg, source: "system" };
    }
  } catch { /* ignore */ }
  return { found: false };
}

/**
 * Detect the bridge extension by checking:
 * 1. pi's settings.json packages[] for any entry containing "pi-dashboard"
 * 2. npm package locations (managed + global) as fallback
 */
export function detectBridgeExtension(): DetectionResult {
  const settingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
  try {
    if (existsSync(settingsPath)) {
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
  return detectDashboardPackage();
}

/**
 * Detect the pi-dashboard CLI on PATH. Excludes npx cache shims.
 *
 * pi-dashboard isn't a registered tool (it's the dashboard itself),
 * so we resolve it inline via the same `which` primitive the registry
 * uses — via `ToolResolver.which` through a minimal registry path.
 */
export function detectPiDashboardCli(): DetectionResult {
  // Resolve by registering an ephemeral binary tool. Simpler and more
  // direct: call ToolResolver.which via a small helper.
  // Keep consistent with historical classification (npx exclusion).
  const managed = path.join(MANAGED_BIN, process.platform === "win32" ? "pi-dashboard.cmd" : "pi-dashboard");
  if (existsSync(managed)) return { found: true, path: managed, source: "managed" };

  try {
    const cmd = process.platform === "win32" ? `where pi-dashboard` : `which pi-dashboard`;
    const out = execSync(cmd, { encoding: "utf-8" }).trim().split(/\r?\n/)[0];
    if (!out) return { found: false };
    if (out.includes(".npm/_npx") || out.includes(".npm\\_npx")) return { found: false };
    return { found: true, path: out, source: "system" };
  } catch {
    return { found: false };
  }
}
