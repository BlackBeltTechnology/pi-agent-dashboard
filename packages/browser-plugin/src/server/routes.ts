/**
 * REST surface for the browser plugin (change: add-browser-relay, task 2.9;
 * spec `browser-plugin-settings`).
 *
 * Six routes on the host Fastify instance:
 *
 *   GET  /api/browser/status      → { enabled, canOpenChrome }
 *   GET  /api/browser/profiles    → rows keyed by profileDirectory (+ instances/tabs)
 *   POST /api/browser/connect     → { cdpUrl, instanceId } | 403/409/503/504
 *   POST /api/browser/disconnect  → ?instanceId= (required) | 400/404
 *   GET  /api/browser/audit       → newest-first entries (optional ?profile=)
 *   PUT  /api/browser/enabled     → kill switch ({ enabled: boolean })
 *
 * WRITES (connect/disconnect) are refused 403 while the relay is disabled; the
 * PUT is the way back on. Reads always answer so the settings surface can render
 * the disabled state.
 *
 * TOKEN SAFETY: the plugin's own `getPluginConfig()` is UNREDACTED (that is how
 * it pairs), so this module never spreads it into a response — the profile row
 * carries only `hasToken: boolean`. That is the one place a token could leak.
 */

import type { BrowserRelayTabState } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { FastifyInstance } from "fastify";
import type { AuditEntry, AuditRing } from "./audit.js";
import type { ProfileListResult, ProfileSource } from "./profiles.js";
import type { BrowserProfileConfig, ConnectResult, RelayConfig, RelayLike } from "./relay/relay-manager.js";

interface BrowserRouteTab {
  tabId: number;
  title: string;
  url: string;
  state: BrowserRelayTabState;
  reason?: "devtools";
}

interface BrowserRouteInstance {
  instanceId: string;
  state: "connected" | "no-cdp-client";
  tabs: BrowserRouteTab[];
}

interface BrowserRouteProfile {
  profileDirectory: string;
  label: string;
  email?: string;
  installed: boolean;
  /** True when a pairing token is configured. The token itself never leaves. */
  hasToken: boolean;
  instances: BrowserRouteInstance[];
}

interface BrowserProfilesResponse {
  profiles: Record<string, BrowserRouteProfile>;
  /** Set only on the synthetic-`Default` fallback; names the offending path. */
  warning?: string;
}

interface BrowserStatusResponse {
  enabled: boolean;
  canOpenChrome: boolean;
}

interface BrowserAuditResponse {
  entries: AuditEntry[];
}

/** The manager surface the routes need (narrow for tests; `RelayManager` fits). */
export interface BrowserRoutesManager {
  readonly enabled: boolean;
  connect(profileDirectory: string): Promise<ConnectResult>;
  disconnect(instanceId: string): boolean;
  setEnabled(enabled: boolean): Promise<void>;
  instances(profileDirectory?: string): RelayLike[];
  profileConfig(profileDirectory: string): BrowserProfileConfig;
}

interface BrowserRoutesLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface BrowserRoutesDeps {
  manager: BrowserRoutesManager;
  audit: AuditRing;
  /** The plugin's UNREDACTED config — used only for the server-side profile merge. */
  getConfig(): RelayConfig;
  canOpenChrome(): boolean;
  listProfiles(): Promise<ProfileListResult>;
  /** Persist a partial plugin config (`plugins.browser.*`). */
  updateConfig(partial: Partial<RelayConfig>): Promise<void>;
  logger: BrowserRoutesLogger;
}

/** Project a live instance into its wire row (no guid/token ever). */
function instanceRow(inst: RelayLike): BrowserRouteInstance {
  return {
    instanceId: inst.instanceId,
    state: inst.statusState(),
    tabs: inst.tabList().map((tab) => ({
      tabId: tab.tabId,
      title: tab.title,
      url: tab.url,
      state: tab.state,
      ...(tab.reason ? { reason: tab.reason } : {}),
    })),
  };
}

/** One profile row: metadata + `hasToken` (never the token) + its live instances. */
function profileRow(
  profile: ProfileSource,
  instances: RelayLike[],
  hasToken: boolean,
): BrowserRouteProfile {
  return {
    profileDirectory: profile.profileDirectory,
    label: profile.label,
    ...(profile.email ? { email: profile.email } : {}),
    installed: profile.installed,
    hasToken,
    instances: instances.map(instanceRow),
  };
}

/** One profile row: discovered metadata, or a synthetic row for a live instance. */
function rowFor(
  profile: ProfileSource | undefined,
  dir: string,
  instances: RelayLike[],
  hasToken: boolean,
): BrowserRouteProfile {
  if (profile) return profileRow(profile, instances, hasToken);
  return {
    profileDirectory: dir,
    label: dir,
    installed: true,
    hasToken,
    instances: instances.map(instanceRow),
  };
}

/** 
 * Apply a per-profile patch to the UNREDACTED config. Pure; returns the merged
 * `browsers` map or a validation error. Kept separate from the route so a
 * shallow `plugin_config_write` can never be mistaken for it.
 */
type ProfilePatch = { token?: unknown; zeroDialog?: unknown; allowedDomains?: unknown };
type ProfilePatchResult =
  | { ok: true; browsers: Record<string, BrowserProfileConfig>; hasToken: boolean }
  | { ok: false; error: string };

function applyProfilePatch(current: RelayConfig, dir: string, patch: ProfilePatch): ProfilePatchResult {
  if (patch.token !== undefined && typeof patch.token !== "string") {
    return { ok: false, error: "token must be a string" };
  }
  if (patch.zeroDialog !== undefined && typeof patch.zeroDialog !== "boolean") {
    return { ok: false, error: "zeroDialog must be a boolean" };
  }
  if (patch.allowedDomains !== undefined && !Array.isArray(patch.allowedDomains)) {
    return { ok: false, error: "allowedDomains must be an array" };
  }
  const browsers = { ...(current.browsers ?? {}) };
  const entry: BrowserProfileConfig = { ...(browsers[dir] ?? {}) };
  if (patch.token !== undefined) {
    // Empty string clears the token (the UI has no other way to remove one).
    if (patch.token === "") delete entry.token;
    else entry.token = patch.token;
  }
  if (patch.zeroDialog !== undefined) entry.zeroDialog = patch.zeroDialog;
  if (patch.allowedDomains !== undefined) {
    entry.allowedDomains = (patch.allowedDomains as unknown[]).filter(
      (d): d is string => typeof d === "string",
    );
  }
  browsers[dir] = entry;
  return { ok: true, browsers, hasToken: typeof entry.token === "string" && entry.token.length > 0 };
}

export function registerBrowserRoutes(fastify: FastifyInstance, deps: BrowserRoutesDeps): void {
  const { manager, audit, logger } = deps;

  fastify.get("/api/browser/status", async (): Promise<BrowserStatusResponse> => ({
    enabled: manager.enabled,
    canOpenChrome: deps.canOpenChrome(),
  }));

  fastify.get<{ Querystring: { profileDirectory?: string } }>(
    "/api/browser/profiles",
    async (req): Promise<BrowserProfilesResponse> => {
      const { profiles, warning } = await deps.listProfiles();
      const only = req.query.profileDirectory;
      const discovered = new Map(profiles.map((p) => [p.profileDirectory, p]));
      // Union discovered profiles with every live instance's profile: a live
      // instance ALWAYS renders (the `PI_BROWSER_RELAY_FAKE=1` harness profile
      // is not discoverable on disk, and a profile could vanish from Local
      // State mid-session).
      const dirs = [...discovered.keys()];
      for (const inst of manager.instances()) {
        if (!discovered.has(inst.profileDirectory)) dirs.push(inst.profileDirectory);
      }
      const rows: Record<string, BrowserRouteProfile> = {};
      for (const dir of dirs) {
        if (only !== undefined && dir !== only) continue;
        rows[dir] = rowFor(
          discovered.get(dir),
          dir,
          manager.instances(dir),
          Boolean(manager.profileConfig(dir).token),
        );
      }
      return warning ? { profiles: rows, warning } : { profiles: rows };
    },
  );

  fastify.post<{ Body: { profileDirectory?: unknown } }>(
    "/api/browser/connect",
    async (req, reply) => {
      if (!manager.enabled) {
        reply.code(403);
        return { error: "disabled" };
      }
      const profileDirectory = req.body?.profileDirectory;
      if (typeof profileDirectory !== "string" || profileDirectory.length === 0) {
        reply.code(400);
        return { error: "profileDirectory is required" };
      }
      const result = await manager.connect(profileDirectory);
      if (!result.ok) {
        reply.code(result.status);
        logger.warn(
          `[browser-relay] connect refused profile=${profileDirectory} status=${result.status} reason=${result.reason ?? result.message ?? ""}`,
        );
        return result;
      }
      return result;
    },
  );

  fastify.post<{ Querystring: { instanceId?: string } }>(
    "/api/browser/disconnect",
    async (req, reply) => {
      if (!manager.enabled) {
        reply.code(403);
        return { error: "disabled" };
      }
      const instanceId = req.query.instanceId;
      if (typeof instanceId !== "string" || instanceId.length === 0) {
        reply.code(400);
        return { error: "instanceId is required" };
      }
      if (!manager.disconnect(instanceId)) {
        reply.code(404);
        return { error: "unknown instance" };
      }
      return { success: true };
    },
  );

  fastify.get<{ Querystring: { profile?: string } }>(
    "/api/browser/audit",
    async (req): Promise<BrowserAuditResponse> => ({ entries: audit.list(req.query.profile) }),
  );

  fastify.put<{ Body: { enabled?: unknown } }>("/api/browser/enabled", async (req, reply) => {
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      reply.code(400);
      return { error: "enabled must be a boolean" };
    }
    // Persist FIRST, then act: control routes/clients read `enabled` from config,
    // so it must already be true before `setEnabled(true)` no-ops.
    await deps.updateConfig({ enabled });
    // Kill switch: resolves only after every instance has closed.
    await manager.setEnabled(enabled);
    logger.info(`[browser-relay] enabled=${enabled}`);
    return { enabled };
  });

  // Per-profile config write, merged SERVER-SIDE. A generic
  // `plugin_config_write` of the client-visible (`writeOnly`-redacted) `browsers`
  // map would replace the whole map on the server's shallow merge and silently
  // drop every OTHER profile's pairing token. Here the merge happens against the
  // UNREDACTED config, so untouched tokens survive and a token never has to
  // round-trip through the client.
  fastify.put<{
    Body: { profileDirectory?: unknown; token?: unknown; zeroDialog?: unknown; allowedDomains?: unknown };
  }>("/api/browser/profile", async (req, reply) => {
    const body = req.body ?? {};
    const profileDirectory = body.profileDirectory;
    if (typeof profileDirectory !== "string" || profileDirectory.length === 0) {
      reply.code(400);
      return { error: "profileDirectory is required" };
    }
    const result = applyProfilePatch(deps.getConfig(), profileDirectory, body);
    if (!result.ok) {
      reply.code(400);
      return { error: result.error };
    }
    await deps.updateConfig({ browsers: result.browsers });
    logger.info(`[browser-relay] profile config updated profile=${profileDirectory}`);
    return { profileDirectory, hasToken: result.hasToken };
  });
}
