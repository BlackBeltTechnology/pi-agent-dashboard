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
import { execSync, execFileSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  getDefaultRegistry,
  type Resolution,
} from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { ToolResolver, isAppImageSelfHit } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import { isUsableNodeVersion } from "@blackbelt-technology/pi-dashboard-shared/node-version.js";
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
  const result = fromResolution(registry.resolve(toolName));
  // Defense-in-depth: even though `whereStrategy` filters AppImage
  // self-hits at the registry layer, re-check on the resolved path so
  // future registry edits or override-pinned bogus paths cannot slip
  // an AppImage launcher through. Symmetry with `detectPiDashboardCli`.
  // See change: fix-electron-appimage-cli-self-detection (D3).
  if (result.found && result.path && isAppImageSelfHit(result.path)) {
    return { found: false, resolution: result.resolution };
  }
  return result;
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
  if (base.found && base.path) {
    try {
      const version = execSync(`"${base.path}" --version`, { encoding: "utf-8" }).trim();
      // Usable iff the dashboard server would actually run on it: within
      // engines range AND not nodejs/node#58515-affected. See change:
      // unify-node-version-gate.
      if (isUsableNodeVersion(version)) {
        return base;
      }
    } catch { /* ignore */ }
  }
  // Fallback: scan well-known on-disk locations for a usable Node.
  // Required because GUI-launched apps on macOS don't inherit the user's
  // shell PATH (where nvm/volta/brew live), and the login-shell whichifier
  // can return a Node that is itself below floor / in the affected range.
  // See change: unify-node-version-gate.
  const scanned = scanForUsableNodeOnDisk();
  if (scanned) {
    return { found: true, path: scanned, source: "system" };
  }
  return { found: false, resolution: base.resolution };
}

/**
 * Scan well-known on-disk dirs for a Node binary that is (a) executable
 * and (b) version-usable per the shared `isUsableNodeVersion` gate (within
 * engines range AND not nodejs/node#58515-affected). Returns the path of
 * the highest-version usable Node found.
 *
 * Searched (in order):
 *   1. `~/.nvm/versions/node/<each>/bin/node`
 *   2. `/opt/homebrew/bin/node`         (Apple Silicon brew)
 *   3. `/usr/local/bin/node`            (Intel brew / classic)
 *   4. `~/.volta/bin/node`
 *   5. `/usr/bin/node`
 *
 * No version-gate fallback to affected versions — the picker would
 * refuse to use them anyway, so emitting them here only wastes a probe.
 */
function scanForUsableNodeOnDisk(): string | null {
  if (process.platform === "win32") return null; // Windows path is different; keep this Unix-only for now.
  const home = os.homedir();
  const candidates: string[] = [];
  // nvm: enumerate installed versions, highest first.
  const nvmRoot = path.join(home, ".nvm", "versions", "node");
  if (existsSync(nvmRoot)) {
    try {
      const versions = readdirSync(nvmRoot)
        .filter((d) => /^v?\d+\.\d+\.\d+/.test(d))
        .sort((a, b) => compareSemverDesc(a, b));
      for (const v of versions) {
        candidates.push(path.join(nvmRoot, v, "bin", "node"));
      }
    } catch { /* ignore */ }
  }
  candidates.push(
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    path.join(home, ".volta", "bin", "node"),
    "/usr/bin/node",
  );
  for (const cand of candidates) {
    if (!existsSync(cand)) continue;
    try {
      const v = execFileSync(cand, ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
      if (!isUsableNodeVersion(v)) continue;
      return cand;
    } catch { /* skip unreadable / non-executable candidates */ }
  }
  return null;
}

/** Sort semver-ish version strings ("v22.22.0", "22.22.0") descending. */
function compareSemverDesc(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10));
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return db - da;
  }
  return 0;
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
 * Detect the pi-dashboard CLI on PATH.
 *
 * Filters two known-bogus shapes that can otherwise win the lookup race:
 *   1. **`_npx` cache shims** (`~/.npm/_npx/<hash>/...`) — ephemeral
 *      installs that disappear after their command finishes; spawning
 *      them is unsafe because the shim may be unlinked mid-run.
 *   2. **AppImage self-hits** (e.g. `/tmp/.mount_PI...` mount,
 *      `process.execPath`, `process.env.APPIMAGE`) — the AppImage
 *      runtime prepends its squashfs mount to PATH, and
 *      `packagerConfig.executableName = "pi-dashboard"` makes the
 *      Electron launcher itself collide with the dashboard CLI name.
 *      Trusting the first hit spawns Electron recursively, never opens
 *      the dashboard port, and `waitForReady` times out. See change:
 *      fix-electron-appimage-cli-self-detection.
 *
 * pi-dashboard isn't a registered tool (it's the dashboard package
 * itself), so we resolve it inline via the same `which` primitive the
 * registry uses. Both filters silently return `{ found: false }` so
 * callers fall through to the standalone tsx + cli.ts launch path.
 */
/**
 * Pure helper extracted for testability: pick the spawnable candidate from
 * `where`/`which` output. On Windows, `where` returns multiple lines when an
 * extensionless POSIX shim sits next to a `.cmd` shim; `lines[0]` is the
 * extensionless one; `spawn(path, args, { shell: false })` cannot invoke an
 * extensionless shim and produces `ENOENT`. Filtering for executable
 * extensions ensures we always pick a spawnable candidate.
 *
 * POSIX (`which`) returns at most one line; the Windows-only branch is the
 * only behavioural change. Falls back to `lines[0]` when no candidate has a
 * recognised executable extension. See change:
 * fix-electron-windows-installer-and-server-bootstrap (Defect 3).
 */
export function pickSpawnableShim(
  rawWhereOutput: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const lines = rawWhereOutput.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return null;
  if (platform !== "win32") return lines[0]!;
  return lines.find((l) => /\.(cmd|exe|bat|ps1)$/i.test(l)) ?? lines[0]!;
}

export function detectPiDashboardCli(): DetectionResult {
  const managed = path.join(MANAGED_BIN, process.platform === "win32" ? "pi-dashboard.cmd" : "pi-dashboard");
  if (existsSync(managed)) return { found: true, path: managed, source: "managed" };

  try {
    const cmd = process.platform === "win32" ? `where pi-dashboard` : `which pi-dashboard`;
    const raw = execSync(cmd, { encoding: "utf-8" });
    const out = pickSpawnableShim(raw);
    if (!out) return { found: false };
    if (out.includes(".npm/_npx") || out.includes(".npm\\_npx")) return { found: false };
    if (isAppImageSelfHit(out)) return { found: false };
    return { found: true, path: out, source: "system" };
  } catch {
    return { found: false };
  }
}
