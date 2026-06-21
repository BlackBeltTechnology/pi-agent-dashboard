/**
 * Wizard state persistence: mode.json and API key detection.
 *
 * TODO(simplify-electron-bootstrap-derived-state Phase C): This file is still
 * imported by the LAUNCH_SOURCE_V2=false legacy path (main.ts, wizard-ipc.ts,
 * server-lifecycle.ts, doctor.ts). Delete after the legacy path is removed
 * in a follow-up change once Phase C ships without regressions.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { hasAnyProviderCredential } from "@blackbelt-technology/pi-dashboard-shared/credential-detect.js";

function getManagedDir() { return path.join(os.homedir(), ".pi-dashboard"); }
function getModeFile() { return path.join(getManagedDir(), "mode.json"); }
function getPiSettings() { return path.join(os.homedir(), ".pi", "agent", "settings.json"); }
function getRecommendedStateFile() { return path.join(getManagedDir(), "recommended.json"); }

export type WizardMode = "standalone" | "power-user" | "remote";

export interface ModeConfig {
  mode: WizardMode;
  completedAt: string;
  /**
   * Set only when `mode === "remote"`: the dashboard server URL the Electron
   * shell attaches to directly (e.g. a Docker-hosted server). See change:
   * docker-packaging.
   */
  remoteUrl?: string;
}

export interface RecommendedWizardState {
  /** Recommended-extension ids the user explicitly skipped during the wizard. */
  skippedRecommended: string[];
  completedAt?: string;
}

/** Check if the first-run wizard has been completed. */
export function isFirstRun(): boolean {
  return !existsSync(getModeFile());
}

/** Read the persisted mode, or null if not set. */
export function readModeFile(): ModeConfig | null {
  try {
    if (!existsSync(getModeFile())) return null;
    const data = JSON.parse(readFileSync(getModeFile(), "utf-8"));
    if (data?.mode === "standalone" || data?.mode === "power-user") {
      return data as ModeConfig;
    }
    if (data?.mode === "remote" && typeof data?.remoteUrl === "string" && data.remoteUrl) {
      return data as ModeConfig;
    }
  } catch { /* corrupt file */ }
  return null;
}

/**
 * Persist the chosen mode to ~/.pi-dashboard/mode.json.
 * `remoteUrl` is required when `mode === "remote"` and ignored otherwise.
 */
export function writeModeFile(mode: WizardMode, remoteUrl?: string): void {
  mkdirSync(getManagedDir(), { recursive: true });
  const config: ModeConfig = { mode, completedAt: new Date().toISOString() };
  if (mode === "remote" && remoteUrl) config.remoteUrl = remoteUrl;
  writeFileSync(getModeFile(), JSON.stringify(config, null, 2) + "\n");
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
