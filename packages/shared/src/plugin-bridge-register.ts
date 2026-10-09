/**
 * Plugin bridge entry management in pi's settings.json.
 *
 * Manages `dashboard-<plugin-id>` keys in a dedicated
 * `dashboardPluginBridges` object inside settings.json AND mirrors each
 * managed bridge path into the top-level `packages[]` array so
 * pi-coding-agent (which only reads `packages[]`) actually loads the
 * bridge as an extension.
 *
 * See change: fix-pi-flows-end-to-end (Group 1).
 *
 * Ownership tracking:
 * - `dashboardPluginBridges["dashboard-<id>"] = "<absPath>"`  — managed key
 * - `_dashboardManagedPackages["<absPath>"] = "<id>"`         — ownership map
 * - `packages[]` gains a plain string entry `"<absPath>"`     — readable by pi
 *
 * Rules:
 * - Only touches entries under managed keys / paths.
 * - NEVER modifies user-owned `packages[]` entries (those without an entry
 *   in `_dashboardManagedPackages`).
 * - Uses atomic write (tmp + rename) for all updates.
 * - Detects path conflicts (existing entry with mismatched path).
 *
 * Escape hatch: setting `PI_DASHBOARD_DISABLE_PLUGIN_BRIDGE_PACKAGES_WRITE=1`
 * skips the `packages[]` write (rollback parity with pre-change behavior).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { BridgeLoadSource } from "./dashboard-plugin/plugin-status.js";

export interface PluginBridgeRegisterOptions {
  homedir?: string;
  /** Override env-driven escape hatch for tests. */
  skipPackagesWrite?: boolean;
}

export type PluginBridgeConflict =
  | { type: "ok" }
  | { type: "conflict"; existingPath: string; newPath: string };

const MANAGED_PREFIX = "dashboard-";
const OWNERSHIP_KEY = "_dashboardManagedPackages";
const ENV_SKIP = "PI_DASHBOARD_DISABLE_PLUGIN_BRIDGE_PACKAGES_WRITE";

function getSettingsPath(homedir?: string): string {
  const home = homedir ?? process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();
  return path.join(home, ".pi", "agent", "settings.json");
}

function readSettings(settingsPath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(settingsPath)) return {};
    const raw = fs.readFileSync(settingsPath, "utf-8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeSettings(settingsPath: string, settings: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tmp = settingsPath + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
  fs.renameSync(tmp, settingsPath);
}

function getManagedBridges(
  settings: Record<string, unknown>,
): Record<string, string> {
  const val = settings.dashboardPluginBridges;
  if (val && typeof val === "object" && !Array.isArray(val)) {
    return val as Record<string, string>;
  }
  return {};
}

function getOwnershipMap(
  settings: Record<string, unknown>,
): Record<string, string> {
  const val = settings[OWNERSHIP_KEY];
  if (val && typeof val === "object" && !Array.isArray(val)) {
    return val as Record<string, string>;
  }
  return {};
}

function getPackages(settings: Record<string, unknown>): unknown[] {
  const val = settings.packages;
  return Array.isArray(val) ? val : [];
}

function packageEntryPath(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const src = (entry as Record<string, unknown>).source;
    if (typeof src === "string") return src;
  }
  return null;
}

function shouldSkipPackagesWrite(opts: PluginBridgeRegisterOptions): boolean {
  if (opts.skipPackagesWrite === true) return true;
  if (opts.skipPackagesWrite === false) return false;
  return process.env[ENV_SKIP] === "1";
}

// ─────────────────────────────────────────────────────────────────────────
// Pure helpers (Task 1.1)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Ensure `packages[]` contains `bridgePath` and record ownership.
 * No-op when entry already present. Mutates `packages` and `ownership` in place.
 * Returns `true` if a new entry was added.
 */
export function ensurePackageEntry(
  packages: unknown[],
  ownership: Record<string, string>,
  bridgePath: string,
  ownerMarker: string,
): boolean {
  const already = packages.some((e) => packageEntryPath(e) === bridgePath);
  ownership[bridgePath] = ownerMarker; // record ownership regardless
  if (already) return false;
  packages.push(bridgePath);
  return true;
}

/**
 * Remove a managed `packages[]` entry whose ownership matches `ownerMarker`.
 * Leaves user-added entries (no matching ownership record) untouched.
 * Mutates `packages` and `ownership` in place. Returns `true` if removed.
 */
export function removePackageEntry(
  packages: unknown[],
  ownership: Record<string, string>,
  ownerMarker: string,
): boolean {
  const owned = Object.entries(ownership)
    .filter(([, owner]) => owner === ownerMarker)
    .map(([p]) => p);
  if (owned.length === 0) return false;
  let removed = false;
  for (const p of owned) {
    const idx = packages.findIndex((e) => packageEntryPath(e) === p);
    if (idx >= 0) {
      packages.splice(idx, 1);
      removed = true;
    }
    delete ownership[p];
  }
  return removed;
}

// ─────────────────────────────────────────────────────────────────────────
// Public API (Tasks 1.2, 1.3, 1.4)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Register a plugin's bridge entry in pi's settings.json.
 *
 * Writes to BOTH:
 *  - `dashboardPluginBridges["dashboard-<pluginId>"]` (forward-compat)
 *  - `packages[]` + ownership record (so pi-coding-agent loads the bridge)
 *
 * Returns { type: "conflict", existingPath, newPath } if a
 * `dashboard-<pluginId>` key already exists but points to a different path.
 * In that case the settings.json is NOT modified.
 *
 * Returns { type: "ok" } on success (including when the entry already matches).
 */
export function registerPluginBridge(
  pluginId: string,
  bridgePath: string,
  opts: PluginBridgeRegisterOptions = {},
): PluginBridgeConflict {
  const settingsPath = getSettingsPath(opts.homedir);
  const settings = readSettings(settingsPath);
  const managed = getManagedBridges(settings);
  const ownership = getOwnershipMap(settings);
  const packages = getPackages(settings);
  const key = MANAGED_PREFIX + pluginId;
  const ownerMarker = key;

  const existing = managed[key];
  if (existing && existing !== bridgePath) {
    // Self-heal: if the existing path no longer resolves on disk (typical
    // after a dev-monorepo → deployed-bundle path change), silently replace.
    // This avoids cosmetic "Bridge path conflict" errors on every restart
    // when the user switches between dev and production launch sources.
    // See change: add-plugin-activation-ui (deployment-fix follow-up).
    let existingStillOnDisk = true;
    try {
      existingStillOnDisk = fs.existsSync(existing);
    } catch {
      existingStillOnDisk = false;
    }
    if (existingStillOnDisk) {
      return { type: "conflict", existingPath: existing, newPath: bridgePath };
    }
    // Strip the stale entry and matching ownership/packages mirrors so the
    // subsequent register block below installs the new path cleanly.
    delete managed[key];
    if (ownership[existing] === ownerMarker) delete ownership[existing];
    const idx = packages.indexOf(existing);
    if (idx >= 0) packages.splice(idx, 1);
  }

  let mutated = false;
  if (!managed[key]) {
    managed[key] = bridgePath;
    settings.dashboardPluginBridges = managed;
    mutated = true;
  }

  if (!shouldSkipPackagesWrite(opts)) {
    const ownershipBefore = ownership[bridgePath];
    const added = ensurePackageEntry(packages, ownership, bridgePath, ownerMarker);
    if (added || ownershipBefore !== ownerMarker) {
      mutated = true;
      settings.packages = packages;
      settings[OWNERSHIP_KEY] = ownership;
    }
  }

  if (mutated) {
    writeSettings(settingsPath, settings);
    console.info(`[plugin-bridge] Registered bridge for plugin "${pluginId}": ${bridgePath}`);
  }
  return { type: "ok" };
}

/**
 * Remove a plugin's bridge entry from pi's settings.json.
 * Removes BOTH the `dashboardPluginBridges` key AND the matching ownership-marked
 * `packages[]` entry. No-op if neither exists.
 * NEVER touches entries without matching ownership.
 */
export function deregisterPluginBridge(
  pluginId: string,
  opts: PluginBridgeRegisterOptions = {},
): void {
  const settingsPath = getSettingsPath(opts.homedir);
  const settings = readSettings(settingsPath);
  const managed = getManagedBridges(settings);
  const ownership = getOwnershipMap(settings);
  const packages = getPackages(settings);
  const key = MANAGED_PREFIX + pluginId;
  const ownerMarker = key;

  let mutated = false;

  if (key in managed) {
    delete managed[key];
    settings.dashboardPluginBridges = managed;
    mutated = true;
  }

  if (removePackageEntry(packages, ownership, ownerMarker)) {
    settings.packages = packages;
    settings[OWNERSHIP_KEY] = ownership;
    mutated = true;
  }

  if (mutated) {
    writeSettings(settingsPath, settings);
    console.info(`[plugin-bridge] Deregistered bridge for plugin "${pluginId}"`);
  }
}

/**
 * Register all plugins with bridge entries from the discovery list.
 * Returns a map of pluginId → conflict/ok result.
 * Plugins with conflicts are NOT registered; caller should surface via /api/health.
 */
export function registerAllPluginBridges(
  plugins: Array<{ pluginId: string; bridgePath: string }>,
  opts: PluginBridgeRegisterOptions = {},
): Record<string, PluginBridgeConflict> {
  const results: Record<string, PluginBridgeConflict> = {};
  for (const { pluginId, bridgePath } of plugins) {
    results[pluginId] = registerPluginBridge(pluginId, bridgePath, opts);
  }
  return results;
}

/**
 * Make the registered bridges follow plugin enablement (spec
 * dashboard-plugin-loader "Disable removes managed entries from both
 * registries"): register every `enabled` plugin's bridge, deregister every
 * disabled one (both `dashboardPluginBridges` and its ownership-marked
 * `packages[]` entry; user-owned entries are never touched). `enabled` is the
 * caller-resolved predicate (`resolvePluginEnabled(cfg, manifest.defaultEnabled)`).
 * Returns register results for the enabled plugins only.
 * See change: add-plugin-bridge-contributions (D13).
 */
export function syncPluginBridges(
  plugins: Array<{ pluginId: string; bridgePath: string; enabled: boolean }>,
  opts: PluginBridgeRegisterOptions = {},
): Record<string, PluginBridgeConflict> {
  for (const p of plugins) {
    if (!p.enabled) deregisterPluginBridge(p.pluginId, opts);
  }
  return registerAllPluginBridges(
    plugins.filter((p) => p.enabled).map(({ pluginId, bridgePath }) => ({ pluginId, bridgePath })),
    opts,
  );
}

/**
 * One-shot reconciliation (Task 1.4): for each entry in
 * `dashboardPluginBridges`, ensure a matching `packages[]` entry exists with
 * the same ownership marker. Heals installs that pre-date the dual-write.
 *
 * Returns a list of `{ pluginId, bridgePath, action }` summaries — `"added"`
 * when a new packages[] entry was inserted, `"already"` when no change needed.
 */
export function reconcilePluginBridgePackages(
  opts: PluginBridgeRegisterOptions = {},
): Array<{ pluginId: string; bridgePath: string; action: "added" | "already" }> {
  if (shouldSkipPackagesWrite(opts)) return [];
  const settingsPath = getSettingsPath(opts.homedir);
  const settings = readSettings(settingsPath);
  const managed = getManagedBridges(settings);
  const ownership = getOwnershipMap(settings);
  const packages = getPackages(settings);

  const summary: Array<{ pluginId: string; bridgePath: string; action: "added" | "already" }> = [];
  let mutated = false;

  for (const [key, bridgePath] of Object.entries(managed)) {
    if (!key.startsWith(MANAGED_PREFIX)) continue;
    const pluginId = key.slice(MANAGED_PREFIX.length);
    const ownershipBefore = ownership[bridgePath];
    const added = ensurePackageEntry(packages, ownership, bridgePath, key);
    summary.push({ pluginId, bridgePath, action: added ? "added" : "already" });
    if (added) mutated = true;
    // `ensurePackageEntry` already wrote `ownership[bridgePath] = key`
    // unconditionally. Compare the previous value (`ownershipBefore`) to
    // detect whether persistence is needed for the ownership marker. This
    // fixes a bug where the marker was set in memory but the file write
    // was skipped because the *current* ownership equalled `key`.
    if (ownershipBefore !== key) mutated = true;
  }

  if (mutated) {
    settings.packages = packages;
    settings[OWNERSHIP_KEY] = ownership;
    writeSettings(settingsPath, settings);
    for (const { pluginId, bridgePath, action } of summary) {
      if (action === "added") {
        console.info(
          `[plugin-bridge] Reconciled packages[] entry for plugin "${pluginId}": ${bridgePath}`,
        );
      }
    }
  }
  return summary;
}

/**
 * List all currently managed plugin bridge entries.
 */
export function listManagedBridges(
  opts: PluginBridgeRegisterOptions = {},
): Record<string, string> {
  const settingsPath = getSettingsPath(opts.homedir);
  const settings = readSettings(settingsPath);
  return getManagedBridges(settings);
}

/**
 * Inspect ownership map (for diagnostics / health).
 */
export function listManagedPackageOwnership(
  opts: PluginBridgeRegisterOptions = {},
): Record<string, string> {
  const settingsPath = getSettingsPath(opts.homedir);
  const settings = readSettings(settingsPath);
  return getOwnershipMap(settings);
}

/**
 * Classify where a bridge path is registered in pi's settings.
 *
 * Precedence (intentional — packages[] is what pi actually loads, so it wins
 * even when both keys point at the same path):
 *   1. matching entry in `packages[]` → `"packages[]"`
 *   2. matching value in `dashboardPluginBridges` → `"dashboardPluginBridges"`
 *   3. no match → `"none"`
 *
 * Used by `/api/health.plugins[].bridgeLoadedFrom`. See change:
 * fix-pi-flows-end-to-end (Group 2, task 2.2).
 */
export function classifyBridgeSource(
  settings: unknown,
  bridgePath: string,
): BridgeLoadSource {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return "none";
  }
  const s = settings as Record<string, unknown>;

  const packages = Array.isArray(s.packages) ? s.packages : [];
  for (const entry of packages) {
    if (packageEntryPath(entry) === bridgePath) return "packages[]";
  }

  const bridges = s.dashboardPluginBridges;
  if (bridges && typeof bridges === "object" && !Array.isArray(bridges)) {
    for (const value of Object.values(bridges as Record<string, unknown>)) {
      if (value === bridgePath) return "dashboardPluginBridges";
    }
  }

  return "none";
}
