/**
 * System REST API routes: config, health, shutdown, tunnel, editors.
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
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { getGitSourceReadout } from "@blackbelt-technology/pi-dashboard-shared/platform/git-source.js";
import { classifyBridgeSource } from "@blackbelt-technology/pi-dashboard-shared/plugin-bridge-register.js";
import type { NetworkInterface } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import { bootParentPid, computeBootParentAlive, readLivePpid } from "../boot-parent-liveness.js";
import { readConfigRedacted, writeConfigPartial } from "../config-api.js";
import type { DirectoryService } from "../directory-service.js";
import { detectCodeServerBinary, resetDetectionCache } from "../editor-detection.js";
import { detectEditors, EDITORS } from "../editor-registry.js";
import type { EventLoopSpikeMetrics } from "../eventloop-spike-metrics.js";
import type { HydrationMetrics } from "../hydration-metrics.js";
import { computeEffectiveLaunchSource } from "../launch-source-effective.js";
import { decodeFileUri } from "../lib/decode-file-uri.js";
import { isAllowed } from "../lib/path-containment.js";
import { localhostGuard, netmaskToCidrBits, networkAddress } from "../localhost-guard.js";
import type { SessionManager } from "../memory-session-manager.js";
import type { MetaPersistence } from "../meta-persistence.js";
import { getModelProxyStatus } from "../model-proxy/registry-singleton.js";
import type { PiGateway } from "../pi-gateway.js";
import {
  type BootstrapCompatibility,
  computeCompatibility,
  readCurrentPiVersion,
  readPiCompatibility,
} from "../pi-version-skew.js";
import type { PreferencesStore } from "../preferences-store.js";
import { spawnRestart } from "../restart-helper.js";
import type { ServerConfig } from "../server.js";
import { readSpawnFailures } from "../spawn-failure-log.js";
import { createTunnel, deleteTunnel, getTunnelStatus, getTunnelUrl } from "../tunnel.js";
import { blockEvents } from "../tunnel-block-events.js";
import { collectEndpoints } from "../tunnel-endpoints.js";
import { runEnrollStep } from "../tunnel-enroll.js";
import { startTunnelWatchdog, stopTunnelWatchdog } from "../tunnel-watchdog.js";
import type { NetworkGuard } from "./route-deps.js";

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
    eventStore?: {
      getTrimStats?: () => {
        trimmedEvents: { total: number; toolExecutionEnd: number; bySession: Record<string, number> };
        evictedSessions: number;
      };
    };
  },
) {
  const { sessionManager, preferencesStore, metaPersistence, config, networkGuard, version, directoryService, piGateway, browserGateway, hydrationMetrics, readEventLoopDelay, eventLoopSpikes, eventStore } = deps;

  // Quiesce windows for the bridge `server_restarting` broadcast. See change
  // `fix-restart-bridge-auto-start-race`. Bridges that receive this message
  // suppress only the spawn step in `server-auto-start.ts` for `quiesceMs`;
  // discovery + reconnection still run.
  const RESTART_QUIESCE_MS = 5000;
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

  // Editor detection endpoint
  fastify.get<{ Querystring: { path?: string } }>(
    "/api/editors",
    { preHandler: networkGuard },
    async (request) => {
      const cwd = request.query.path;
      if (!cwd) {
        return { success: false, error: "path parameter required" } satisfies ApiResponse;
      }
      const editors = detectEditors(cwd);
      return { success: true, data: editors } satisfies ApiResponse;
    },
  );

  // code-server binary detection endpoint
  fastify.get(
    "/api/editor/detect",
    { preHandler: networkGuard },
    async () => {
      resetDetectionCache();
      const result = detectCodeServerBinary(config.editor);
      return { success: true, data: result } satisfies ApiResponse;
    },
  );

  // Open editor endpoint
  fastify.post<{ Body: { path?: string; editor?: string; file?: string; line?: number } }>(
    "/api/open-editor",
    { preHandler: networkGuard },
    async (request) => {
      const { path: cwd, editor: editorId, file: rawFile, line } = request.body ?? {};
      const file = rawFile ? decodeFileUri(rawFile) : rawFile;
      if (!cwd || !editorId) {
        return { success: false, error: "path and editor required" } satisfies ApiResponse;
      }

      const allSessions = sessionManager.listAll();
      if (!allSessions.some((s) => s.cwd === cwd)) {
        return { success: false, error: "unknown session path" } satisfies ApiResponse;
      }

      const editorEntry = EDITORS.find((e) => e.id === editorId);
      if (!editorEntry) {
        return { success: false, error: "unknown editor" } satisfies ApiResponse;
      }

      const target = file ? path.resolve(cwd, file) : cwd;
      // Containment gate (mirrors /api/file): the resolved target MUST stay
      // under the known session cwd or its git common root. Rejects `../..`
      // traversal and absolute paths (`/etc/...`, decoded `file://...`) outside
      // the workspace.
      if (!(await isAllowed(target, { anchors: [cwd] }))) {
        return { success: false, error: "path outside working directory" } satisfies ApiResponse;
      }
      const args = line && file ? [`${target}:${line}`] : [target];

      try {
        const child = spawn(editorEntry.cli, args, {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        return { success: true } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, error: `failed to open editor: ${err.message}` } satisfies ApiResponse;
      }
    },
  );

  // Config endpoints
  fastify.get(
    "/api/config",
    { preHandler: networkGuard },
    async () => {
      return { success: true, data: readConfigRedacted() };
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
      const cfg = (await import("@blackbelt-technology/pi-dashboard-shared/config.js")).loadConfig();
      const endpoints = collectEndpoints({
        providerEndpoints,
        publicBaseUrls: cfg.pairing?.publicBaseUrls,
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
      if (partial.autoShutdown !== undefined || partial.shutdownIdleSeconds !== undefined) {
        config.autoShutdown = reloaded.autoShutdown;
        config.shutdownIdleSeconds = reloaded.shutdownIdleSeconds;
      }
      if (partial.auth !== undefined) {
        config.authConfig = reloaded.auth;
        if (reloaded.auth && (fastify as any)._reloadAuth) {
          await (fastify as any)._reloadAuth(reloaded.auth);
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
        if (getTunnelUrl()) {
          stopTunnelWatchdog();
          const wd = reloaded.tunnel.watchdog;
          if (wd?.enabled !== false) {
            startTunnelWatchdog(
              {
                getUrl: getTunnelUrl,
                recycle: async () => {
                  await deleteTunnel(config.port);
                  return await createTunnel(config.port, config.tunnelReservedToken);
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

  // Tunnel endpoints
  fastify.get("/api/tunnel-status", async () => {
    return getTunnelStatus();
  });

  fastify.post("/api/tunnel-connect", async () => {
    const status = getTunnelStatus();
    if (status.status === "active") return { ok: true, url: status.url };
    if (status.status === "unavailable") return { ok: false, error: "zrok not installed" };
    const url = await createTunnel(config.port, config.tunnelReservedToken);
    if (url) {
      const wd = config.tunnelWatchdog;
      if (wd?.enabled !== false) {
        startTunnelWatchdog(
          {
            getUrl: getTunnelUrl,
            recycle: async () => {
              await deleteTunnel(config.port);
              return await createTunnel(config.port, config.tunnelReservedToken);
            },
          },
          wd,
        );
      }
      return { ok: true, url };
    }
    return { ok: false, error: "Failed to create tunnel" };
  });

  fastify.post("/api/tunnel-disconnect", async () => {
    // Pass port so orphan zrok processes bound to this endpoint are also
    // swept (not just the one we tracked via pid-file).
    stopTunnelWatchdog();
    await deleteTunnel(config.port);
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
      // In-memory event-store shed counters (per-session trim + cross-session
      // LRU eviction). The third silent tool_execution_end loss path, made
      // observable beside droppedFrames. See change: instrument-event-store-trim.
      storeTrim: eventStore?.getTrimStats?.() ?? {
        trimmedEvents: { total: 0, toolExecutionEnd: 0, bySession: {} },
        evictedSessions: 0,
      },
    };
  });

  // Shutdown endpoint — used by devBuildOnReload
  fastify.post(
    "/api/shutdown",
    { preHandler: networkGuard },
    async () => {
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
    async () => {
      const interfaces = os.networkInterfaces();
      const result: NetworkInterface[] = [];
      for (const [name, addrs] of Object.entries(interfaces)) {
        if (!addrs) continue;
        for (const info of addrs) {
          if (info.internal || info.family !== "IPv4") continue;
          const bits = netmaskToCidrBits(info.netmask);
          const net = networkAddress(info.address, info.netmask);
          result.push({
            name,
            address: info.address,
            netmask: info.netmask,
            cidr: `${net}/${bits}`,
          });
        }
      }
      return { success: true, data: result };
    },
  );
}
