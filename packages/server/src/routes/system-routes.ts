/**
 * System REST API routes: config, health, shutdown, tunnel, editors.
 */
import type { FastifyInstance } from "fastify";
import type { SessionManager } from "../memory-session-manager.js";
import type { PreferencesStore } from "../preferences-store.js";
import type { MetaPersistence } from "../meta-persistence.js";
import type { DirectoryService } from "../directory-service.js";
import type { PiGateway } from "../pi-gateway.js";
import type { ServerConfig } from "../server.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { NetworkGuard } from "./route-deps.js";
import { detectEditors, EDITORS } from "../editor-registry.js";
import { detectCodeServerBinary, resetDetectionCache } from "../editor-detection.js";
import { readConfigRedacted, writeConfigPartial } from "../config-api.js";
import { createTunnel, deleteTunnel, getTunnelStatus, getTunnelUrl } from "../tunnel.js";
import { getModelProxyStatus } from "../model-proxy/registry-singleton.js";
import { startTunnelWatchdog, stopTunnelWatchdog } from "../tunnel-watchdog.js";
import { spawnRestart } from "../restart-helper.js";
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import path from "node:path";
import os from "node:os";
import { localhostGuard, netmaskToCidrBits, networkAddress } from "../localhost-guard.js";
import { readSpawnFailures } from "../spawn-failure-log.js";
import {
  getPluginStatusStore,
  discoverPlugins,
  pluginRegistryHash,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { classifyBridgeSource } from "@blackbelt-technology/pi-dashboard-shared/plugin-bridge-register.js";
import fs from "node:fs";
import type { BridgeLoadSource, PluginStatus } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/plugin-status.js";
import type { NetworkInterface } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { parseLaunchSource } from "@blackbelt-technology/pi-dashboard-shared/dashboard-starter.js";

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
  },
) {
  const { sessionManager, preferencesStore, metaPersistence, config, networkGuard, version, directoryService, piGateway } = deps;

  // Quiesce windows for the bridge `server_restarting` broadcast. See change
  // `fix-restart-bridge-auto-start-race`. Bridges that receive this message
  // suppress only the spawn step in `server-auto-start.ts` for `quiesceMs`;
  // discovery + reconnection still run.
  const RESTART_QUIESCE_MS = 5000;
  const SHUTDOWN_QUIESCE_MS = 60000;
  const announceRestart = (reason: "restart" | "shutdown", quiesceMs: number) => {
    if (!piGateway) return;
    try {
      piGateway.broadcast({ type: "server_restarting", reason, quiesceMs });
    } catch { /* best-effort — never block exit on a flaky bridge socket */ }
  };
  const serverStartTime = Date.now();

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
      const { path: cwd, editor: editorId, file, line } = request.body ?? {};
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
  fastify.post<{ Body: { dev?: boolean } }>(
    "/api/restart",
    { preHandler: networkGuard },
    async (request) => {
      metaPersistence.flushAll();
      preferencesStore.flush();

      // Announce restart to every bridge BEFORE spawning the replacement so
      // bridges suppress their auto-start spawn step and don't race the
      // orchestrator. See change: fix-restart-bridge-auto-start-race.
      announceRestart("restart", RESTART_QUIESCE_MS);

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
