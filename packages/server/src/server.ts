/**
 * Dashboard HTTP + WebSocket server.
 */
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { createMemoryEventStore, type EventStore } from "./memory-event-store.js";
import { createMemorySessionManager, type SessionManager } from "./memory-session-manager.js";
import { createPiGateway, type PiGateway } from "./pi-gateway.js";
import { createBrowserGateway, type BrowserGateway } from "./browser-gateway.js";
import { createPreferencesStore, type PreferencesStore } from "./preferences-store.js";
import { createMetaPersistence, type MetaPersistence } from "./meta-persistence.js";
import { createSessionOrderManager, type SessionOrderManager } from "./session-order-manager.js";
import { createPendingForkRegistry, type PendingForkRegistry } from "./pending-fork-registry.js";

// pending-load-manager removed — server loads sessions directly via DirectoryService
import { createDirectoryService, type DirectoryService } from "./directory-service.js";
import { createTerminalManager, type TerminalManager } from "./terminal-manager.js";
import { createTerminalGateway, type TerminalGateway } from "./terminal-gateway.js";
import { writePid, removePid } from "./server-pid.js";
import { advertiseDashboard, stopAdvertising, createBrowser, type DashboardBrowser, type DiscoveredServer } from "@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js";
import { wireEvents } from "./event-wiring.js";
import { createIdleTimer } from "./idle-timer.js";
import { discoverAndBroadcastSessions } from "./session-bootstrap.js";
import { scanAllSessions } from "./session-scanner.js";
import { needsMigration, runMigration } from "./migrate-persistence.js";
import { detectZrokBinary, cleanupStaleZrok, createTunnel, deleteTunnel, scavengeOrphanZrokProcesses, getTunnelUrl } from "./tunnel.js";
import { registerAuthPlugin, validateWsUpgrade } from "./auth-plugin.js";
import { findBundledExtension, registerBridgeExtension } from "@blackbelt-technology/pi-dashboard-shared/bridge-register.js";
import { createNetworkGuard, isLoopback, isBypassedHost } from "./localhost-guard.js";
import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { registerSessionApi } from "./session-api.js";
import { registerSessionRoutes } from "./routes/session-routes.js";
import { registerGitRoutes } from "./routes/git-routes.js";
import { registerFileRoutes } from "./routes/file-routes.js";
import { registerOpenSpecRoutes } from "./routes/openspec-routes.js";
import { registerSystemRoutes } from "./routes/system-routes.js";
import { registerProviderAuthRoutes } from "./routes/provider-auth-routes.js";
import { registerPackageRoutes } from "./routes/package-routes.js";
import { registerRecommendedRoutes, invalidateRecommendedCache } from "./routes/recommended-routes.js";
import { registerPiCoreRoutes } from "./routes/pi-core-routes.js";
import { PiCoreChecker } from "./pi-core-checker.js";
import { PiCoreUpdater } from "./pi-core-updater.js";
import { registerToolRoutes } from "./routes/tool-routes.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { registerProviderRoutes } from "./routes/provider-routes.js";
import { PackageManagerWrapper } from "./package-manager-wrapper.js";
import { createEditorManager, type EditorManager } from "./editor-manager.js";
import { createEditorPidRegistry } from "./editor-pid-registry.js";
import { registerEditorRoutes } from "./routes/editor-routes.js";
import { registerKnownServersRoutes } from "./routes/known-servers-routes.js";
import { registerEditorProxy, handleEditorUpgrade } from "./editor-proxy.js";
import { detectCodeServerBinary } from "./editor-detection.js";

export interface ServerConfig {
  port: number;
  piPort: number;
  dev: boolean;
  autoShutdown: boolean;
  shutdownIdleSeconds: number;
  tunnel: boolean;
  tunnelReservedToken?: string;
  authConfig?: AuthConfig;
  /** Override WS ping interval for pi-gateway (ms). Default 60000. Set 0 to disable. */
  pingInterval?: number;
  /** Memory limit overrides from config */
  maxEventsPerSession?: number;
  maxStringFieldSize?: number;
  maxWsBufferBytes?: number;
  /** Editor (code-server) config */
  editor: import("@blackbelt-technology/pi-dashboard-shared/config.js").EditorConfig;
  /** Merged trusted networks from config */
  resolvedTrustedNetworks?: string[];
  /** CORS allowed origins from config */
  corsAllowedOrigins?: string[];
}

export interface DashboardServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  sessionManager: SessionManager;
  eventStore: EventStore;
  browserGateway: BrowserGateway;
  /** Resolved HTTP port after start() (useful for port:0 in tests). Returns null if not listening. */
  httpPort(): number | null;
  /** Resolved pi gateway port after start(). Returns null if not listening. */
  piPort(): number | null;
}

export async function createServer(config: ServerConfig): Promise<DashboardServer> {
  // Ensure bridge extension is registered in pi's global settings
  // (needed for bundled installs where pi can't discover it from package.json)
  //
  // __serverDir = <repo>/packages/server/src
  // baseDir MUST be <repo>/ so findBundledExtension resolves
  // <repo>/packages/extension. Three levels up, not two.
  const __serverDir = path.dirname(fileURLToPath(import.meta.url));
  const extPath = findBundledExtension(path.resolve(__serverDir, "..", "..", ".."));
  if (extPath) {
    registerBridgeExtension(extPath);
    console.log(`[dashboard] Bridge extension registered: ${extPath}`);
  } else {
    console.warn(`[dashboard] Bridge extension NOT found (searched from ${__serverDir}). ` +
      `Sessions will spawn but never connect to the gateway. ` +
      `Manually add the extension path to ~/.pi/agent/settings.json packages[] as a workaround.`);
  }

  // Run migration from sessions.json + state.json if needed
  if (needsMigration()) {
    const migResult = runMigration();
    console.log(`[dashboard] Migration complete: ${migResult.sessionsWritten} sessions, ${migResult.hiddenApplied} hidden applied, ${migResult.hiddenOrphaned} orphaned, renamed: ${migResult.oldFilesRenamed.join(", ")}`);
  }

  const preferencesStore = createPreferencesStore();
  const sessionManager = createMemorySessionManager();
  const metaPersistence = createMetaPersistence();
  const sessionOrderManager = createSessionOrderManager(preferencesStore);
  const pendingForkRegistry = createPendingForkRegistry();

  // Restore sessions from per-session .meta.json files (scans ~/.pi/agent/sessions/)
  const scanResult = scanAllSessions();
  for (const session of scanResult.sessions) {
    const restored = { ...session, dataUnavailable: true };
    if (restored.status !== "ended") {
      restored.status = "ended";
      restored.endedAt = restored.endedAt ?? Date.now();
    }
    sessionManager.restore(restored);
  }
  if (scanResult.cacheUpdates > 0) {
    console.log(`[dashboard] Session scan: ${scanResult.sessions.length} sessions, ${scanResult.cacheUpdates} cache updates`);
  }

  // Save per-session .meta.json on any change
  sessionManager.onChange = (sessionId: string) => {
    const session = sessionManager.get(sessionId);
    if (!session?.sessionFile) return;
    metaPersistence.save(session.sessionFile, {
      source: session.source,
      name: session.name,
      attachedProposal: session.attachedProposal,
      hidden: session.hidden,
      cwd: session.cwd,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      tokensIn: session.tokensIn,
      tokensOut: session.tokensOut,
      cacheRead: session.cacheRead,
      cacheWrite: session.cacheWrite,
      cost: session.cost,
      contextTokens: session.contextTokens ?? undefined,
      contextWindow: session.contextWindow,
      firstMessage: session.firstMessage,
      cachedAt: Date.now(),
    });
  };

  // Track cwds with pending dashboard-spawned sessions (for writing .meta.json).
  // Uses a counter per cwd to handle multiple spawns and avoid reconnects consuming entries.
  const pendingDashboardSpawns = new Map<string, number>();
  // Track known session IDs so we can distinguish new sessions from reconnections.
  const knownSessionIds = new Set<string>();
  // Populate from persisted sessions
  for (const s of sessionManager.listAll()) {
    knownSessionIds.add(s.id);
  }

  const directoryService = createDirectoryService(preferencesStore, sessionManager);

  // mDNS peer discovery state
  let mdnsBrowser: DashboardBrowser | null = null;
  const peerServers = new Map<string, DiscoveredServer>();

  const piGateway = createPiGateway(sessionManager, {
    ...(config.pingInterval !== undefined ? { pingInterval: config.pingInterval } : {}),
  });

  // Create event store with pinning callback and configurable limits
  const eventStore = createMemoryEventStore(
    (sessionId) =>
      piGateway.isSessionConnected(sessionId) ||
      browserGateway.getSubscriberCount(sessionId) > 0,
    undefined, // maxCachedSessions (use default)
    config.maxEventsPerSession,
    config.maxStringFieldSize,
  );

  // Create terminal manager with exit callback
  const terminalManager = createTerminalManager({
    onExit: (terminalId) => {
      // Find and remove from session order
      const allOrders = sessionOrderManager.getAllOrders();
      for (const [cwd, ids] of Object.entries(allOrders)) {
        if (ids.includes(terminalId)) {
          sessionOrderManager.remove(cwd, terminalId);
          break;
        }
      }
      browserGateway.broadcastToAll({ type: "terminal_removed", terminalId });
    },
  });

  const terminalGateway = createTerminalGateway(terminalManager);

  // Create editor manager for code-server instances
  const editorDetection = detectCodeServerBinary(config.editor);
  const editorPidRegistry = createEditorPidRegistry();
  const editorManager = createEditorManager({
    config: config.editor,
    detection: editorDetection,
    pidRegistry: editorPidRegistry,
    onStatusChange: (cwd, id, status) => {
      browserGateway.broadcastToAll({ type: "editor_status", cwd, id, status });
    },
  });

  const browserGateway = createBrowserGateway(sessionManager, eventStore, piGateway, undefined, pendingForkRegistry, sessionOrderManager, preferencesStore, directoryService, terminalManager, pendingDashboardSpawns, config.maxWsBufferBytes);

  // Resolve package version once at startup
  const __require = createRequire(import.meta.url);
  let pkgVersion = "unknown";
  try { pkgVersion = __require("../../package.json").version ?? "unknown"; } catch {}
  const selfHostname = os.hostname();

  // Send this server + discovered peers to new browser connections
  browserGateway.onConnect = (ws) => {
    const selfServer: DiscoveredServer = {
      host: selfHostname,
      port: config.port,
      piPort: config.piPort,
      version: pkgVersion,
      pid: process.pid,
      isLocal: true,
      source: "mdns",
    };
    const all = [selfServer, ...Array.from(peerServers.values())];
    browserGateway.sendToClient(ws, { type: "servers_discovered", servers: all });
  };

  // Wire up event forwarding from pi gateway to browser gateway
  wireEvents({
    sessionManager,
    eventStore,
    piGateway,
    browserGateway,
    sessionOrderManager,
    pendingForkRegistry,
    directoryService,
    knownSessionIds,
    pendingDashboardSpawns,
  });

  // Auto-shutdown idle timer
  const idleTimer = createIdleTimer(config, piGateway);

  const fastify = Fastify({
    logger: false,
    keepAliveTimeout: 30_000,
    connectionTimeout: 10_000,
  });

  // Compression: gzip/deflate for HTTP responses. Critical for large client
  // bundles (~3 MB JS) served over tunnels like zrok which abort big transfers.
  // Brotli is intentionally disabled — zrok's free public proxy has been
  // observed to truncate/stream-reset `content-encoding: br` responses under
  // parallel browser load (curl succeeds, Chrome reports ERR_ABORTED 500).
  // gzip is universally supported and round-trips cleanly through zrok.
  // threshold=1024 skips tiny responses; global=true compresses all routes.
  await fastify.register(compress, {
    global: true,
    threshold: 1024,
    encodings: ["gzip", "deflate"],
  });

  // CORS: allow localhost, the active zrok tunnel URL, any *.share.zrok.io
  // host (so tunnel URL rotation doesn't break loads), and configured origins.
  //
  // Two critical correctness notes:
  // (1) Vite emits `<script type="module" crossorigin>` tags, which browsers
  //     always request in CORS mode — even when same-origin. If the server
  //     doesn't emit `Access-Control-Allow-Origin` for the request's own
  //     origin, the browser aborts the script with ERR_ABORTED 500. So when
  //     accessed via a tunnel URL, that URL MUST be in the allow list or all
  //     asset loads fail in the browser (while curl — which sends no Origin
  //     header — works fine). This is the exact failure mode that looked
  //     like a zrok problem for hours of debugging.
  // (2) On origin mismatch, return `cb(null, false)` (no CORS headers) rather
  //     than `cb(new Error(…), false)`. The latter causes @fastify/cors to
  //     surface the error as HTTP 500 on every asset — far worse than
  //     silently omitting CORS headers and letting the browser enforce its
  //     own same-origin policy.
  const corsAllowedOrigins = config.corsAllowedOrigins ?? [];
  await fastify.register(cors, {
    origin: (origin, cb) => {
      // Same-origin navigation (no Origin header) — always allow.
      if (!origin) return cb(null, true);
      try {
        const u = new URL(origin);
        const host = u.hostname;
        // Loopback — any port.
        if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
          return cb(null, true);
        }
        // Active zrok tunnel URL — checked dynamically so URL rotation is
        // picked up without a server restart.
        const tunnelUrl = getTunnelUrl();
        if (tunnelUrl && origin === tunnelUrl) return cb(null, true);
        // Any *.share.zrok.io host — covers the brief window between a new
        // reservation being created and the in-memory `activeTunnelUrl`
        // being populated, plus any other zrok share the user points at us.
        if (host.endsWith(".share.zrok.io")) return cb(null, true);
      } catch { /* ignore URL parse errors */ }
      // Explicitly configured origins.
      if (corsAllowedOrigins.includes(origin)) return cb(null, true);
      // Unknown cross-origin request — don't emit CORS headers, but don't
      // 500 either. Browser will block the request for us.
      cb(null, false);
    },
    credentials: true,
  });

  // Register auth plugin if configured (must be before routes)
  if (config.authConfig) {
    await registerAuthPlugin(fastify, {
      authConfig: config.authConfig,
      port: config.port,
      resolvedTrustedNetworks: config.resolvedTrustedNetworks,
    });
  } else {
    // Auth disabled — register isAuthenticated decorator so guard can always read it
    fastify.decorateRequest("isAuthenticated", false);
    // Still expose /auth/status so clients can detect this
    fastify.get("/auth/status", async () => ({ authenticated: true, authEnabled: false }));
  }

  // Session control REST API (wraps WebSocket-only operations)
  registerSessionApi(fastify, {
    sessionManager,
    piGateway,
    browserGateway,
    pendingForkRegistry,
    pendingDashboardSpawns,
  });

  // Register route modules
  // Create network guard from merged trusted networks
  const networkGuard = createNetworkGuard(config.resolvedTrustedNetworks ?? []);

  registerSessionRoutes(fastify, { sessionManager, eventStore, networkGuard });
  registerGitRoutes(fastify, { networkGuard });
  registerFileRoutes(fastify, { sessionManager, preferencesStore, networkGuard });
  registerOpenSpecRoutes(fastify, {
    sessionManager,
    preferencesStore,
    directoryService,
    networkGuard,
    onOpenSpecChanged: (cwd) => {
      const data = directoryService.getOpenSpecData(cwd);
      if (data) browserGateway.broadcastToAll({ type: "openspec_update", cwd, data });
    },
  });
  registerSystemRoutes(fastify, { sessionManager, preferencesStore, metaPersistence, config, networkGuard, version: pkgVersion });
  registerToolRoutes(fastify, { registry: getDefaultRegistry(), networkGuard });
  // Package management
  const packageManagerWrapper = new PackageManagerWrapper();

  // Forward progress events to all browser clients
  packageManagerWrapper.setProgressListener((operationId, event) => {
    browserGateway.broadcastToAll({ type: "package_progress", operationId, event } as any);
  });

  // On completion: broadcast to browsers + invalidate the recommended cache
  packageManagerWrapper.setCompleteListener((result) => {
    browserGateway.broadcastToAll({
      type: "package_operation_complete",
      operationId: result.operationId,
      action: result.action,
      source: result.source,
      scope: result.scope,
      success: result.success,
      error: result.error,
      diagnostics: result.diagnostics,
      sessionsReloaded: (result as any).sessionsReloaded,
    } as any);
    if (result.success) invalidateRecommendedCache();
  });

  // Reload all active sessions after a successful package operation
  packageManagerWrapper.setReloadSessions(async () => {
    const connectedIds = piGateway.getConnectedSessionIds();
    let count = 0;
    for (const sid of connectedIds) {
      const session = sessionManager.get(sid);
      if (session && session.status !== "ended") {
        piGateway.sendToSession(sid, {
          type: "send_prompt",
          sessionId: sid,
          text: "/reload",
        });
        count++;
      }
    }
    return count;
  });

  registerPackageRoutes(fastify, { packageManagerWrapper });
  registerRecommendedRoutes(fastify, { packageManagerWrapper });

  // Pi core version check + update (complements the extension package manager).
  const piCoreChecker = new PiCoreChecker();
  const piCoreUpdater = new PiCoreUpdater({
    packageManagerWrapper,
    onAllComplete: async () => {
      const connectedIds = piGateway.getConnectedSessionIds();
      let count = 0;
      for (const sid of connectedIds) {
        const session = sessionManager.get(sid);
        if (session && session.status !== "ended") {
          piGateway.sendToSession(sid, {
            type: "send_prompt",
            sessionId: sid,
            text: "/reload",
          });
          count++;
        }
      }
      return count;
    },
  });
  piCoreUpdater.setProgressListener((event) => {
    browserGateway.broadcastToAll({
      type: "pi_core_update_progress",
      name: event.name,
      phase: event.phase,
      message: event.message,
    });
  });
  registerPiCoreRoutes(fastify, {
    piCoreChecker,
    piCoreUpdater,
    onUpdateComplete: (payload) => {
      browserGateway.broadcastToAll({
        type: "pi_core_update_complete",
        results: payload.results,
        sessionsReloaded: payload.sessionsReloaded,
      });
    },
  });

  // Warm pi-coding-agent module import + DefaultPackageManager instances
  // on startup so the first user request to /api/packages/* doesn't pay
  // the 3-5s cold-load cost. Runs in background; errors are swallowed
  // (user-visible flow surfaces any real problem with the full diagnostic
  // trail via the OperationResult.diagnostics field).
  // See change: consolidate-tool-resolution.
  void Promise.allSettled([
    packageManagerWrapper.listInstalled("global"),
    packageManagerWrapper.listInstalled("local"),
  ]);

  // Editor (code-server) routes and proxy.
  // NOTE: routes are *registered* here but cannot dispatch until fastify.listen runs
  // inside server.start(). The orphan sweep in editorPidRegistry.cleanupOrphans()
  // runs at the top of server.start() BEFORE fastify.listen, so any
  // POST /api/editor/start call is guaranteed to see a post-sweep clean state.
  registerEditorRoutes(fastify, editorManager, { networkGuard });
  registerEditorProxy(fastify, editorManager);

  registerProviderAuthRoutes(fastify, { piGateway, browserGateway });
  registerKnownServersRoutes(fastify, { networkGuard, getPeerServers: () => peerServers });
  registerProviderRoutes(fastify, { networkGuard, piGateway, browserGateway });

  // Serve static files / SPA fallback.
  //
  // Resolution strategies, in order:
  //  1. Node module resolver — works in ANY install layout
  //     (flat `node_modules/`, scoped, nested, pnpm, whatever).
  //  2. Sibling-to-server in the installed @scope layout.
  //  3. Monorepo workspace sibling.
  //  4. Legacy dist/client.
  //
  // Same class of bug as commits 40a1319 (bridge auto-registration)
  // and e11f5eb (server-launcher.ts resolve): sibling-path arithmetic
  // that works in the dev repo silently returns wrong paths in the
  // installed node_modules layout. require.resolve identifies packages
  // by name, which is the only canonical identity across layouts.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const clientSearchPaths: string[] = [];
  try {
    const webPkgJson = createRequire(import.meta.url).resolve("@blackbelt-technology/pi-dashboard-web/package.json");
    clientSearchPaths.push(path.join(path.dirname(webPkgJson), "dist"));
  } catch {
    // Web package not resolvable — fall through to path-based search.
  }
  clientSearchPaths.push(
    // Installed as scoped sibling of server
    path.join(__dirname, "..", "..", "pi-dashboard-web", "dist"),
    // Installed in a parent node_modules (hoisted)
    path.join(__dirname, "..", "..", "..", "@blackbelt-technology", "pi-dashboard-web", "dist"),
    // Monorepo workspace sibling
    path.join(__dirname, "../../client/dist"),
    // Legacy path
    path.join(__dirname, "../../dist/client"),
  );
  const clientDir = clientSearchPaths.find(p => existsSync(path.join(p, "index.html"))) ?? "";
  const hasProductionBuild = !!clientDir;
  if (!hasProductionBuild) {
    console.log("[dashboard] No client build found — running in API-only mode");
  }

  // Register static file serving for production build.
  // Always enabled — in dev mode, Vite handles most requests via the
  // not-found proxy, but asset files (JS/CSS with hashed names) must be
  // served directly when Vite is not running (production fallback).
  if (hasProductionBuild) {
    await fastify.register(fastifyStatic, {
      root: clientDir,
      prefix: "/",
      // Serve pre-compressed sibling files (assets/foo.js.gz alongside foo.js)
      // directly when the client accepts gzip. This gives every compressed
      // response a stable Content-Length header — dynamic compression via
      // @fastify/compress streams responses without Content-Length, which
      // some HTTP/2 proxy chains (notably zrok free-tier) occasionally
      // stream-reset as ERR_ABORTED 500 in browsers.
      preCompressed: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
      },
    });
  }

  if (config.dev) {
    // Dev mode: proxy to Vite dev server, fall back to production build
    const VITE_PORTS = [3000, 5173, 5174];
    let vitePort = 0;

    async function detectVitePort(): Promise<number> {
      for (const port of VITE_PORTS) {
        try {
          const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(500) });
          if (res.ok) return port;
        } catch { /* not listening */ }
      }
      return 0;
    }

    vitePort = await detectVitePort();

    fastify.setNotFoundHandler(async (request, reply) => {
      // Try Vite proxy first
      if (!vitePort) vitePort = await detectVitePort();
      if (vitePort) {
        try {
          const viteUrl = `http://localhost:${vitePort}${request.url}`;
          const res = await fetch(viteUrl);
          const contentType = res.headers.get("content-type");
          if (contentType) reply.header("Content-Type", contentType);
          reply.code(res.status);
          return reply.send(Buffer.from(await res.arrayBuffer()));
        } catch {
          vitePort = 0; // Vite stopped — re-probe next time
        }
      }
      // Fallback: serve production build if available
      if (hasProductionBuild) {
        reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "API-only mode: no client build available. Install @blackbelt-technology/pi-dashboard-web or run npm run build." });
    });
  } else if (hasProductionBuild) {
    // Production mode: SPA fallback
    fastify.setNotFoundHandler(async (_request, reply) => {
      reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
      return reply.sendFile("index.html");
    });
  } else {
    fastify.setNotFoundHandler(async (_request, reply) => {
      return reply.code(500).send({ error: "No client build found. Run `npm run build` first." });
    });
  }

  const server: DashboardServer = {
    sessionManager,
    eventStore,
    browserGateway,

    httpPort() {
      const addr = fastify.server.address();
      if (addr && typeof addr === "object") return addr.port;
      return null;
    },
    piPort() {
      return piGateway.address();
    },

    async start() {
      // Clean up orphan headless processes from a previous server instance
      browserGateway.headlessPidRegistry.cleanupOrphans();

      // Clean up orphan code-server processes from a previous server instance.
      // Runs before fastify.listen, so no editor start request can race with the sweep.
      await editorPidRegistry.cleanupOrphans();

      piGateway.start(config.piPort);

      fastify.server.on("upgrade", (request, socket, head) => {
        // Access check for WebSocket upgrades
        const remoteAddress = request.socket.remoteAddress || "";
        const trusted = config.resolvedTrustedNetworks ?? [];
        if (config.authConfig?.secret) {
          if (!validateWsUpgrade(request.headers.cookie, remoteAddress, config.authConfig.secret, trusted)) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }
        } else if (!isLoopback(remoteAddress) && (trusted.length === 0 || !isBypassedHost(remoteAddress, trusted))) {
          // No auth configured — only allow loopback or trusted networks
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }

        if (request.url === "/ws") {
          browserGateway.wss.handleUpgrade(request, socket, head, (ws) => {
            browserGateway.wss.emit("connection", ws, request);
          });
        } else if (request.url?.startsWith("/ws/terminal/")) {
          terminalGateway.handleUpgrade(request, socket, head);
        } else if (request.url?.startsWith("/editor/")) {
          handleEditorUpgrade(editorManager, request, socket, head);
        } else {
          socket.destroy();
        }
      });

      await fastify.listen({ port: config.port, host: "0.0.0.0" });
      writePid(process.pid);
      console.log(`Dashboard server running at http://localhost:${config.port}`);
      console.log(`Pi gateway listening on port ${config.piPort}`);

      // Advertise via mDNS
      try {
        advertiseDashboard(config.port, config.piPort);
        console.log(`mDNS: advertising _pi-dashboard._tcp on port ${config.port}`);
      } catch (err) {
        console.warn(`mDNS advertisement failed (will continue without):`, err);
      }

      // Start continuous mDNS browser for peer discovery
      try {
        mdnsBrowser = createBrowser();
        mdnsBrowser.on("server-up", (server: DiscoveredServer) => {
          // Don't include ourselves
          if (server.isLocal && server.port === config.port) return;
          peerServers.set(`${server.host}:${server.port}`, server);
          browserGateway.broadcast({ type: "servers_updated", servers: Array.from(peerServers.values()) });
        });
        mdnsBrowser.on("server-down", (server: DiscoveredServer) => {
          peerServers.delete(`${server.host}:${server.port}`);
          browserGateway.broadcast({ type: "servers_updated", servers: Array.from(peerServers.values()) });
        });
      } catch (err) {
        console.warn(`mDNS browser failed (peer discovery disabled):`, err);
      }

      // Always sweep leftover zrok processes on startup, even when tunnel is
      // disabled (--no-tunnel). Orphans from a previous run hold reservations
      // on the zrok edge and keep old URLs "alive but broken" until their
      // agents are killed. Scavenge runs unconditionally when the binary is
      // present; the tunnel-creation branch below is gated separately.
      const hasZrok = detectZrokBinary();
      if (hasZrok) {
        cleanupStaleZrok();
        scavengeOrphanZrokProcesses(config.port);
      }

      if (config.tunnel) {
        if (hasZrok) {
          const tunnelUrl = await createTunnel(config.port, config.tunnelReservedToken);
          if (tunnelUrl) {
            console.log(`🌐 Tunnel: ${tunnelUrl}`);
          }
        }
      }

      // Discover sessions and start OpenSpec polling (async, non-blocking)
      discoverAndBroadcastSessions({ sessionManager, browserGateway, directoryService });

      idleTimer.start();
    },

    async stop() {
      // Stop mDNS before closing
      try {
        if (mdnsBrowser) { mdnsBrowser.stop(); mdnsBrowser = null; }
        stopAdvertising();
      } catch { /* ignore mDNS cleanup errors */ }
      removePid();
      idleTimer.cancel();
      directoryService.stopPolling();
      browserGateway.shutdownHeadlessProcesses();
      metaPersistence.flushAll();
      metaPersistence.dispose();
      pendingForkRegistry.dispose();
      preferencesStore.flush();
      preferencesStore.dispose();

      await deleteTunnel(config.port);
      piGateway.stop();
      for (const client of browserGateway.wss.clients) {
        client.terminate();
      }
      browserGateway.wss.close();
      terminalGateway.close();
      // Kill all active terminal PTY processes
      for (const t of terminalManager.list()) {
        try { terminalManager.kill(t.id); } catch {}
      }
      // Stop all code-server instances
      editorManager.stopAll();
      // Close any pending OAuth callback servers
      try { const { closeAllCallbackServers } = await import("./oauth-callback-server.js"); await closeAllCallbackServers(); } catch {}
      await fastify.close();
    },
  };

  idleTimer.setStopFn(server.stop.bind(server));
  return server;
}
