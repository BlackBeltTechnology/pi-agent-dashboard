/**
 * REST surface for the browser plugin (change: add-browser-relay, task 2.9;
 * spec `browser-plugin-settings`).
 *
 * Seven routes (+ the per-profile PUT) on the host Fastify instance:
 *
 *   GET  /api/browser/status      → { enabled, canOpenChrome, operatorHosts: true, dedicated?, settings }
 *   GET  /api/browser/profiles    → rows keyed by profileDirectory (+ instances/tabs) + operatorHosts[]
 *   POST /api/browser/connect     → { profileDirectory, host? } → { cdpUrl, instanceId } | 403/404/409/503/504
 *   DELETE /api/browser/operator-hosts/:hostId → reset an operator host's key pin
 *   POST /api/browser/disconnect  → ?instanceId= (required) | 400/404
 *   GET  /api/browser/audit       → newest-first entries (optional ?profile=)
 *   PUT  /api/browser/enabled     → kill switch ({ enabled: boolean })
 *   PUT  /api/browser/settings    → partial "Agent browsing" settings (400 on any invalid field)
 *   POST /api/browser/dedicated/connect {client?} | /open {url?} | /stop | /reset
 *        → the dashboard-owned Chrome (change: add-dedicated-agent-browser, D11)
 *
 * WRITES (connect/disconnect) are refused 403 while the relay is disabled; the
 * PUT is the way back on. Reads always answer so the settings surface can render
 * the disabled state.
 *
 * TOKEN SAFETY: the plugin's own `getPluginConfig()` is UNREDACTED (that is how
 * it pairs), so this module never spreads it into a response — the profile row
 * carries only `hasToken: boolean`. That is the one place a token could leak.
 */

import { HOST_ID_PATTERN } from "@blackbelt-technology/pi-dashboard-shared/browser-host-identity.js";
import type { BrowserRelayTabState } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuditEntry, AuditRing } from "./audit.js";
import type { OperatorHostInfo } from "./operator-hosts.js";
import type { ProfileListResult, ProfileSource } from "./profiles.js";
import { isRelayConnectPage, redactExtensionUrl } from "./redact.js";
import type {
  BrowserProfileConfig,
  ConnectResult,
  DedicatedConnectResult,
  DedicatedOpenResult,
  DedicatedResetResult,
  DedicatedStatusBody,
  RelayConfig,
  RelayLike,
} from "./relay/relay-manager.js";
import { effectiveSettings, validateSettingsPatch } from "./settings.js";

interface BrowserRouteTab {
  tabId: number;
  title: string;
  url: string;
  state: BrowserRelayTabState;
  reason?: "devtools" | "no-session";
  agentEmulation?: boolean;
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
  /** Password-manager extensions installed in the profile (display names; `[]` when none). */
  passwordManagers: string[];
  instances: BrowserRouteInstance[];
}

/**
 * One operator profile row: the four registered fields plus the instances S
 * knows. NO `hasToken`/`zeroDialog` — S cannot know the operator's local state.
 */
interface BrowserOperatorProfile {
  profileDirectory: string;
  label: string;
  email?: string;
  installed: boolean;
  instances: BrowserRouteInstance[];
}

interface BrowserOperatorHost extends Omit<OperatorHostInfo, "profiles"> {
  profiles: BrowserOperatorProfile[];
}

interface BrowserProfilesResponse {
  profiles: Record<string, BrowserRouteProfile>;
  /** Bound operator hosts (online only). Served by this authenticated REST route only. */
  operatorHosts: BrowserOperatorHost[];
  /** Set only on the synthetic-`Default` fallback; names the offending path. */
  warning?: string;
}

interface BrowserStatusResponse {
  enabled: boolean;
  canOpenChrome: boolean;
  /** Dedicated agent browser; omitted when the plugin has no dedicated wiring. */
  dedicated?: DedicatedStatusBody;
  /** Effective "Agent browsing" values (defaults filled in). */
  settings: ReturnType<typeof effectiveSettings>;
  /** This server supports operator browser hosts; clients send no `browser_host_*` without it. */
  operatorHosts: true;
}

interface BrowserAuditResponse {
  entries: AuditEntry[];
}

/** The manager surface the routes need (narrow for tests; `RelayManager` fits). */
export interface BrowserRoutesManager {
  readonly enabled: boolean;
  connect(profileDirectory: string, host?: string): Promise<ConnectResult>;
  disconnect(instanceId: string): boolean;
  setEnabled(enabled: boolean): Promise<void>;
  instances(profileDirectory?: string): RelayLike[];
  /** Instances on one host (`"dashboard"` or an operator `hostId`). */
  instancesOn(host: string, profileDirectory?: string): RelayLike[];
  hosts: { list(): OperatorHostInfo[]; deletePin(hostId: string): boolean };
  profileConfig(profileDirectory: string): BrowserProfileConfig;
  // Dedicated agent browser (change: add-dedicated-agent-browser, D11).
  connectDedicated(opts: { client?: string }): Promise<DedicatedConnectResult>;
  openDedicated(url: string): Promise<DedicatedOpenResult>;
  stopDedicated(): Promise<void>;
  resetDedicated(): Promise<DedicatedResetResult>;
  dedicatedStatus(): Promise<DedicatedStatusBody | undefined>;
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
    // Defense in depth: the instance already redacts, but this is the viewer
    // egress, so the connect page / token-bearing URLs are re-checked here.
    tabs: inst.tabList().filter((tab) => !isRelayConnectPage(tab.url)).map((tab) => ({
      tabId: tab.tabId,
      title: tab.title,
      url: redactExtensionUrl(tab.url),
      state: tab.state,
      ...(tab.reason ? { reason: tab.reason } : {}),
      ...(tab.agentEmulation ? { agentEmulation: true } : {}),
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
    passwordManagers: profile.passwordManagers ?? [],
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
    passwordManagers: [],
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

/** `host` is optional; when present it must be a short non-empty string. */
function isValidHost(host: unknown): host is string | undefined {
  return host === undefined || (typeof host === "string" && host.length > 0 && host.length <= 128);
}

/** Omitted or `"dashboard"` = the dashboard-host path. */
function isDashboardTarget(host: unknown): boolean {
  return host === undefined || host === "dashboard";
}

/**
 * A request that may outlast Fastify's 10 s `connectionTimeout` (operator
 * consent + extension handshake, or a cold Chrome start): disable the per-socket
 * timeout for it and restore it once the response flushes (same shape as
 * git-routes). A client abort destroys the socket, so nothing to restore.
 * See change: add-operator-browser-relay (design D4); pinned by fix-browser-relay-pane-input (D2).
 */
function disableSocketTimeout(req: FastifyRequest, reply: FastifyReply): void {
  const socket = req.raw.socket;
  const prevTimeout = typeof socket?.timeout === "number" ? socket.timeout : undefined;
  socket?.setTimeout?.(0);
  if (typeof prevTimeout === "number") {
    reply.raw.once("finish", () => {
      if (socket && !socket.destroyed) socket.setTimeout(prevTimeout);
    });
  }
}

/** Default sign-in page of `dedicated/open` when the body carries no `url`. */
export const DEFAULT_SIGN_IN_URL = "https://accounts.google.com/";
const MAX_CLIENT_LABEL = 64;

export function registerBrowserRoutes(fastify: FastifyInstance, deps: BrowserRoutesDeps): void {
  const { manager, audit, logger } = deps;

  fastify.get("/api/browser/status", async (): Promise<BrowserStatusResponse> => {
    const dedicated = await manager.dedicatedStatus();
    return {
      enabled: manager.enabled,
      canOpenChrome: deps.canOpenChrome(),
      operatorHosts: true,
      ...(dedicated ? { dedicated } : {}),
      settings: effectiveSettings(deps.getConfig()),
    };
  });

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
      // Dashboard-host rows only: an operator's profiles are listed under their host.
      // `@`-prefixed keys are built-in targets (`@dedicated`), never a Chrome profile row.
      for (const inst of manager.instancesOn("dashboard")) {
        if (inst.profileDirectory.startsWith("@")) continue;
        if (!discovered.has(inst.profileDirectory) && !dirs.includes(inst.profileDirectory)) dirs.push(inst.profileDirectory);
      }
      const rows: Record<string, BrowserRouteProfile> = {};
      for (const dir of dirs) {
        if (only !== undefined && dir !== only) continue;
        rows[dir] = rowFor(
          discovered.get(dir),
          dir,
          manager.instancesOn("dashboard", dir),
          Boolean(manager.profileConfig(dir).token),
        );
      }
      const operatorHosts: BrowserOperatorHost[] = manager.hosts.list().map((host) => ({
        ...host,
        profiles: host.profiles
          .filter((p) => only === undefined || p.profileDirectory === only)
          .map((p) => ({
            profileDirectory: p.profileDirectory,
            label: p.label,
            ...(p.email ? { email: p.email } : {}),
            installed: p.installed,
            instances: manager.instancesOn(host.hostId, p.profileDirectory).map(instanceRow),
          })),
      }));
      return warning ? { profiles: rows, operatorHosts, warning } : { profiles: rows, operatorHosts };
    },
  );

  fastify.post<{ Body: { profileDirectory?: unknown; host?: unknown } }>(
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
      // Optional operator host; omitted or "dashboard" = the dashboard-host path.
      const host = req.body?.host;
      if (!isValidHost(host)) {
        reply.code(400);
        return { error: "host must be a non-empty string" };
      }
      // Operator consent (≤ 60 s) plus the extension handshake (≤ 60 s) outlast
      // Fastify's 10 s connectionTimeout (see `disableSocketTimeout`).
      disableSocketTimeout(req, reply);
      const result = await manager.connect(profileDirectory, host);
      if (!result.ok) {
        reply.code(result.status);
        // Operator connects log their own `[browser-host] connect` line (no request-supplied text here).
        if (isDashboardTarget(host)) {
          logger.warn(
            `[browser-relay] connect refused profile=${profileDirectory} status=${result.status} reason=${result.reason ?? result.message ?? ""}`,
          );
        }
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

  // Reset an operator host's key pin (reinstalled operator). Same REST auth as
  // every /api/browser/* route; tier `operate` in shared route-tiers. Not gated on
  // the kill switch: it only forgets a public key.
  fastify.delete<{ Params: { hostId: string } }>("/api/browser/operator-hosts/:hostId", async (req, reply) => {
    const { hostId } = req.params;
    if (!HOST_ID_PATTERN.test(hostId)) {
      reply.code(400);
      return { error: "invalid hostId" };
    }
    return { removed: manager.hosts.deletePin(hostId) };
  });

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
    if (profileDirectory.startsWith("@")) {
      // `@` is reserved for built-in targets (`@dedicated`): never a per-profile config key.
      reply.code(400);
      return { error: "profileDirectory must not start with @" };
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

  // "Agent browsing" settings: PARTIAL body, validated as a whole, written through
  // the same server-side config path as `/enabled` and `/profile` (never
  // `plugin_config_write`, see above). Any invalid field → 400, nothing stored.
  fastify.put<{ Body: unknown }>("/api/browser/settings", async (req, reply) => {
    if (!manager.enabled) {
      reply.code(403);
      return { error: "disabled" };
    }
    const { profiles } = await deps.listProfiles();
    const installed = new Set(profiles.filter((p) => p.installed).map((p) => p.profileDirectory));
    const result = validateSettingsPatch(req.body ?? {}, installed);
    if (!result.ok) {
      reply.code(400);
      return { error: result.error };
    }
    if (Object.keys(result.patch).length > 0) await deps.updateConfig(result.patch);
    logger.info(`[browser-relay] settings updated keys=${Object.keys(result.patch).join(",")}`);
    return { settings: effectiveSettings({ ...deps.getConfig(), ...result.patch }) };
  });

  // ── Dedicated agent browser (change: add-dedicated-agent-browser, D11) ─────
  // Same universal guard as every /api/browser/* route; the returned `cdpUrl` is
  // only usable from loopback because /ws/browser-cdp stays loopback-only.

  const refuseBody = (reply: FastifyReply, result: { status: number; reason: string; message?: string; instanceId?: string; holder?: string }) => {
    reply.code(result.status);
    return {
      error: result.reason,
      reason: result.reason,
      ...(result.message ? { message: result.message } : {}),
      ...(result.instanceId ? { instanceId: result.instanceId } : {}),
      ...(result.holder ? { holder: result.holder } : {}),
    };
  };

  fastify.post<{ Body: { client?: unknown } | undefined }>("/api/browser/dedicated/connect", async (req, reply) => {
    if (!manager.enabled) {
      reply.code(403);
      return { error: "disabled", reason: "disabled" };
    }
    const client = req.body?.client;
    if (client !== undefined && (typeof client !== "string" || client.trim() === "" || client.length > MAX_CLIENT_LABEL)) {
      reply.code(400);
      return { error: `client must be a 1-${MAX_CLIENT_LABEL} character string` };
    }
    disableSocketTimeout(req, reply); // a cold Chrome start outlasts the 10 s connectionTimeout
    const result = await manager.connectDedicated(typeof client === "string" ? { client: client.trim() } : {});
    if (!result.ok) {
      logger.warn(`[browser-relay] dedicated connect refused status=${result.status} reason=${result.reason}`);
      return refuseBody(reply, result);
    }
    return { cdpUrl: result.cdpUrl, instanceId: result.instanceId };
  });

  fastify.post<{ Body: { url?: unknown } | undefined }>("/api/browser/dedicated/open", async (req, reply) => {
    if (!manager.enabled) {
      reply.code(403);
      return { error: "disabled", reason: "disabled" };
    }
    const url = req.body?.url ?? DEFAULT_SIGN_IN_URL;
    if (typeof url !== "string") {
      reply.code(400);
      return { error: "url must be a string", reason: "url-denied" };
    }
    disableSocketTimeout(req, reply);
    const result = await manager.openDedicated(url);
    if (!result.ok) return refuseBody(reply, result);
    return { opened: true };
  });

  fastify.post("/api/browser/dedicated/stop", async (_req, reply) => {
    if (!manager.enabled) {
      reply.code(403);
      return { error: "disabled", reason: "disabled" };
    }
    await manager.stopDedicated();
    return { stopped: true };
  });

  fastify.post("/api/browser/dedicated/reset", async (_req, reply) => {
    if (!manager.enabled) {
      reply.code(403);
      return { error: "disabled", reason: "disabled" };
    }
    const result = await manager.resetDedicated();
    if (!result.ok) return refuseBody(reply, result);
    return { reset: true };
  });
}
