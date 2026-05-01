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
import { createTunnel, deleteTunnel, getTunnelStatus } from "../tunnel.js";
import { spawnRestart } from "../restart-helper.js";
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import path from "node:path";
import os from "node:os";
import { localhostGuard, netmaskToCidrBits, networkAddress } from "../localhost-guard.js";
import { getPluginStatusStore } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { NetworkInterface } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

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
    if (url) return { ok: true, url };
    return { ok: false, error: "Failed to create tunnel" };
  });

  fastify.post("/api/tunnel-disconnect", async () => {
    // Pass port so orphan zrok processes bound to this endpoint are also
    // swept (not just the one we tracked via pid-file).
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
      version: version ?? "unknown",
      uptime: Math.floor((Date.now() - serverStartTime) / 1000),
      mode: config.dev ? "dev" : "production",
      server: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        activeSessions: activeSessions.length,
        totalSessions: sessionManager.listAll().length,
      },
      agents: agentMetrics,
      plugins: getPluginStatusStore().listAll(),
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
