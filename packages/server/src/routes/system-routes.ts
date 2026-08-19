/**
 * System REST API routes: config, health, shutdown, tunnel.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverPlugins,
  getPluginStatusStore,
  pluginRegistryHash,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { BridgeLoadSource, PluginStatus } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/plugin-status.js";
import { parseLaunchSource } from "@blackbelt-technology/pi-dashboard-shared/dashboard-starter.js";
import { whichSync } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import { getGitSourceReadout } from "@blackbelt-technology/pi-dashboard-shared/platform/git-source.js";
import { classifyBridgeSource } from "@blackbelt-technology/pi-dashboard-shared/plugin-bridge-register.js";
import { RESTART_QUIESCE_MS } from "@blackbelt-technology/pi-dashboard-shared/recovery-timing.js";
import type { NetworkInterface } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import {
  computeBindReachability,
  getLastBindReachability,
  safeComputeBindReachability,
  sameReachability,
} from "../auth/bind-reachability-service.js";
import { localhostGuard } from "../auth/localhost-guard.js";
import { deleteAuthProvider, readConfigRedacted, writeConfigPartial } from "../config-api.js";
import type { DirectoryService } from "../directory-service.js";
import { bootParentPid, computeBootParentAlive, readLivePpid } from "../lifecycle/boot-parent-liveness.js";
import { computeEffectiveLaunchSource } from "../lifecycle/launch-source-effective.js";
import type { EventLoopSpikeMetrics } from "../metrics/eventloop-spike-metrics.js";
import type { HydrationMetrics } from "../metrics/hydration-metrics.js";
import { getModelProxyStatus } from "../model-proxy/registry-singleton.js";
import { recordExitIntent } from "../persistence/boot-state.js";
import { EMPTY_TRIM_STATS, type TrimStats } from "../persistence/memory-event-store.js";
import type { MetaPersistence } from "../persistence/meta-persistence.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import {
  consumerDivergenceMessage,
  piRuntimeSnapshot,
} from "../pi/pi-runtime.js";
import {
  type BootstrapCompatibility,
  computeCompatibility,
  readCurrentPiVersion,
  readPiCompatibility,
} from "../pi/pi-version-skew.js";
import type { ServerConfig } from "../server.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import { spawnRestart } from "../spawn-process/restart-helper.js";
import { readSpawnFailures } from "../spawn-process/spawn-failure-log.js";
import { systemOpenCapability } from "../system-open-capability.js";
import { createTunnel, deleteTunnel, ensureReservedName, getTunnelStatus, getTunnelUrl, releaseShare } from "../tunnel/tunnel.js";
import { blockEvents } from "../tunnel/tunnel-block-events.js";
import { collectEndpoints } from "../tunnel/tunnel-endpoints.js";
import { runEnrollStep } from "../tunnel/tunnel-enroll.js";
import { startTunnelWatchdog, stopTunnelWatchdog } from "../tunnel/tunnel-watchdog.js";
import { buildNetworkInterfaceList } from "./network-interfaces.js";
import type { NetworkGuard } from "./route-deps.js";

/**
 * `/api/health` → `piRuntime`.
 *
 * SECURITY: `/api/health` has NO `preHandler` guard — it is reachable
 * unauthenticated. This shape therefore carries VERSIONS ONLY and never a
 * filesystem path; the paths live on the guarded `GET /api/pi/installs`.
 * Adding a path field here would disclose the operator's install layout to any
 * caller that can reach the port.
 *
 * See change: select-pi-runtime-install (design D5).
 */
export interface PiDivergenceHealth {
  /** The two pi CONSUMERS resolve to different installs. */
  consumerDiverged: boolean;
  /** Message naming BOTH versions; null when not diverged. */
  consumerMessage: string | null;
  spawnVersion: string | null;
  moduleVersion: string | null;
  /** >1 distinct pi version across every enumerated install — a DIFFERENT question. */
  installSetDiverged: boolean;
  installSetVersions: string[];
}
/**
 * Enrich each plugin status with `bridgeLoadedFrom` by classifying the
 * plugin's resolved bridge path against the live pi settings.json.
 *
 * Reads settings.json once per health call; cached `discoverPlugins()`
 * result keeps the bridge path lookup O(1).
 *
 * See change: fix-pi-flows-end-to-end (Group 2, task 2.4).
 */
function enrichWithBridgeSource(statuses: PluginStatus[]): PluginStatus[] {
  let settings: unknown = null;
  try {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();
    const p = path.join(home, ".pi", "agent", "settings.json");
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, "utf-8").trim();
      if (raw) settings = JSON.parse(raw);
    }
  } catch {
    settings = null;
  }

  const plugins = discoverPlugins();
  const bridgePaths = new Map<string, string>();
  for (const p of plugins) {
    if (p.bridgeEntryPath) bridgePaths.set(p.manifest.id, p.bridgeEntryPath);
  }

  return statuses.map((s) => {
    const bp = bridgePaths.get(s.id);
    const bridgeLoadedFrom: BridgeLoadSource = bp
      ? classifyBridgeSource(settings, bp)
      : "none";
    return { ...s, bridgeLoadedFrom };
  });
}

export function registerSystemRoutes(
  fastify: FastifyInstance,
  deps: {
    sessionManager: SessionManager;
    preferencesStore: PreferencesStore;
    metaPersistence: MetaPersistence;
    config: ServerConfig;
    networkGuard: NetworkGuard;
    version?: string;
    directoryService?: DirectoryService;
    piGateway?: PiGateway;
    browserGateway?: {
      broadcastToAll: (msg: ServerToBrowserMessage) => void;
      // Per-hop dropped-frame counters for the diagnostics surface.
      // See change: fix-stuck-tool-card-on-dropped-event.
      getDroppedFrameStats?: () => { total: number; bySession: Record<string, number> };
      getNotifyLogStats?: () => { evictedEntries: number; bySession: Record<string, number> };
    };
    // Shared hydration-timing recorder; `/api/health` reads its snapshot.
    // See change: instrument-session-hydration-timing.
    hydrationMetrics?: HydrationMetrics;
    // Reads {meanMs,p99Ms,maxMs} from the boot event-loop-delay histogram and
    // resets its window. See change: instrument-session-hydration-timing.
    readEventLoopDelay?: () => { meanMs: number; p99Ms: number; maxMs: number };
    // Rolling ring buffer of worst-case event-loop stalls (sampler + per-turn
    // self-records); `/api/health` reads its snapshot additively.
    // See change: attribute-openspec-poll-eventloop-stalls.
    eventLoopSpikes?: EventLoopSpikeMetrics;
    // Store-shed telemetry source; `/api/health` reads getTrimStats() into the
    // additive `storeTrim` field. See change: instrument-event-store-trim.
    // DERIVED from the store's exported TrimStats, never restated inline: an
    // inline structural type still typechecks after the store gains a field
    // (excess-property checks do not fire on a function return type), so the
    // wire-shape annotation would silently rot.
    // See change: collapse-superseded-tool-execution-updates (D9).
    eventStore?: {
      getTrimStats?: () => TrimStats;
    };
    // Embed-session-lifecycle diagnostics; `/api/health` reads its snapshot
    // (active/idle ephemeral counts, reaped-by-reason, capacity rejections,
    // acquire reuse hit/miss). See change: add-embed-session-lifecycle.
    embedLifecycle?: { snapshot: () => unknown };
  },
) {
  const { sessionManager, preferencesStore, metaPersistence, config, networkGuard, version, directoryService, piGateway, browserGateway, hydrationMetrics, readEventLoopDelay, eventLoopSpikes, eventStore, embedLifecycle } = deps;

  // Quiesce windows for the bridge `server_restarting` broadcast. See change
  // `fix-restart-bridge-auto-start-race`. Bridges that receive this message
  // suppress only the spawn step in `server-auto-start.ts` for `quiesceMs`;
  // discovery + reconnection still run.
  const SHUTDOWN_QUIESCE_MS = 60000;
  const announceRestart = (
    reason: "restart" | "shutdown",
    quiesceMs: number,
    requestId?: string,
  ) => {
    // Bridges: suppress the auto-start spawn step during the quiesce window.
    try {
      piGateway?.broadcast({ type: "server_restarting", reason, quiesceMs });
    } catch { /* best-effort — never block exit on a flaky bridge socket */ }
    // Browsers: correlate a confirm:"ws" restart click via the echoed requestId.
    // See change: add-async-action-feedback.
    try {
      browserGateway?.broadcastToAll({ type: "server_restarting", reason, quiesceMs, requestId });
    } catch { /* best-effort */ }
  };
  const serverStartTime = Date.now();

  // pi-version-skew compatibility surface for `/api/health`. Computed lazily
  // and cached 30s: the probe does a ToolRegistry resolve + file read, which
  // must not run on every rapid health poll. `null` when pi is unresolvable
  // (a clean install may legitimately predate a pi install). See change:
  // restore-pi-version-skew-surface.
  const serverPkgJsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../package.json");
  const COMPAT_CACHE_MS = 30_000;
  let compatCache: { at: number; value: BootstrapCompatibility | null } | null = null;
  // Pi runtime divergence, on the SAME 30s cache as `compatibility`: the
  // snapshot does a registry resolve + filesystem enumeration and must not run
  // on every health poll.
  //
  // Two divergence predicates are reported under DISTINCT labels and never
  // conflated (design D5): `piConsumerDivergence` asks "do the two pi consumers
  // resolve to the same install", `piInstallSetDivergence` asks "is there more
  // than one pi version anywhere on this box". A user with one unused old
  // install has the latter and not the former.
  // See change: select-pi-runtime-install.
  let piDivergenceCache: { at: number; value: PiDivergenceHealth | null } | null = null;
  const readPiDivergence = (): PiDivergenceHealth | null => {
    const now = Date.now();
    if (piDivergenceCache && now - piDivergenceCache.at < COMPAT_CACHE_MS) {
      return piDivergenceCache.value;
    }
    let value: PiDivergenceHealth | null = null;
    try {
      const snap = piRuntimeSnapshot();
      value = {
        consumerDiverged: snap.consumerDiverged,
        consumerMessage: consumerDivergenceMessage(snap),
        spawnVersion: snap.spawn.version,
        moduleVersion: snap.module.version,
        installSetDiverged: snap.installSetDiverged,
        installSetVersions: snap.installSetVersions,
      };
    } catch (err) {
      // Health must stay up, so this degrades to `null` rather than throwing —
      // but a PERSISTENT enumeration failure would otherwise be invisible, with
      // `piRuntime: null` indistinguishable from "nothing to report".
      fastify.log.debug({ err }, "pi runtime divergence snapshot failed");
      value = null;
    }
    piDivergenceCache = { at: now, value };
    return value;
  };

  const readCompatibility = (): BootstrapCompatibility | null => {
    const now = Date.now();
    if (compatCache && now - compatCache.at < COMPAT_CACHE_MS) return compatCache.value;
    let value: BootstrapCompatibility | null = null;
    try {
      const current = readCurrentPiVersion();
      value = current ? computeCompatibility(readPiCompatibility(serverPkgJsonPath), current) : null;
    } catch {
      value = null;
    }
    compatCache = { at: now, value };
    return value;
  };

  // Config endpoints
  fastify.get(
    "/api/config",
    { preHandler: networkGuard },
    async () => {
      // `reachability` is COMPUTED, never persisted, and rides this guarded
      // surface rather than `/api/health` — it describes the operator's private
      // network topology, and `/api/health` has no preHandler. Failure-isolated
      // like `eventLoopDelay` / `storeTrim` / `notifyLog`: a throw here must
      // never take the config response down with it.
      // See change: warn-unreachable-trusted-networks.
      const configModule = await import("@blackbelt-technology/pi-dashboard-shared/config.js");
      const reachability = safeComputeBindReachability(configModule.loadConfig);
      return { success: true, data: { ...readConfigRedacted(), reachability } };
    },
  );

  // ── Gateway (tunnel) — endpoints, enroll, block-events ──────────────
  // "Accessible at": every tagged address the dashboard answers on. Sourced
  // from the active tunnel URL + manual publicBaseUrls + LAN/local. Auth-gated.
  // See change: add-tunnel-providers.
  fastify.get(
    "/api/tunnel/endpoints",
    { preHandler: networkGuard },
    async () => {
      const url = getTunnelUrl();
      const providerEndpoints = url
        ? [{ kind: "public" as const, url, tls: url.startsWith("https://") }]
        : [];
      const configModule = await import("@blackbelt-technology/pi-dashboard-shared/config.js");
      const cfg = configModule.loadConfig();
      const endpoints = collectEndpoints({
        providerEndpoints,
        publicBaseUrls: configModule.resolvePublicBaseUrls(cfg),
        port: config.port,
      });
      return { success: true, data: { endpoints } } satisfies ApiResponse;
    },
  );

  // Run a whitelisted enroll step (auth-token/activate) server-side. The token
  // is a validated parameter; arbitrary commands are refused. Auth-gated.
  fastify.post<{ Body: { provider?: string; step?: string; param?: string } }>(
    "/api/tunnel/enroll",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { provider, step, param } = request.body ?? {};
      if (!provider || !step || typeof param !== "string") {
        return reply.code(400).send({ success: false, error: "provider, step, param required" });
      }
      const result = await runEnrollStep(provider as any, step as any, param);
      if (result.ok) return { success: true };
      const code = result.reason === "unknown-step" || result.reason === "invalid-param" ? 400 : 422;
      return reply.code(code).send({ success: false, error: result.message });
    },
  );

  // Recent network-guard denials for the "Trust this network?" banner.
  // Anti-poisoning buffer; trust/remove itself goes through PUT /api/config
  // (config.trustedNetworks). Auth-gated.
  fastify.get(
    "/api/tunnel/block-events",
    { preHandler: networkGuard },
    async () => {
      return { success: true, data: { events: blockEvents.list() } } satisfies ApiResponse;
    },
  );

  fastify.put(
    "/api/config",
    { preHandler: networkGuard },
    async (request, reply) => {
      const partial = request.body as Record<string, any>;
      if (!partial || typeof partial !== "object") {
        return reply.code(400).send({ success: false, error: "Invalid body" });
      }
      const result = writeConfigPartial(partial);
      if (!result.success) {
        return reply.code(500).send({ success: false, error: result.error });
      }

      // Apply runtime-safe changes
      const reloaded = (await import("@blackbelt-technology/pi-dashboard-shared/config.js")).loadConfig();

      // Push the recomputed reachability when ANY part of the published fact
      // moved — not just `pendingBindHost`. A write that edits `trustedNetworks`
      // or `auth.bypassHosts` keeps the same bind host yet changes
      // `unreachable`, and gating on the host alone would leave every OTHER
      // connected browser on a stale advisory until it reloaded. Failure-
      // isolated: a config write must never fail because an advisory could not
      // be computed. See change: warn-unreachable-trusted-networks.
      try {
        const before = getLastBindReachability();
        const configModule = await import("@blackbelt-technology/pi-dashboard-shared/config.js");
        const after = computeBindReachability(configModule.loadConfig);
        if (!before || !sameReachability(before, after)) {
          browserGateway?.broadcastToAll({ type: "reachability_updated", reachability: after });
        }
      } catch { /* advisory only */ }
      if (partial.autoShutdown !== undefined || partial.shutdownIdleSeconds !== undefined) {
        config.autoShutdown = reloaded.autoShutdown;
        config.shutdownIdleSeconds = reloaded.shutdownIdleSeconds;
      }
      if (partial.auth !== undefined) {
        config.authConfig = reloaded.auth;
        if (reloaded.auth && (fastify as any)._reloadAuth) {
          // Full config, not only `reloaded.auth`: the reload has to merge
          // top-level `trustedNetworks` exactly as boot does (D15).
          await (fastify as any)._reloadAuth(reloaded.auth, reloaded);
        }
      }
      if (partial.openspec !== undefined && directoryService) {
        directoryService.reconfigurePolling(reloaded.openspec);
      }
      // Session-ordering gates take effect immediately (no restart) so the
      // Settings toggles apply to the next status transition.
      // See change: simplify-session-card-ordering.
      if (partial.completedFirst !== undefined) {
        config.completedFirst = reloaded.completedFirst;
      }
      if (partial.questionFirst !== undefined) {
        config.questionFirst = reloaded.questionFirst;
      }
      // Live-reload tunnel watchdog when its config changes (no restart needed).
      // We always restart the watchdog when partial.tunnel is present and a
      // tunnel is currently active — covers both watchdog flag changes and
      // numeric tweaks. Cheap operation: stop + start with new config.
      if (partial.tunnel !== undefined) {
        config.tunnelWatchdog = reloaded.tunnel.watchdog;
        // Re-source the v2 reserved-name / persistence from the reloaded config.
        config.tunnelReservedName = reloaded.tunnel.zrok?.reservedName;
        config.tunnelPersistent = reloaded.tunnel.zrok?.persistent;
        if (getTunnelUrl()) {
          stopTunnelWatchdog();
          const wd = reloaded.tunnel.watchdog;
          if (wd?.enabled !== false) {
            startTunnelWatchdog(
              {
                getUrl: getTunnelUrl,
                recycle: async () => {
                  await deleteTunnel(config.port);
                  return await createTunnel(config.port, config.tunnelReservedName);
                },
              },
              wd,
            );
          }
        }
      }

      return { success: true, restartRequired: result.restartRequired };
    },
  );

  // Which redirect base actually WON, and which tier produced it (D10). The
  // D4 warning says a value is malformed; this says which of the four tiers is
  // in force — the actual question when OAuth breaks.
  //
  // Gated (it discloses the deployment's public origin) but deliberately NOT
  // remote-only: `networkGuard` admits loopback, which is how the `doctor`
  // skill module reads it server-side without a JWT. A remote operator whose
  // OAuth is broken cannot obtain one.
  //
  // `authActive: false` when the boot registry was empty: in that state no
  // `/auth/*` route and no `_reloadAuth` exist, so a live-looking value would
  // be boot-frozen and misleading (D6).
  // See change: config-override-oauth-redirect-base.
  fastify.get(
    "/api/auth/diagnostics",
    { preHandler: networkGuard },
    async () => {
      const { resolveRedirectBase } = await import("../auth/auth.js");
      const cfg = (await import("@blackbelt-technology/pi-dashboard-shared/config.js")).loadConfig();
      const { base, source } = resolveRedirectBase(config.port, cfg.auth?.redirectBaseUrl);
      return {
        success: true,
        data: {
          redirectBase: base,
          source,
          authActive: Boolean((fastify as any)._reloadAuth),
          providerCount: Object.keys(cfg.auth?.providers ?? {}).length,
        },
      } satisfies ApiResponse;
    },
  );

  // Delete ONE OAuth provider. A separate verb rather than a delete sentinel
  // inside the secret-preserving providers merge (D9), behind the same guard as
  // PUT /api/config. Idempotent. Deleting the LAST provider leaves auth
  // ENFORCED with no login path, so it is refused without `?force=true`.
  // See change: config-override-oauth-redirect-base.
  fastify.delete<{ Params: { id: string }; Querystring: { force?: string } }>(
    "/api/config/auth/providers/:id",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { id } = request.params;
      const force = request.query?.force === "true";
      const result = deleteAuthProvider(id, { force });

      if (!result.success && result.reason === "last-provider") {
        return reply.code(409).send({
          success: false,
          error:
            `"${id}" is the last OAuth provider. Deleting it does NOT disable auth: ` +
            "the gate stays installed and /auth/login would list no way to sign in, " +
            "which can lock out every remote operator until the server is restarted. " +
            "Repeat with ?force=true to accept that.",
        } satisfies ApiResponse);
      }
      if (!result.success) {
        return reply.code(500).send({ success: false, error: result.error } satisfies ApiResponse);
      }

      if (result.deleted) {
        const reloaded = (await import("@blackbelt-technology/pi-dashboard-shared/config.js")).loadConfig();
        config.authConfig = reloaded.auth;
        if (reloaded.auth && (fastify as any)._reloadAuth) {
          // Full config, not only `reloaded.auth`: the reload has to merge
          // top-level `trustedNetworks` exactly as boot does (D15).
          await (fastify as any)._reloadAuth(reloaded.auth, reloaded);
        }
      }
      return {
        success: true,
        data: { deleted: result.deleted, remaining: result.remaining },
      } satisfies ApiResponse;
    },
  );

  // Tunnel endpoints
  fastify.get("/api/tunnel-status", async () => {
    return getTunnelStatus();
  });

  fastify.post("/api/tunnel-connect", async () => {
    const status = getTunnelStatus();
    if (status.status === "active") return { ok: true, url: status.url };
    if (status.status === "unavailable") return { ok: false, error: "zrok not installed" };
    // v2: resolve the reserved NAME (stored or minted-when-persistent) and
    // cache it so watchdog recycles reuse the SAME name (stable URL).
    const reservedName = ensureReservedName({
      reservedName: config.tunnelReservedName,
      persistent: config.tunnelPersistent,
    });
    config.tunnelReservedName = reservedName;
    const url = await createTunnel(config.port, reservedName);
    if (url) {
      const wd = config.tunnelWatchdog;
      if (wd?.enabled !== false) {
        startTunnelWatchdog(
          {
            getUrl: getTunnelUrl,
            recycle: async () => {
              await deleteTunnel(config.port);
              return await createTunnel(config.port, config.tunnelReservedName);
            },
          },
          wd,
        );
      }
      return { ok: true, url };
    }
    return { ok: false, error: "Failed to create tunnel" };
  });

  fastify.post("/api/tunnel-disconnect", async (req, reply) => {
    // Pass port so orphan zrok processes bound to this endpoint are also
    // swept (not just the one we tracked via pid-file).
    stopTunnelWatchdog();
    await deleteTunnel(config.port);
    // Plain disconnect PRESERVES the reserved name (stable URL survives a
    // disconnect/restart). `{forget:true}` is the ONLY path that releases it:
    // `delete name` + clear config. See change: support-zrok-v2.
    const body = (req.body ?? {}) as { forget?: boolean };
    if (body.forget === true) {
      const name = config.tunnelReservedName;
      if (name) releaseShare(name);
      const written = writeConfigPartial({ tunnel: { zrok: { reservedName: undefined, persistent: false } } });
      if (!written.success) {
        // The name was released remotely but disk still points at it — surface
        // the failure instead of a misleading ok.
        return reply.code(500).send({ ok: false, error: written.error ?? "failed to clear reserved name" });
      }
      config.tunnelReservedName = undefined;
      config.tunnelPersistent = false;
    }
    return { ok: true };
  });

  // Health endpoint — includes server + agent process metrics
  fastify.get("/api/health", async () => {
    const mem = process.memoryUsage();
    // Telemetry reads are failure-isolated so a throwing provider can never
    // turn /api/health into a 500. See change: instrument-session-hydration-timing.
    let eventLoopDelay = { meanMs: 0, p99Ms: 0, maxMs: 0 };
    try { eventLoopDelay = readEventLoopDelay?.() ?? eventLoopDelay; } catch { /* keep zeros */ }
    let hydration: ReturnType<HydrationMetrics["snapshot"]> = [];
    try { hydration = hydrationMetrics?.snapshot() ?? hydration; } catch { /* keep empty */ }
    let eventLoopSpikesSnap: ReturnType<EventLoopSpikeMetrics["snapshot"]> = [];
    try { eventLoopSpikesSnap = eventLoopSpikes?.snapshot() ?? eventLoopSpikesSnap; } catch { /* keep empty */ }
    let notifyLogStats = { evictedEntries: 0, bySession: {} as Record<string, number> };
    try { notifyLogStats = browserGateway?.getNotifyLogStats?.() ?? notifyLogStats; } catch { /* keep zeros */ }
    const activeSessions = sessionManager.listActive();
    const agentMetrics = activeSessions
      .filter(s => s.processMetrics)
      .map(s => ({
        sessionId: s.id,
        cwd: s.cwd,
        ...s.processMetrics,
      }));
    return {
      ok: true,
      pid: process.pid,
      // launchSource: single source of truth for arm-aware client gating
      // (e.g. hide pi-core update UI under Electron, since bundled
      // node_modules/ is read-only). See change:
      // eliminate-electron-runtime-install task 3.2.
      launchSource: parseLaunchSource(process.env),
      // Boot parent PID (static, captured at module load) + live parent PID
      // (reparenting-aware, read fresh per request) + boot-parent liveness.
      // Powers Electron zombie detection: POSIX compares live `ppid` against
      // `bootParentPid` plus `bootParentAlive`; Windows uses `bootParentAlive`
      // alone (Windows never reparents). See change:
      // electron-attach-ownership-fixes.
      bootParentPid,
      ppid: readLivePpid(),
      bootParentAlive: computeBootParentAlive(),
      // Count of pi WebSocket connections held by the pi-gateway. Feeds the
      // bridge-orphan promotion below and future Doctor advisories.
      activeBridgeCount: piGateway?.connectionCount() ?? 0,
      // Bridge-contention observability: `bridgeContentionCount` is cumulative
      // for the process lifetime (a rule firing too often), while
      // `contendedSessionIds` is what an operator needs mid-incident and
      // follows the contention record's own lifecycle (reclaim, 60 s expiry,
      // incumbent disconnect, or session end).
      // See change: fix-duplicate-bridge-registration (D6).
      bridgeContentionCount: piGateway?.contention.count() ?? 0,
      contendedSessionIds: piGateway?.contention.contendedIds() ?? [],
      // The bound gateway port. Diagnosing "my bridge cannot register" needs
      // the port the gateway actually bound, which is not the file-config
      // value when it was allocated dynamically.
      piGatewayPort: piGateway?.address() ?? null,
      // Derived label: promotes a stale `bridge` (no live session, past the
      // 30 s grace window) to `bridge-orphaned`. Static `launchSource` above
      // is left untouched for the `decideShutdownOnQuit` back-compat rule.
      launchSourceEffective: computeEffectiveLaunchSource({
        raw: parseLaunchSource(process.env),
        activeBridgeCount: piGateway?.connectionCount() ?? 0,
        uptimeMs: Date.now() - serverStartTime,
      }),
      // Host OS the dashboard server runs on. Used by Settings → Tools to
      // filter install hints to the host (not the browser) OS — a mobile
      // browser hitting a Linux dashboard must see Linux install commands.
      // See change: register-bash-and-tool-install-help.
      platform: process.platform,
      // Server-advertised host capabilities. `systemOpen` gates the editor-pane
      // *Open in system app* / *Reveal in file manager* tab actions: true only
      // on a desktop-capable host, false headless/container/remote. Computed
      // once at startup. See change: open-view-command-in-editor-pane (D9).
      capabilities: { systemOpen: systemOpenCapability() },
      version: version ?? "unknown",
      uptime: Math.floor((Date.now() - serverStartTime) / 1000),
      // ISO timestamp of process start. Used by the Plugins tab to detect
      // server restarts and clear the Restart-required banner.
      // See change: add-plugin-activation-ui.
      startedAt: new Date(serverStartTime).toISOString(),
      mode: config.dev ? "dev" : "production",
      server: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        activeSessions: activeSessions.length,
        totalSessions: sessionManager.listAll().length,
      },
      agents: agentMetrics,
      plugins: enrichWithBridgeSource(getPluginStatusStore().listAll()),
      // Build-time-vs-runtime plugin-bundle hash. Clients compare it to
      // the embedded `PLUGIN_REGISTRY_HASH` to detect stale bundles.
      // See change: fix-pi-flows-end-to-end (Group 6).
      // Must hash over the SAME plugin set the vite-plugin used at build
      // time — production builds exclude `fixture: true` plugins (e.g. demo).
      // Without this filter, the runtime hash would differ from the embedded
      // PLUGIN_REGISTRY_HASH and the staleness banner would always show.
      bundleHash: pluginRegistryHash(
        discoverPlugins().filter((p) =>
          config.dev ? true : p.manifest.fixture !== true,
        ),
      ),
      proxy: getModelProxyStatus(),
      // Windows-only: active git/sh source readout for Settings + Diagnostics.
      // null on macOS/Linux. See change: embed-git-bash-on-windows.
      gitSource: getGitSourceReadout(whichSync),
      // Event-loop delay (ms) over the window since the last /api/health read.
      // Correlates hydration spikes with real main-loop lag. Additive field.
      // See change: instrument-session-hydration-timing.
      eventLoopDelay,
      // Recent worst-case event-loop stalls, newest-first. Additive field.
      // Each entry: {at, ms, turn}; `turn` is the attributed poll turn
      // (tickOpen/dirPollPre/dirPollPost) or null for the dedicated sampler.
      // See change: attribute-openspec-poll-eventloop-stalls.
      eventLoopSpikes: eventLoopSpikesSnap,
      // Recent session-hydration timing samples, newest-first. Additive field.
      hydration,
      // pi-version-skew compatibility (30s-cached) or null when pi is
      // unresolvable. Drives the Settings → General advisory. See change:
      // restore-pi-version-skew-surface.
      compatibility: readCompatibility(),
      // Pi runtime divergence, under two distinct labels (see readPiDivergence).
      // See change: select-pi-runtime-install (design D5).
      piRuntime: readPiDivergence(),
      // Per-hop dropped-frame counters (observability for silently-dropped
      // WS frames). `serverToBrowser` = frames the fanout skipped under
      // back-pressure; `bridgeToServer` = the max bridge ring-buffer eviction
      // count reported across active sessions' heartbeats. See change:
      // fix-stuck-tool-card-on-dropped-event.
      droppedFrames: {
        serverToBrowser: browserGateway?.getDroppedFrameStats?.() ?? { total: 0, bySession: {} },
        bridgeToServer: activeSessions.reduce(
          (max, s) => Math.max(max, (s.processMetrics as { droppedBufferedFrames?: number } | undefined)?.droppedBufferedFrames ?? 0),
          0,
        ),
      },
      // Subagent-tick throttle counters, summed across active bridges. Rides
      // the heartbeat `processMetrics` transport, so the per-session breakdown
      // is already in `agents[]` above and this block is the session-agnostic
      // roll-up. `tickDiscardedAtTerminal` + `tickDroppedNotReady` are the
      // throttle's only two information-loss modes; they sit here beside the
      // other silent-loss counters for exactly that reason.
      // See change: reduce-bridge-tick-bandwidth (D6).
      subagentTickThrottle: activeSessions.reduce(
        (acc, s) => {
          const m = s.processMetrics as Record<string, number | undefined> | undefined;
          acc.tickForwarded += m?.tickForwarded ?? 0;
          acc.tickCoalesced += m?.tickCoalesced ?? 0;
          acc.tickDiscardedAtTerminal += m?.tickDiscardedAtTerminal ?? 0;
          acc.tickDroppedNotReady += m?.tickDroppedNotReady ?? 0;
          return acc;
        },
        { tickForwarded: 0, tickCoalesced: 0, tickDiscardedAtTerminal: 0, tickDroppedNotReady: 0 },
      ),
      // Notify-log cap evictions (silent transcript loss on a chatty emitter),
      // surfaced beside the other silent-loss counters.
      // See change: split-notify-from-prompt-request.
      notifyLog: notifyLogStats,
      // In-memory event-store shed counters (per-session trim + cross-session
      // LRU eviction). The third silent tool_execution_end loss path, made
      // observable beside droppedFrames. See change: instrument-event-store-trim.
      // The fallback is the store's own EXPLICITLY-TYPED all-zero constant, not
      // an inline literal: TypeScript types `a ?? b` as `NonNullable<A> | B` and
      // does NOT check `b` against `A`, so an inline literal would silently omit
      // a newly-required field while still typechecking.
      // See change: collapse-superseded-tool-execution-updates (D9).
      storeTrim: eventStore?.getTrimStats?.() ?? EMPTY_TRIM_STATS,
      // Embed-session-lifecycle diagnostics (active/idle ephemeral counts,
      // reaped-by-reason, capacity rejections, acquire reuse hit/miss). Failure-
      // isolated so a throwing snapshot can never 500 the health hot path.
      // See change: add-embed-session-lifecycle.
      embedLifecycle: (() => {
        try {
          return embedLifecycle?.snapshot();
        } catch {
          return undefined;
        }
      })(),
    };
  });

  // Shutdown endpoint — used by devBuildOnReload
  fastify.post<{ Body?: { userQuit?: boolean } }>(
    "/api/shutdown",
    { preHandler: networkGuard },
    async (request) => {
      // Record WHY the server is going away, before anything can kill us.
      // Default `shutdown`: this process exits without touching the pi
      // sessions and announces a 60 s bridge quiesce, so those sessions are
      // still running and will reattach long after any recovery grace window
      // — offering them would be a phantom offer. An Electron `before-quit`
      // declares `userQuit`, where the sessions may genuinely be gone; that
      // case is left to the liveness gate rather than suppressed.
      // See change: fix-recovery-exit-intent.
      recordExitIntent(request.body?.userQuit === true ? "user-quit" : "shutdown");
      metaPersistence.flushAll();
      preferencesStore.flush();
      // Tell every connected bridge that the server is going away deliberately
      // BEFORE we start tearing down state, so bridges suppress auto-start.
      // See change: fix-restart-bridge-auto-start-race.
      announceRestart("shutdown", SHUTDOWN_QUIESCE_MS);
      // Tear down the zrok tunnel (and sweep orphans on our port) so restarts
      // don't leak reservations that leave stale URLs backed by nothing.
      try { await deleteTunnel(config.port); } catch { /* best-effort */ }
      setTimeout(() => process.exit(0), 100);
      return { ok: true };
    },
  );

  // Re-extract endpoint — Electron-only; 403 for Bridge/Standalone, 202 for Electron.
  // See change: simplify-electron-bootstrap-derived-state (task 6.4).
  fastify.post(
    "/api/electron/reextract",
    { preHandler: networkGuard },
    async (_request, reply) => {
      const launchSource = parseLaunchSource(process.env);
      if (launchSource !== "electron") {
        reply.status(403);
        return {
          error: "reextract_not_allowed",
          message: `Re-extract is only available when the server was started by Electron (current launchSource: ${launchSource})`,
          launchSource,
        };
      }
      reply.status(202);
      return { ok: true, message: "Re-extraction scheduled. Electron will restart the server." };
    },
  );

  // Restart endpoint — flush state, spawn new server, then exit
  fastify.post<{ Body: { dev?: boolean; requestId?: string } }>(
    "/api/restart",
    { preHandler: networkGuard },
    async (request) => {
      // The false positive this change exists to kill: `/api/restart` exits via
      // `process.exit(0)` without clearing a single `live` marker, so every
      // surviving session looked crashed to the next boot. Record the intent
      // BEFORE the exit sequence — write-once, so the restart-helper's
      // SIGTERM ladder cannot overwrite it with `signal`.
      // See change: fix-recovery-exit-intent.
      recordExitIntent("restart");
      metaPersistence.flushAll();
      preferencesStore.flush();

      // Announce restart to every bridge BEFORE spawning the replacement so
      // bridges suppress their auto-start spawn step and don't race the
      // orchestrator. See change: fix-restart-bridge-auto-start-race.
      // Echo the optional client requestId to browsers so a confirm:"ws"
      // restart click can correlate. Bound it to a sane string before fanning
      // out to all browser clients. See change: add-async-action-feedback.
      const rawReqId = request.body?.requestId;
      const requestId = typeof rawReqId === "string" && rawReqId.length <= 128 ? rawReqId : undefined;
      announceRestart("restart", RESTART_QUIESCE_MS, requestId);

      // Tear down tunnel before spawning the replacement process so the new
      // server doesn't race an orphan zrok agent on the same port.
      try { await deleteTunnel(config.port); } catch { /* best-effort */ }

      const cliPath = process.argv[1];
      if (!cliPath) return { ok: false, error: "Cannot determine CLI path" };

      // Find the TypeScript loader from process.execArgv (--import <loader>)
      const importIdx = process.execArgv.indexOf("--import");
      const loader = importIdx >= 0 ? (process.execArgv[importIdx + 1] ?? "") : "";

      // Allow overriding dev mode via request body
      const useDev = request.body?.dev ?? config.dev;
      const extraArgs: string[] = [];
      if (useDev) extraArgs.push("--dev");

      // Cross-platform restart: spawns a detached Node orchestrator that
      // polls the port via net, spawns the new server, polls /api/health
      // via http. No dependency on sh/lsof/curl — works on Windows too.
      // See change: fix-windows-server-parity.
      spawnRestart({
        cliPath,
        loader,
        port: config.port,
        // Carry the bound gateway port across the restart. Without it the new
        // process re-resolves it from the file config (which usually has no
        // `piPort`), lands on the 9999 default, and every live pi bridge — still
        // dialling the old port — fails to re-register.
        // See change: restore-ask-user-tool-state-on-reconnect.
        piPort: config.piPort,
        extraArgs,
        dev: useDev,
      });

      setTimeout(() => process.exit(0), 200);
      return { ok: true };
    },
  );

  // Network interfaces for trusted networks UI (localhost-only for security)
  // GET /api/spawn-failures — rolling log of failed spawn attempts. See change: spawn-failure-diagnostics.
  fastify.get<{ Querystring: { limit?: string } }>(
    "/api/spawn-failures",
    async (request) => {
      const rawLimit = request.query.limit;
      const parsed = rawLimit !== undefined ? parseInt(rawLimit, 10) : NaN;
      const limit = Number.isNaN(parsed) ? 50 : parsed;
      const entries = readSpawnFailures(limit);
      return { entries };
    },
  );

  fastify.get(
    "/api/network-interfaces",
    { preHandler: localhostGuard },
    async (_request, reply) => {
      const out = buildNetworkInterfaceList(os.networkInterfaces);
      if (!out.success) return reply.code(500).send(out);
      return out;
    },
  );
}
