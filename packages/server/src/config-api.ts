/**
 * Config REST API helpers: read, write, redact secrets, runtime reload.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { redactPluginConfigForClient } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import {
  type AuthConfig,
  type DashboardConfig,
  DEFAULT_SUBAGENT_TICK_THROTTLE_MS,
  loadConfig,
} from "@blackbelt-technology/pi-dashboard-shared/config.js";
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
  // Redact writeOnly plugin config fields (e.g. the browser plugin's
  // per-profile SSO pairing tokens) so GET /api/config never serves them in
  // clear. Plugins WITHOUT a writeOnly field keep their config verbatim
  // (same-reference no-op). The plugin write paths merge against the RAW
  // file, so stripping on read cannot clobber a stored value.
  // See change: add-browser-relay (GAP A, scenario F2).
  config.plugins = Object.fromEntries(
    Object.entries(config.plugins ?? {}).map(([id, cfg]) => [id, redactPluginConfigForClient(id, cfg)]),
  ) as DashboardConfig["plugins"];
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
  /**
   * Set by `serverHeap`: a FULL COLD START is required, and the in-place
   * `/api/restart` will NOT apply it (`restart-helper.ts` re-spawns with
   * `env: process.env`, so the replacement inherits the old ceiling).
   * Deliberately distinct from `restartRequired`, whose banner promises an
   * in-place restart suffices. See change: bound-session-heap-and-gc-telemetry.
   */
  coldStartRequired?: boolean;
  error?: string;
}

/** Outcome of a provider deletion attempt. */
export interface DeleteAuthProviderResult {
  success: boolean;
  /** True when a key was actually removed (false = idempotent no-op). */
  deleted: boolean;
  /** Providers left on disk after the call. */
  remaining: number;
  /** Set when `success` is false. */
  reason?: "last-provider" | "write-failed";
  error?: string;
}

/**
 * Delete ONE provider from `auth.providers`, raw read → delete → raw write.
 *
 * Deliberately not built on the two obvious primitives (D9):
 *   - `writeConfigPartial`'s providers merge is spread-then-overlay, so no
 *     input value can remove a key — routing a DELETE through it is a silent
 *     no-op;
 *   - `readConfigRedacted()` would persist `"***"` over every SURVIVING
 *     provider's real `clientSecret`, breaking the preservation contract the
 *     merge exists to honour.
 *
 * Idempotent: deleting an absent provider is a success with no write.
 *
 * Removing the LAST provider is refused unless `force` is set. At runtime that
 * state is auth *enforced with no login path* — the `onRequest` gate stays
 * installed and `/auth/login` renders an empty list — so it can hard-lock a
 * remote operator until restart.
 *
 * See change: config-override-oauth-redirect-base.
 */
export function deleteAuthProvider(
  id: string,
  opts: { force?: boolean } = {},
): DeleteAuthProviderResult {
  const { dir, file } = getConfigPaths();
  try {
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch { /* treat an unreadable/absent file as "no providers" */ }

    const auth = (existing.auth ?? {}) as { providers?: Record<string, unknown> };
    const providers: Record<string, unknown> = auth.providers ?? {};
    if (!Object.hasOwn(providers, id)) {
      return { success: true, deleted: false, remaining: Object.keys(providers).length };
    }
    if (Object.keys(providers).length === 1 && !opts.force) {
      return { success: false, deleted: false, remaining: 1, reason: "last-provider" };
    }

    delete providers[id];
    const merged: Record<string, unknown> = { ...existing, auth: { ...auth, providers } };
    delete merged.resolvedTrustedNetworks;
    delete merged.reachability;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
    return { success: true, deleted: true, remaining: Object.keys(providers).length };
  } catch (err) {
    return {
      success: false,
      deleted: false,
      remaining: 0,
      reason: "write-failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
    let coldStartRequired = false;
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

      if (partial.auth.redirectBaseUrl !== undefined) {
        mergedAuth.redirectBaseUrl = partial.auth.redirectBaseUrl;
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

    // Heap sub-objects deep-merge like memoryLimits, so saving `maxOldSpaceMb`
    // alone does not drop a sibling `initialOldSpaceMb`.
    // `sessionHeap` needs NO restart indicator at all: it applies on the next
    // session spawn. `serverHeap` needs a COLD start, which the generic
    // restart banner would misdescribe.
    // See change: bound-session-heap-and-gc-telemetry (D7, task 2.2).
    if (partial.sessionHeap) {
      partial.sessionHeap = { ...existing.sessionHeap, ...partial.sessionHeap };
    }
    if (partial.serverHeap) {
      // Compare VALUES, not presence: a PUT echoing the current ceiling has
      // changed nothing and must not claim a cold start is owed (the same rule
      // `RESTART_FIELDS` above follows).
      const changed =
        partial.serverHeap.maxOldSpaceMb !== undefined &&
        partial.serverHeap.maxOldSpaceMb !== existing.serverHeap?.maxOldSpaceMb;
      partial.serverHeap = { ...existing.serverHeap, ...partial.serverHeap };
      if (changed) coldStartRequired = true;
    }

    // Merge openspec sub-object (no restart required — live-reconfigured)
    if (partial.openspec) {
      partial.openspec = { ...existing.openspec, ...partial.openspec };
    }

    // Merge kroki sub-object
    if (partial.kroki) {
      partial.kroki = { ...existing.kroki, ...partial.kroki };
    }

    const merged = { ...existing, ...partial };

    // Remove computed fields that shouldn't be persisted. `reachability` is
    // derived per-request from the bind host + trusted entries; echoing it back
    // in a PUT body must not create a phantom config key.
    // See change: warn-unreachable-trusted-networks.
    delete merged.resolvedTrustedNetworks;
    delete merged.reachability;

    // Write
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);

    // Eager-refresh model proxy registry (config may affect proxy settings).
    refreshModelRegistry().catch(() => {});

    // windowsGitSource change takes effect for newly spawned children
    // (existing children keep their PATH). Update the cached setting +
    // invalidate; no server restart required. See change:
    // embed-git-bash-on-windows.
    if (partial.windowsGitSource === "auto" || partial.windowsGitSource === "host" || partial.windowsGitSource === "bundled") {
      setWindowsGitSourceSetting(partial.windowsGitSource);
    }

    return { success: true, restartRequired, ...(coldStartRequired ? { coldStartRequired } : {}) };
  } catch (err: any) {
    return { success: false, restartRequired: false, error: err.message };
  }
}

/**
 * One-shot boot migration: a stored `subagentTickThrottleMs: 0` that predates
 * the default flip is rewritten to the current default and marked.
 *
 * `ensureConfig()` materializes the default into every install's config.json,
 * so flipping the default alone reaches nobody. The MARKER, not the value,
 * decides: a `0` written after the marker exists is a deliberate opt-out and is
 * kept. Boot path only (`cli.ts`, beside `ensureConfig()`) — never `loadConfig`,
 * which every bridge process calls and which must never write.
 * See change: heal-orphaned-tool-cards-on-session-end (design D5).
 */
export function migrateSubagentTickThrottle(): void {
  const { file } = getConfigPaths();
  let existing: Record<string, any>;
  try {
    existing = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return; // no config yet — `ensureConfig()` seeds the marker itself
  }
  // A file that parses to a non-object (array, string) is not a config; writing
  // through it would persist junk keys via the merge writer's spread.
  if (typeof existing !== "object" || existing === null || Array.isArray(existing)) return;
  if (existing.subagentTickThrottleMigrated !== undefined) return;
  if (existing.subagentTickThrottleMs !== 0) {
    // Nothing to rewrite, but STAMP the marker: a config that never carried the
    // key (hand-pruned, or seeded by something other than `ensureConfig`) would
    // otherwise stay markerless, and a deliberate `0` set later through the
    // settings UI would be migrated away on the next boot.
    writeConfigPartial({ subagentTickThrottleMigrated: true });
    return;
  }
  writeConfigPartial({
    subagentTickThrottleMs: DEFAULT_SUBAGENT_TICK_THROTTLE_MS,
    subagentTickThrottleMigrated: true,
  });
}
