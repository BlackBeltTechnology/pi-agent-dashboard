/**
 * Config REST API helpers: read, write, redact secrets, runtime reload.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type AuthConfig, type DashboardConfig, loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { setWindowsGitSourceSetting } from "@blackbelt-technology/pi-dashboard-shared/platform/git-source.js";
import { refreshModelRegistry } from "./model-proxy/registry-singleton.js";

const REDACTED = "***";

/**
 * Return the current config with secrets redacted.
 */
function getConfigPaths() {
  const dir = path.join(os.homedir(), ".pi", "dashboard");
  return { dir, file: path.join(dir, "config.json") };
}

export function readConfigRedacted(): DashboardConfig {
  const config = loadConfig();
  if (config.auth) {
    config.auth = redactAuthSecrets(config.auth);
  }
  // Redact per-provider tunnel secrets so GET /api/config never serves them in
  // clear (change: add-tunnel-providers — doubt-review gap). The write path
  // preserves a redacted value via writeConfigPartial's tunnel deep-merge.
  config.tunnel = redactTunnelSecrets(config.tunnel);
  return config;
}

function redactTunnelSecrets(tunnel: DashboardConfig["tunnel"]): DashboardConfig["tunnel"] {
  const t = { ...tunnel };
  if (t.reservedToken) t.reservedToken = REDACTED;
  if (t.zrok?.reservedToken) t.zrok = { ...t.zrok, reservedToken: REDACTED };
  if (t.ngrok?.authtoken) t.ngrok = { ...t.ngrok, authtoken: REDACTED };
  if (t.tailscale?.authKey) t.tailscale = { ...t.tailscale, authKey: REDACTED };
  return t;
}

function redactAuthSecrets(auth: AuthConfig): AuthConfig {
  const redacted: AuthConfig = {
    ...auth,
    secret: auth.secret ? REDACTED : "",
    providers: {},
  };
  for (const [key, provider] of Object.entries(auth.providers)) {
    redacted.providers[key] = {
      ...provider,
      clientSecret: REDACTED,
    };
  }
  return redacted;
}

/**
 * Fields that require a server restart to take effect.
 */
const RESTART_FIELDS = new Set(["port", "piPort", "bindHost"]);

export interface WriteConfigResult {
  success: boolean;
  restartRequired: boolean;
  error?: string;
}

/**
 * Merge partial config into existing, preserving redacted secrets, write to disk.
 * Returns whether a restart is needed.
 */
export function writeConfigPartial(partial: Record<string, any>): WriteConfigResult {
  const { dir, file } = getConfigPaths();
  try {
    // Read raw file to preserve unknown fields
    let existing: Record<string, any> = {};
    try {
      const raw = fs.readFileSync(file, "utf-8");
      existing = JSON.parse(raw);
    } catch { /* start fresh */ }

    // Check if restart-requiring fields changed
    let restartRequired = false;
    for (const field of RESTART_FIELDS) {
      if (field in partial && partial[field] !== existing[field]) {
        restartRequired = true;
      }
    }

    // Deep merge auth section, preserving redacted secrets
    if (partial.auth) {
      const existingAuth = existing.auth || {};
      const mergedAuth: any = { ...existingAuth };

      // Preserve secret if redacted
      if (partial.auth.secret === REDACTED || !partial.auth.secret) {
        mergedAuth.secret = existingAuth.secret;
      } else {
        mergedAuth.secret = partial.auth.secret;
      }

      // Merge providers, preserving redacted clientSecrets
      if (partial.auth.providers) {
        mergedAuth.providers = { ...existingAuth.providers };
        for (const [key, provider] of Object.entries(partial.auth.providers) as [string, any][]) {
          const existingProvider = existingAuth.providers?.[key] || {};
          mergedAuth.providers[key] = { ...existingProvider, ...provider };
          if (provider.clientSecret === REDACTED) {
            mergedAuth.providers[key].clientSecret = existingProvider.clientSecret || "";
          }
        }
      }

      if (partial.auth.allowedUsers !== undefined) {
        mergedAuth.allowedUsers = partial.auth.allowedUsers;
      }

      // fix-trusted-networks-no-oauth: propagate bypassHosts / bypassUrls
      // from the incoming partial. Without these, the UI's Trusted Networks
      // save path silently dropped every entry on disk. `!== undefined`
      // (not truthiness) lets an empty array clear all entries.
      if (partial.auth.bypassHosts !== undefined) {
        mergedAuth.bypassHosts = partial.auth.bypassHosts;
      }
      if (partial.auth.bypassUrls !== undefined) {
        mergedAuth.bypassUrls = partial.auth.bypassUrls;
      }

      partial.auth = mergedAuth;
    }

    // Merge tunnel sub-object (deep-merge nested watchdog + per-provider
    // sub-objects; preserve redacted secrets so a PUT echoing "***" does not
    // clobber the real value — change: add-tunnel-providers).
    if (partial.tunnel) {
      const existingTunnel: any = existing.tunnel ?? {};
      const mergedWatchdog = partial.tunnel.watchdog
        ? { ...(existingTunnel.watchdog ?? {}), ...partial.tunnel.watchdog }
        : existingTunnel.watchdog;
      const keepSecret = (incoming: any, prior: any, field: string) => {
        if (!incoming) return prior ? { ...prior } : incoming;
        const out = { ...(prior ?? {}), ...incoming };
        if (incoming[field] === REDACTED) out[field] = prior?.[field] ?? "";
        return out;
      };
      partial.tunnel = {
        ...existingTunnel,
        ...partial.tunnel,
        ...(mergedWatchdog ? { watchdog: mergedWatchdog } : {}),
        ...(partial.tunnel.reservedToken === REDACTED
          ? { reservedToken: existingTunnel.reservedToken }
          : {}),
        ...(partial.tunnel.zrok !== undefined
          ? { zrok: keepSecret(partial.tunnel.zrok, existingTunnel.zrok, "reservedToken") }
          : {}),
        ...(partial.tunnel.ngrok !== undefined
          ? { ngrok: keepSecret(partial.tunnel.ngrok, existingTunnel.ngrok, "authtoken") }
          : {}),
        ...(partial.tunnel.tailscale !== undefined
          ? { tailscale: keepSecret(partial.tunnel.tailscale, existingTunnel.tailscale, "authKey") }
          : {}),
      };
    }

    // Merge memoryLimits sub-object
    if (partial.memoryLimits) {
      partial.memoryLimits = { ...existing.memoryLimits, ...partial.memoryLimits };
      restartRequired = true;
    }

    // Merge openspec sub-object (no restart required — live-reconfigured)
    if (partial.openspec) {
      partial.openspec = { ...existing.openspec, ...partial.openspec };
    }

    const merged = { ...existing, ...partial };

    // Remove computed fields that shouldn't be persisted
    delete merged.resolvedTrustedNetworks;

    // Write
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(merged, null, 2) + "\n");

    // Eager-refresh model proxy registry (config may affect proxy settings).
    refreshModelRegistry().catch(() => {});

    // windowsGitSource change takes effect for newly spawned children
    // (existing children keep their PATH). Update the cached setting +
    // invalidate; no server restart required. See change:
    // embed-git-bash-on-windows.
    if (partial.windowsGitSource === "auto" || partial.windowsGitSource === "host" || partial.windowsGitSource === "bundled") {
      setWindowsGitSourceSetting(partial.windowsGitSource);
    }

    return { success: true, restartRequired };
  } catch (err: any) {
    return { success: false, restartRequired: false, error: err.message };
  }
}
