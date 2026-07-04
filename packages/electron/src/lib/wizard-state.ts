/**
 * Dashboard settings persistence: `~/.pi-dashboard/dashboard-settings.json`
 * (mode + remoteUrl + recentRemotes) and API key detection.
 *
 * The settings file was named `mode.json` prior to
 * `auto-launch-first-run-skip-welcome`; it now also stores the recent-servers
 * list, so "mode" undersold it. `readModeFile()` migrates a legacy `mode.json`
 * to the new name on first read. Function names `readModeFile`/`writeModeFile`
 * are retained for call-site stability.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasAnyProviderCredential } from "@blackbelt-technology/pi-dashboard-shared/credential-detect.js";

function getManagedDir() { return path.join(os.homedir(), ".pi-dashboard"); }
function getSettingsFile() { return path.join(getManagedDir(), "dashboard-settings.json"); }
function getLegacyModeFile() { return path.join(getManagedDir(), "mode.json"); }
function getPiSettings() { return path.join(os.homedir(), ".pi", "agent", "settings.json"); }
function getRecommendedStateFile() { return path.join(getManagedDir(), "recommended.json"); }

/** MRU cap for the recent-servers list. */
const RECENT_REMOTES_CAP = 8;

export type WizardMode = "standalone" | "power-user" | "remote";

/** A previously-connected remote dashboard, most-recently-used first. */
export interface RecentRemote {
  url: string;
  lastUsed: string;
}

export interface DashboardSettings {
  mode: WizardMode;
  completedAt: string;
  /**
   * Set only when `mode === "remote"`: the dashboard server URL the Electron
   * shell attaches to directly (e.g. a Docker-hosted server). See change:
   * docker-packaging.
   */
  remoteUrl?: string;
  /** MRU list of remote dashboards the user has connected to (cap 8). */
  recentRemotes?: RecentRemote[];
}

/** @deprecated Renamed to {@link DashboardSettings}. Alias kept for compat. */
export type ModeConfig = DashboardSettings;

/**
 * Read the raw settings object. Migrates a legacy `mode.json` to
 * `dashboard-settings.json` (rewrite + delete legacy) when the new file is
 * absent but the legacy one exists. Returns null when neither exists or the
 * JSON is corrupt. Does NOT validate `mode` — callers that care use
 * {@link readModeFile}.
 */
function readRawSettings(): DashboardSettings | null {
  try {
    if (existsSync(getSettingsFile())) {
      return JSON.parse(readFileSync(getSettingsFile(), "utf-8")) as DashboardSettings;
    }
    // Migration: adopt a legacy mode.json under the new name, best-effort.
    if (existsSync(getLegacyModeFile())) {
      const legacy = JSON.parse(readFileSync(getLegacyModeFile(), "utf-8")) as DashboardSettings;
      try {
        writeRawSettings(legacy);
        rmSync(getLegacyModeFile(), { force: true });
      } catch { /* migration best-effort; keep serving the parsed value */ }
      return legacy;
    }
  } catch { /* corrupt file */ }
  return null;
}

/** Write the raw settings object to `dashboard-settings.json`. */
function writeRawSettings(settings: DashboardSettings): void {
  mkdirSync(getManagedDir(), { recursive: true });
  writeFileSync(getSettingsFile(), JSON.stringify(settings, null, 2) + "\n");
}

export interface RecommendedWizardState {
  /** Recommended-extension ids the user explicitly skipped during the wizard. */
  skippedRecommended: string[];
  completedAt?: string;
}

/** Check if the dashboard settings file has been written yet. */
export function isFirstRun(): boolean {
  return !existsSync(getSettingsFile()) && !existsSync(getLegacyModeFile());
}

/** Read the persisted mode, or null if not set/invalid. Preserves recentRemotes. */
export function readModeFile(): DashboardSettings | null {
  const data = readRawSettings();
  if (!data) return null;
  if (data.mode === "standalone" || data.mode === "power-user") return data;
  if (data.mode === "remote" && typeof data.remoteUrl === "string" && data.remoteUrl) return data;
  return null;
}

/**
 * Persist the chosen mode to ~/.pi-dashboard/dashboard-settings.json.
 * `remoteUrl` is required when `mode === "remote"` and ignored otherwise.
 * The recent-servers list is preserved across mode writes.
 */
export function writeModeFile(mode: WizardMode, remoteUrl?: string): void {
  const existing = readRawSettings();
  const settings: DashboardSettings = { mode, completedAt: new Date().toISOString() };
  if (mode === "remote" && remoteUrl) settings.remoteUrl = remoteUrl;
  if (existing?.recentRemotes?.length) settings.recentRemotes = existing.recentRemotes;
  writeRawSettings(settings);
}

// ── Recent remote servers (MRU, cap 8) ─────────────────────────

/** List saved remote dashboards, most-recently-used first. */
export function listRecentRemotes(): RecentRemote[] {
  return readRawSettings()?.recentRemotes ?? [];
}

/**
 * Record a successful connect to `url`: move it to the front of the MRU list
 * and cap the list at 8. Preserves the current mode/remoteUrl.
 */
export function addRecentRemote(url: string): RecentRemote[] {
  const existing = readRawSettings() ?? { mode: "standalone" as WizardMode, completedAt: new Date().toISOString() };
  const rest = (existing.recentRemotes ?? []).filter((r) => r.url !== url);
  const recentRemotes = [{ url, lastUsed: new Date().toISOString() }, ...rest].slice(0, RECENT_REMOTES_CAP);
  writeRawSettings({ ...existing, recentRemotes });
  return recentRemotes;
}

/** Remove `url` from the recent-servers list. Preserves mode/remoteUrl. */
export function removeRecentRemote(url: string): RecentRemote[] {
  const existing = readRawSettings();
  if (!existing) return [];
  const recentRemotes = (existing.recentRemotes ?? []).filter((r) => r.url !== url);
  writeRawSettings({ ...existing, recentRemotes });
  return recentRemotes;
}

/**
 * Check if any provider credential is configured for pi.
 *
 * Delegates to the shared detector, which inspects BOTH
 * `~/.pi/agent/settings.json` (legacy API-key fields) and
 * `~/.pi/agent/auth.json` (OAuth subscriptions + provider-stored API
 * keys written by Settings → Providers). See change:
 * fix-doctor-oauth-credential-detection.
 */
export function isApiKeyConfigured(): boolean {
  return hasAnyProviderCredential();
}

/** Write an API key to pi's settings file. */
export function writeApiKey(provider: string, key: string): void {
  const settingsDir = path.dirname(getPiSettings());
  mkdirSync(settingsDir, { recursive: true });

  let data: any = {};
  try {
    if (existsSync(getPiSettings())) {
      data = JSON.parse(readFileSync(getPiSettings(), "utf-8"));
    }
  } catch { /* start fresh */ }

  // Write based on provider name
  if (provider === "anthropic") {
    data.anthropicApiKey = key;
  } else if (provider === "openai") {
    data.openaiApiKey = key;
  } else {
    // Generic: store in providers map
    if (!data.providers) data.providers = {};
    if (!data.providers[provider]) data.providers[provider] = {};
    data.providers[provider].apiKey = key;
  }

  writeFileSync(getPiSettings(), JSON.stringify(data, null, 2) + "\n");
}

// ── Recommended extensions wizard state ─────────────────────────

/** Read persisted recommended-extensions wizard state, or defaults. */
export function readRecommendedWizardState(): RecommendedWizardState {
  try {
    if (!existsSync(getRecommendedStateFile())) return { skippedRecommended: [] };
    const data = JSON.parse(readFileSync(getRecommendedStateFile(), "utf-8"));
    const skipped = Array.isArray(data?.skippedRecommended)
      ? (data.skippedRecommended as unknown[]).filter((s): s is string => typeof s === "string")
      : [];
    return { skippedRecommended: skipped, completedAt: data?.completedAt };
  } catch { /* corrupt file */ }
  return { skippedRecommended: [] };
}

/**
 * Persist the recommended-extensions wizard state.
 *
 * `skippedRecommended` is the list of manifest ids the user chose NOT to
 * install and which should suppress future wizard nagging. The list is
 * replaced on each write (not merged).
 */
export function writeRecommendedWizardState(state: RecommendedWizardState): void {
  mkdirSync(getManagedDir(), { recursive: true });
  const payload: RecommendedWizardState = {
    skippedRecommended: [...state.skippedRecommended],
    completedAt: state.completedAt ?? new Date().toISOString(),
  };
  writeFileSync(getRecommendedStateFile(), JSON.stringify(payload, null, 2) + "\n");
}

/** True when the wizard has already run its recommended-extensions step. */
export function isRecommendedWizardCompleted(): boolean {
  return existsSync(getRecommendedStateFile());
}
