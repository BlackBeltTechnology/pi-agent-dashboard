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
import { pluginIntentCache } from "./plugin-intent-cache.js";
import { createPreferencesStore, type PreferencesStore } from "./preferences-store.js";
import { createMetaPersistence, type MetaPersistence } from "./meta-persistence.js";
import { createSessionOrderManager, type SessionOrderManager } from "./session-order-manager.js";
import { createPendingForkRegistry, type PendingForkRegistry } from "./pending-fork-registry.js";
import { createPendingClientCorrelations } from "./pending-client-correlations.js";
import { createWorktreeBootstrapRegistry } from "./worktree-bootstrap-registry.js";
import { createPendingAttachRegistry } from "./pending-attach-registry.js";
import { createPendingWorktreeBaseRegistry } from "./pending-worktree-base-registry.js";
import { createPendingResumeIntentRegistry } from "./pending-resume-intent-registry.js";
import { applyReattachPolicy } from "./reattach-placement.js";

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
import { startTunnelWatchdog, stopTunnelWatchdog } from "./tunnel-watchdog.js";
import { registerAuthPlugin, validateWsUpgrade } from "./auth-plugin.js";
import { findBundledExtension, registerBridgeExtension } from "@blackbelt-technology/pi-dashboard-shared/bridge-register.js";
import { createNetworkGuard, isLoopback, isBypassedHost } from "./localhost-guard.js";
import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { loadConfig, CONFIG_FILE } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { registerSessionApi } from "./session-api.js";
import { registerManifestRoute } from "./routes/manifest-route.js";
import { registerSessionRoutes } from "./routes/session-routes.js";
import { registerGitRoutes } from "./routes/git-routes.js";
import { registerFileRoutes } from "./routes/file-routes.js";
import { registerOpenSpecRoutes } from "./routes/openspec-routes.js";
import { registerOpenSpecGroupRoutes } from "./routes/openspec-group-routes.js";
import { createOpenSpecGroupStore, joinGroupIdsToOpenSpecData } from "./openspec-group-store.js";
import { registerSystemRoutes } from "./routes/system-routes.js";
import { registerDoctorRoutes } from "./routes/doctor-routes.js";
import { registerProviderAuthRoutes } from "./routes/provider-auth-routes.js";
import { registerPackageRoutes } from "./routes/package-routes.js";
import { registerRecommendedRoutes, invalidateRecommendedCache } from "./routes/recommended-routes.js";
import { registerPiCoreRoutes } from "./routes/pi-core-routes.js";
import { registerPiChangelogRoutes } from "./routes/pi-changelog-routes.js";
import { PiCoreChecker } from "./pi-core-checker.js";
import { PiCoreUpdater } from "./pi-core-updater.js";
import { registerToolRoutes } from "./routes/tool-routes.js";
import { registerJjRoutes } from "./routes/jj-routes.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { registerProviderRoutes } from "./routes/provider-routes.js";
import { PackageManagerWrapper } from "./package-manager-wrapper.js";
import { createEditorManager, type EditorManager } from "./editor-manager.js";
import { createEditorPidRegistry } from "./editor-pid-registry.js";
import { registerEditorRoutes } from "./routes/editor-routes.js";
import { registerKnownServersRoutes } from "./routes/known-servers-routes.js";
import { registerPluginConfigRoutes } from "./routes/plugin-config-routes.js";
import { registerPreferencesDisplayRoutes } from "./routes/preferences-display-routes.js";
import { registerPluginActivationRoutes } from "./routes/plugin-activation-routes.js";
import { createModelProxyAuthGate } from "./model-proxy/auth-gate.js";
import { registerModelProxyRoutes } from "./routes/model-proxy-routes.js";
import { registerModelProxyApiKeyRoutes } from "./routes/model-proxy-api-key-routes.js";
import { registerModelProxyRefreshRoutes } from "./routes/model-proxy-refresh-routes.js";
import { getModelRegistry, getStreamSimpleFn } from "./model-proxy/registry-singleton.js";
import { writeConfigPartial } from "./config-api.js";
import { loadServerEntries, discoverPlugins, getPluginStatusStore, refreshRequirementProbesFor } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { createServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { getPluginConfig as getPluginConfigFromFile } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import {
  registerAllPluginBridges,
  reconcilePluginBridgePackages,
} from "@blackbelt-technology/pi-dashboard-shared/plugin-bridge-register.js";
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
  tunnelWatchdog?: {
    enabled: boolean;
    intervalMs: number;
    failureThreshold: number;
    probeTimeoutMs: number;
  };
  authConfig?: AuthConfig;
  /** Override WS ping interval for pi-gateway (ms). Default 60000. Set 0 to disable. */
  pingInterval?: number;
  /** Memory limit overrides from config */
  maxEventsPerSession?: number;
  maxStringFieldSize?: number;
  maxWsBufferBytes?: number;
  /** Editor (code-server) config */
  editor: import("@blackbelt-technology/pi-dashboard-shared/config.js").EditorConfig;
  /** OpenSpec polling config (interval, concurrency, change detection, jitter) */
  openspec?: import("@blackbelt-technology/pi-dashboard-shared/config.js").OpenSpecPollConfig;
  /** Reattach-placement policy applied when a bridge re-registers after
   *  a dashboard restart. Defaults to `"always"`.
   *  See change: reattach-move-to-front. */
  reattachPlacement?: import("@blackbelt-technology/pi-dashboard-shared/config.js").ReattachPlacement;
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
  /**
   * Legacy cwd-FIFO counter map for in-process tests that need to
   * exercise the source-stamp fallback path without spinning a real
   * spawn. Not part of the public API — do not depend on this from
   * production code.
   * See change: fix-dashboard-spawn-correlation-by-token.
   */
  pendingDashboardSpawns: Map<string, number>;
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
  // Maps spawnToken → originating browser requestId. Surfaced as
  // session_added.spawnRequestId so the client can auto-select / dismiss
  // its placeholder by exact correlation. See change: spawn-correlation-token.
  const pendingClientCorrelations = createPendingClientCorrelations();

  // Worktree-bootstrap progress registry: maps requestId -> originating ws
  // so `worktree_bootstrap_*` events stream only to the dialog that
  // initiated the install. See change: harden-worktree-spawn.
  const worktreeBootstrapRegistry = createWorktreeBootstrapRegistry();

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
  sessionManager.onChange = (sessionId: string, ctx) => {
    const session = sessionManager.get(sessionId);
    if (!session?.sessionFile) return;
    metaPersistence.save(session.sessionFile, {
      source: session.source,
      name: session.name,
      attachedProposal: session.attachedProposal,
      displayPrefsOverride: session.displayPrefsOverride,
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
      // Persist unread bit so it survives server restart.
      // See change: session-card-unread-stripes.
      unread: session.unread,
      // Persist the worktree base ref so the WORKSPACE-subcard pill can
      // render `created from <base>` after restart. The field is only set
      // when a session was spawned via the dashboard's worktree dialog.
      // See change: add-worktree-spawn-dialog.
      gitWorktreeBase: session.gitWorktreeBase,
      cachedAt: Date.now(),
    });
    // When a session ends, drop its id from the persisted drag-reorder list
    // for that cwd. Drag-reorder is meaningful for live sessions only; ended
    // ones must fall to the bottom in their natural endedAt order (rendered
    // top-of-bucket on most-recent-first) rather than retaining a position
    // that interleaves them with active sessions.
    // See change: pin-and-search-sessions, top-of-tier-on-status-change.
    // Status-transition tracking: prune+broadcast runs ONCE per
    // transition to ended. Subsequent `update()` calls on an already-
    // ended session (e.g. heartbeat tail, click-induced state sync,
    // late events from the bridge) do NOT re-trigger the prune —
    // otherwise the card visibly jumps to the tail of the ended group
    // every time the user interacts with it.
    // See change: pin-and-search-sessions.
    const wasEnded = endedSessionIds.has(sessionId);
    const isEnded = session.status === "ended";
    if (isEnded && !wasEnded) {
      // Just transitioned alive→ended.
      endedSessionIds.add(sessionId);
      const orderBefore = sessionOrderManager.getOrder(session.cwd) ?? [];
      sessionOrderManager.remove(session.cwd, sessionId);
      const orderAfter = sessionOrderManager.getOrder(session.cwd) ?? [];
      if (orderBefore.length !== orderAfter.length) {
        browserGateway.broadcastToAll({
          type: "sessions_reordered",
          cwd: session.cwd,
          sessionIds: orderAfter,
        });
      }
    } else if (!isEnded && wasEnded) {
      // Resume: ended→alive. Three real outcomes land here, distinguished
      // by the value `pendingResumeIntents.consume(...)` returns:
      //   "front"  — Resume button, REST resume, prompt-auto-resume.
      //              User wants the card surfaced at the top of alive.
      //   "keep"   — Drag-to-resume. The dropped slot was already
      //              persisted via `reorder_sessions`; do NOT clobber it.
      //   null     — Bridge auto-reattach (dashboard restarted, pi
      //              process still alive, no user intent tagged).
      //              Preserve the user's existing layout.
      // We always clear the transition tracker so a future alive→ended
      // for this session fires correctly.
      // See changes: preserve-session-order-on-reboot,
      //              top-of-tier-on-status-change,
      //              differentiate-resume-intent-by-trigger.
      endedSessionIds.delete(sessionId);
      const intent = pendingResumeIntents.consume(sessionId);
      if (intent === null) {
        // No user-driven resume intent. If this register carried
        // `registerReason: "reattach"`, apply the configured
        // `reattachPlacement` policy. Otherwise (legacy bridge or
        // genuine null reattach with `"preserve"` semantics) leave
        // order alone.
        // See change: reattach-move-to-front.
        if (ctx?.registerReason === "reattach") {
          applyReattachPolicy(
            sessionId,
            session.cwd,
            config.reattachPlacement ?? "always",
            { sessionManager, sessionOrderManager, browserGateway },
            ctx.priorStatus,
          );
        }
        return;
      }
      if (intent === "keep") {
        // Drag-to-resume — dropped slot wins; the earlier reorder_sessions
        // already broadcast. Do NOT mutate sessionOrder, do NOT broadcast.
        // Registry intent overrides any `registerReason: "reattach"`.
        return;
      }
      // intent === "front": move-to-front so the just-resumed card
      // surfaces at the top of the alive tier, even on repeated end →
      // resume cycles where the id might still be in the order.
      // Registry intent overrides any `registerReason: "reattach"`.
      sessionOrderManager.moveToFront(session.cwd, sessionId);
      const next = sessionOrderManager.getOrder(session.cwd) ?? [];
      browserGateway.broadcastToAll({
        type: "sessions_reordered",
        cwd: session.cwd,
        sessionIds: next,
      });
    } else if (!isEnded && !wasEnded && ctx?.registerReason === "reattach") {
      // Reattach of a session that was persisted as alive (the common
      // case after `pi-dashboard restart` while pi processes stay
      // alive). Neither alive→ended nor ended→alive transition fires;
      // we apply the reattach policy directly here.
      //
      // Defensive: a registry intent for an alive session should not
      // happen in practice (handleResumeSession only tags intents for
      // ended sessions), but per spec scenario "Registry intent wins
      // over reattach" we honor it if present and skip the policy.
      // See change: reattach-move-to-front.
      const intent = pendingResumeIntents.consume(sessionId);
      if (intent === "front") {
        sessionOrderManager.moveToFront(session.cwd, sessionId);
        const next = sessionOrderManager.getOrder(session.cwd) ?? [];
        browserGateway.broadcastToAll({
          type: "sessions_reordered",
          cwd: session.cwd,
          sessionIds: next,
        });
      } else if (intent === "keep") {
        // Honor dropped slot; do nothing.
      } else {
        applyReattachPolicy(
          sessionId,
          session.cwd,
          config.reattachPlacement ?? "always",
          { sessionManager, sessionOrderManager, browserGateway },
          ctx.priorStatus,
        );
      }
    }
  };
  // Track which session ids we've seen as ended at least once, so the
  // onChange hook can detect actual alive→ended transitions vs. mere
  // re-emits of the ended state.
  const endedSessionIds = new Set<string>(
    sessionManager.listAll().filter((s) => s.status === "ended").map((s) => s.id),
  );

  // Startup reconciliation: persisted `sessionOrder` may contain ended
  // session ids from before the alive→ended prune was implemented. Strip
  // them now so the next render sees a consistent state where ended ids
  // never appear in the order pass.
  // See change: pin-and-search-sessions.
  for (const [cwd, ids] of Object.entries(sessionOrderManager.getAllOrders())) {
    const aliveIds = ids.filter((id) => {
      const s = sessionManager.get(id);
      // Keep ids we don't know about — they may belong to other cwds or
      // be live but not yet registered. Strip only the ones explicitly
      // marked ended.
      return !s || s.status !== "ended";
    });
    if (aliveIds.length !== ids.length) {
      sessionOrderManager.reorder(cwd, aliveIds);
    }
  }

  // Track cwds with pending dashboard-spawned sessions (for writing .meta.json).
  // Uses a counter per cwd to handle multiple spawns and avoid reconnects consuming entries.
  const pendingDashboardSpawns = new Map<string, number>();

  // Pending spawn-with-attach intents (cwd → FIFO queue of changeNames).
  // Consumed in event-wiring.ts on session_register. See change:
  // add-folder-task-checker-and-spawn-attach.
  const pendingAttachRegistry = createPendingAttachRegistry();
  // Pending worktree-base intents (cwd → base). Populated by the
  // worktree spawn dialog flow, consumed by event-wiring's session_register
  // hook to write .meta.json#gitWorktreeBase.
  // See change: add-worktree-spawn-dialog.
  const pendingWorktreeBaseRegistry = createPendingWorktreeBaseRegistry();
  // Pending user-initiated resume intents (sessionId → timestamp).
  // Consumed by `sessionManager.onChange` in the ended→alive branch to
  // gate the sessionOrder mutation behind explicit user intent so that
  // bridge auto-reattach on dashboard reboot does not mutate the user's
  // drag-order.
  // See change: preserve-session-order-on-reboot.
  const pendingResumeIntents = createPendingResumeIntentRegistry();
  // Track known session IDs so we can distinguish new sessions from reconnections.
  const knownSessionIds = new Set<string>();
  // Populate from persisted sessions
  for (const s of sessionManager.listAll()) {
    knownSessionIds.add(s.id);
  }

  // Create the OpenSpec change-grouping store BEFORE the directory-service so
  // the latter can join `groupId` into every `OpenSpecChange` it produces.
  // See change: add-openspec-change-grouping (task 4.2).
  const openspecGroupStore = createOpenSpecGroupStore();

  const directoryService = createDirectoryService(
    preferencesStore,
    sessionManager,
    config.openspec,
    {
      enrichOpenSpecData: async (cwd, data) => {
        try {
          const file = await openspecGroupStore.read(cwd);
          return joinGroupIdsToOpenSpecData(data, file.assignments);
        } catch {
          // Bad file (e.g., unsupported schemaVersion) — fall back to unjoined.
          return data;
        }
      },
    },
  );

  // mDNS peer discovery state
  let mdnsBrowser: DashboardBrowser | null = null;
  // Optional second-port Fastify instance for model proxy (/v1/*)
  let secondFastify: Awaited<ReturnType<typeof import("fastify").default>> | null = null;
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
  const editorManager = createEditorManager({
    config: config.editor,
    detection: editorDetection,
    onStatusChange: (cwd, id, status) => {
      browserGateway.broadcastToAll({ type: "editor_status", cwd, id, status });
    },
  });
  const editorPidRegistry = createEditorPidRegistry({ editorManager });

  const browserGateway = createBrowserGateway(sessionManager, eventStore, piGateway, undefined, pendingForkRegistry, sessionOrderManager, preferencesStore, directoryService, terminalManager, pendingDashboardSpawns, config.maxWsBufferBytes, pendingAttachRegistry, pendingResumeIntents, pendingClientCorrelations, pendingWorktreeBaseRegistry, metaPersistence);

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
    pendingAttachRegistry,
    pendingWorktreeBaseRegistry,
    viewedSessionTracker: browserGateway.viewedSessionTracker,
    pendingClientCorrelations,
  });

  // Auto-shutdown idle timer
  // Active terminals keep the server alive even when no pi sessions are
  // attached. See change: fix-terminal-half-height-dual-mount.
  const idleTimer = createIdleTimer(config, piGateway, () => terminalManager.list().length > 0);

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
    pendingResumeIntents,
    pendingAttachRegistry,
  });

  // Register route modules
  // Create network guard from merged trusted networks
  const networkGuard = createNetworkGuard(config.resolvedTrustedNetworks ?? []);

  registerSessionRoutes(fastify, { sessionManager, eventStore, networkGuard });
  registerGitRoutes(fastify, { networkGuard, sessionManager, browserGateway, worktreeBootstrapRegistry });

  // Browser channel for worktree-bootstrap event subscriptions. The
  // dialog sends `worktree_bootstrap_subscribe { requestId }` over its
  // existing ws BEFORE issuing POST /api/git/worktree so the server
  // knows which ws to stream progress to. See change: harden-worktree-spawn.
  browserGateway.registerHandler("worktree_bootstrap_subscribe", (msg, ws) => {
    const requestId = typeof msg?.requestId === "string" ? msg.requestId : undefined;
    if (requestId) worktreeBootstrapRegistry.subscribe(requestId, ws);
  });
  browserGateway.registerHandler("worktree_bootstrap_unsubscribe", (msg) => {
    const requestId = typeof msg?.requestId === "string" ? msg.requestId : undefined;
    if (requestId) worktreeBootstrapRegistry.unsubscribe(requestId);
  });
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
  // OpenSpec change-grouping routes (store created earlier next to
  // directory-service so the join can run during polls).
  // See change: add-openspec-change-grouping.
  openspecGroupStore.subscribe((cwd, payload) => {
    browserGateway.broadcastToAll({
      type: "openspec_groups_update",
      cwd,
      groups: payload.groups,
      assignments: payload.assignments,
    });
    // Refresh OpenSpecData so the joined `groupId` field reflects the new
    // assignments on subscribers that don't consume `openspec_groups_update`
    // directly. Fire-and-forget; failures are logged inside refreshOpenSpec.
    directoryService.refreshOpenSpec(cwd).then((data) => {
      browserGateway.broadcastToAll({ type: "openspec_update", cwd, data });
    }).catch(() => {});
  });
  registerOpenSpecGroupRoutes(fastify, {
    sessionManager,
    preferencesStore,
    networkGuard,
    store: openspecGroupStore,
  });
  registerSystemRoutes(fastify, { sessionManager, preferencesStore, metaPersistence, config, networkGuard, version: pkgVersion, directoryService, piGateway });
  // GET /api/doctor — see change: doctor-rich-output (task 4.2). Auth-gated identically to /api/config.
  registerDoctorRoutes(fastify);
  registerToolRoutes(fastify, { registry: getDefaultRegistry(), networkGuard });
  registerJjRoutes(fastify, { browserGateway, pendingAttachRegistry, networkGuard });

  // /api/bootstrap/* routes removed under change:
  // eliminate-electron-runtime-install (task 3.4). pi-core in-place
  // updates flow through /api/pi-core/update for standalone + bridge
  // arms; Electron arm uses electron-updater whole-app replacement.
  // Package management
  const packageManagerWrapper = new PackageManagerWrapper();

  // Forward progress events to all browser clients. The third arg
  // (`moveId`) is set when the event is part of a composite move op;
  // clients group events by moveId. See change: unify-package-management-ui.
  packageManagerWrapper.setProgressListener((operationId, event, moveId) => {
    browserGateway.broadcastToAll({
      type: "package_progress",
      operationId,
      ...(moveId ? { moveId } : {}),
      event,
    } as any);
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
      ...(result.moveId ? { moveId: result.moveId } : {}),
      ...(result.partialSuccess ? { partialSuccess: result.partialSuccess } : {}),
    } as any);
    if (result.success) invalidateRecommendedCache();
    // A successful package operation may have changed plugin requirement
    // satisfaction. Refresh probes and broadcast plugin_config_update for
    // any plugin whose `missingRequirements` flipped.
    // See change: add-plugin-activation-ui.
    if (result.success) {
      void refreshRequirementProbesFor(null, {
        listInstalled: () => packageManagerWrapper.listInstalled("global"),
      }).then((changed) => {
        for (const id of changed) {
          const status = getPluginStatusStore().getStatus(id);
          browserGateway.broadcast({
            type: "plugin_config_update",
            id,
            config: status ?? {},
          });
        }
      });
    }
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
  registerPiChangelogRoutes(fastify, {});

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
  registerPluginConfigRoutes(fastify, {
    networkGuard,
    broadcast: (msg) => browserGateway.broadcast(msg),
  });
  // Global chat-display preferences (configurable-chat-display).
  registerPreferencesDisplayRoutes(fastify, {
    preferencesStore,
    networkGuard,
    broadcast: (msg) => browserGateway.broadcastToAll(msg),
  });
  registerPluginActivationRoutes(fastify, {
    networkGuard,
    broadcast: (msg) => browserGateway.broadcast(msg),
  });
  registerProviderRoutes(fastify, { networkGuard, piGateway, browserGateway, port: config.port });

  // ── Model Proxy ───────────────────────────────────────────────────
  {
    const fullCfg = loadConfig();
    if (fullCfg.modelProxy.enabled) {
      // Register proxy auth gate (runs BEFORE JWT hook for /v1/* routes)
      const proxyAuthGate = createModelProxyAuthGate({
        getConfig: () => loadConfig().modelProxy,
        persistKeyUsage: (apiKeys) => {
          writeConfigPartial({ modelProxy: { apiKeys } });
        },
      });
      fastify.addHook("onRequest", proxyAuthGate);

      // Register /v1/* routes
      registerModelProxyRoutes(fastify, {
        getConfig: () => loadConfig().modelProxy,
        getRegistry: async () => {
          try {
            return await getModelRegistry();
          } catch {
            return null;
          }
        },
        streamSimple: (opts: any) => {
          const fn = getStreamSimpleFn();
          if (!fn) throw new Error("streamSimple not available");
          return fn(opts.model, { messages: opts.messages, system: opts.system, tools: opts.tools }, opts);
        },
      });

      // Register API key management routes (JWT-gated)
      registerModelProxyApiKeyRoutes(fastify, {
        networkGuard,
        getModelProxyConfig: () => loadConfig().modelProxy,
        writeModelProxyApiKeys: async (apiKeys) => {
          writeConfigPartial({ modelProxy: { apiKeys } });
        },
      });

      // Register refresh route (JWT-gated)
      registerModelProxyRefreshRoutes(fastify);
    }
  }

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
  // Client-dir resolution — single strategy under change:
  // eliminate-electron-runtime-install. The legacy 5-strategy chain
  // (sibling/hoisted/monorepo/legacy paths) defended against runtime
  // re-extraction wiping the bundled tree. Under the immutable bundle
  // architecture that scenario cannot occur; the npm-resolver-anchored
  // path is the only durable identity across install layouts.
  //
  // Dev / monorepo fallbacks are still allowed when require.resolve
  // misses (e.g. running from a checked-out workspace where the web
  // package hasn't been linked yet).
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  let clientDir = "";
  try {
    const webPkgJson = createRequire(import.meta.url).resolve(
      "@blackbelt-technology/pi-dashboard-web/package.json",
    );
    const candidate = path.join(path.dirname(webPkgJson), "dist");
    if (existsSync(path.join(candidate, "index.html"))) clientDir = candidate;
  } catch {
    // Web package not resolvable — try dev-monorepo sibling.
    const devCandidate = path.join(__dirname, "../../client/dist");
    if (existsSync(path.join(devCandidate, "index.html"))) clientDir = devCandidate;
  }
  const hasProductionBuild = !!clientDir;
  if (!hasProductionBuild) {
    console.log("[dashboard] No client build found — running in API-only mode");
  }

  // Dynamic PWA manifest — MUST be registered before fastify-static so
  // explicit route matching wins over the static asset. See change:
  // add-dynamic-pwa-manifest-naming.
  registerManifestRoute(fastify, {
    clientDir,
    // Re-read config per request so Settings panel changes propagate
    // without a server restart. loadConfig() is fs-cheap (<1ms).
    getDashboardName: () => loadConfig().dashboardName,
  });

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
    pendingDashboardSpawns,

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
      await browserGateway.headlessPidRegistry.cleanupOrphans();

      // Wire the singleton KeeperManager into the headless-pid registry so
      // `writeRpc` can forward `dispatch_extension_command` lines to the
      // session's keeper UDS, and so `cleanupKeeperOrphans` can reattach
      // surviving keepers after a server restart. Same instance the spawn
      // path uses. See change: add-rpc-stdin-dispatch-with-keeper-sidecar.
      try {
        const { getKeeperManager } = await import("./process-manager.js");
        browserGateway.headlessPidRegistry.setKeeperWriter(getKeeperManager());
        await browserGateway.headlessPidRegistry.cleanupKeeperOrphans();
      } catch (err) {
        console.warn("[dashboard] keeper-manager wire-up failed (RPC dispatch disabled):", err);
      }

      // Editor lifecycle boot order:
      //   1. Adopt surviving editor keepers (per-editor sidecars) → reattach.
      //   2. Defensive cmdline sweep for pre-keeper installs (no sidecar).
      // See change: add-editor-keeper-sidecar.
      try {
        const summary = await editorPidRegistry.adoptOrphans();
        if (summary.adopted.length > 0) {
          console.log(`[dashboard] adopted ${summary.adopted.length} editor${summary.adopted.length === 1 ? "" : "s"}`);
          for (const a of summary.adopted) {
            console.log(`[dashboard]   editor ${a.editorId} cwd=${a.cwd} port=${a.port}`);
          }
        }
      } catch (err) {
        console.warn("[dashboard] editor adoptOrphans failed:", err);
      }
      await editorPidRegistry.cleanupOrphans();

      piGateway.start(config.piPort);

      // Load plugin server entries BEFORE fastify.listen() so plugins can
      // register routes. Fastify rejects route registration after listen().
      // Failure-isolated per-plugin via loader; awaited so all routes are
      // mounted before requests can arrive.
      try {
        await loadServerEntries({
          isEnabled: (pluginId) => {
            const cfg = loadConfig();
            const pluginCfg = getPluginConfigFromFile(cfg, pluginId) as Record<string, unknown>;
            return pluginCfg.enabled !== false;
          },
          requirementDeps: {
            listInstalled: () => packageManagerWrapper.listInstalled("global"),
          },
          createContext: (plugin) => createServerPluginContext(
            {
              fastify,
              sessionManager: {
                listActive: () => sessionManager.listActive(),
                listAll: () => sessionManager.listAll(),
                getSession: (id: string) => sessionManager.get(id),
              },
              eventStore: {
                getEvents: (sessionId) => eventStore.getEvents(sessionId, 0),
                getLatestEvent: (sessionId) => {
                  const events = eventStore.getEvents(sessionId, 0);
                  return events.length > 0 ? events[events.length - 1] : undefined;
                },
              },
              broadcastToSubscribers: (msg) => {
                // Intercept plugin_intents broadcasts and cache them so
                // reconnecting clients can replay the current intent state.
                // See change: adopt-server-driven-intent-rendering.
                const m = msg as { type?: string; pluginId?: string; sessionId?: string | null; slot?: string; intent?: unknown } | undefined;
                if (m && m.type === "plugin_intents" && typeof m.pluginId === "string" && typeof m.slot === "string") {
                  pluginIntentCache.set(
                    m.pluginId,
                    m.sessionId ?? null,
                    m.slot as Parameters<typeof pluginIntentCache.set>[2],
                    (m.intent ?? null) as Parameters<typeof pluginIntentCache.set>[3],
                  );
                }
                browserGateway.broadcast(msg as any);
              },
              registerPiHandler: (_type, _handler) => {},
              registerBrowserHandler: (type, handler) =>
                browserGateway.registerHandler(type, (msg, ws) =>
                  handler(msg, ws as unknown),
                ),
              getPluginConfig: (id) => {
                const cfg = loadConfig();
                return getPluginConfigFromFile(cfg, id);
              },
              updatePluginConfig: async (id, partial) => {
                const cfg = loadConfig();
                const current = getPluginConfigFromFile(cfg, id);
                const merged = { ...current, ...partial };
                let rawConfig: Record<string, unknown> = {};
                try {
                  const raw = (await import('node:fs')).default.readFileSync(CONFIG_FILE, 'utf-8');
                  rawConfig = JSON.parse(raw);
                } catch { /* start fresh */ }
                rawConfig.plugins = { ...(rawConfig.plugins as Record<string, unknown> ?? {}), [id]: merged };
                const fs = (await import('node:fs')).default;
                const tmpFile = CONFIG_FILE + '.tmp.' + process.pid;
                fs.writeFileSync(tmpFile, JSON.stringify(rawConfig, null, 2) + '\n');
                fs.renameSync(tmpFile, CONFIG_FILE);
                browserGateway.broadcast({ type: 'plugin_config_update', id, config: merged } as any);
              },
            },
            plugin.manifest.id,
          ),
        });
      } catch (err) {
        console.error('[plugin-loader] Unexpected error during pre-listen load:', err);
      }

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

      // ── Optional second port for model proxy (/v1/*) ──────────────
      {
        const proxyCfg = loadConfig().modelProxy;
        if (proxyCfg.enabled && proxyCfg.secondPort) {
          try {
            const F = (await import("fastify")).default;
            const sf = F({ logger: false });
            const proxyAuthGate = createModelProxyAuthGate({
              getConfig: () => loadConfig().modelProxy,
              persistKeyUsage: (apiKeys) => {
                writeConfigPartial({ modelProxy: { apiKeys } });
              },
            });
            sf.addHook("onRequest", proxyAuthGate);
            registerModelProxyRoutes(sf, {
              getConfig: () => loadConfig().modelProxy,
              getRegistry: async () => {
                try { return await getModelRegistry(); } catch { return null; }
              },
              streamSimple: (opts: any) => {
                const fn = getStreamSimpleFn();
                if (!fn) throw new Error("streamSimple not available");
                return fn(opts.model, { messages: opts.messages, system: opts.system, tools: opts.tools }, opts);
              },
            });
            await sf.listen({ port: proxyCfg.secondPort, host: "127.0.0.1" });
            secondFastify = sf as any;
            console.log(`Model proxy second port listening at http://127.0.0.1:${proxyCfg.secondPort}`);
          } catch (err) {
            console.warn(`Model proxy second port bind failed (continuing without):`, err);
          }
        }
      }

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
            // Start the watchdog so a stale zrok edge connection is detected
            // and recycled automatically (preserves reserved token / URL).
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
          }
        }
      }

      // Discover sessions and start OpenSpec polling (async, non-blocking)
      discoverAndBroadcastSessions({ sessionManager, browserGateway, directoryService });

      // Auto-register plugin bridge entries
      const discoveredPlugins = discoverPlugins();
      const pluginsWithBridges = discoveredPlugins
        .filter(p => p.bridgeEntryPath)
        .map(p => ({ pluginId: p.manifest.id, bridgePath: p.bridgeEntryPath! }));
      if (pluginsWithBridges.length) {
        const results = registerAllPluginBridges(pluginsWithBridges);
        for (const [id, result] of Object.entries(results)) {
          if (result.type === 'conflict') {
            const store = getPluginStatusStore();
            const existing = store.getStatus(id);
            store.setStatus({
              id,
              displayName: existing?.displayName ?? id,
              enabled: existing?.enabled ?? true,
              loaded: existing?.loaded ?? false,
              error: `Bridge path conflict: existing=${result.existingPath}, new=${result.newPath}`,
              claims: existing?.claims ?? 0,
            });
          }
        }
      }

      // One-shot reconciliation: heal pre-existing installs where the bridge
      // was registered only in `dashboardPluginBridges` (pi ignores that key).
      // See change: fix-pi-flows-end-to-end (Group 1, task 1.5).
      try {
        const summary = reconcilePluginBridgePackages();
        for (const entry of summary) {
          if (entry.action === "added") {
            console.info(
              `[plugin-bridge] Reconciled packages[] for plugin "${entry.pluginId}": ${entry.bridgePath}`,
            );
          }
        }
      } catch (err) {
        console.warn("[plugin-bridge] Reconciliation failed (non-fatal):", err);
      }

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

      stopTunnelWatchdog();
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
      // Stop all code-server instances (config-gated; default no-op so
      // keepers + tabs survive a dashboard restart).
      try { await editorManager.stopAll(); } catch (err) { console.warn("[dashboard] editorManager.stopAll failed:", err); }
      // Close any pending OAuth callback servers
      try { const { closeAllCallbackServers } = await import("./oauth-callback-server.js"); await closeAllCallbackServers(); } catch {}
      // Close second port before main server
      if (secondFastify) {
        try { await secondFastify.close(); } catch { /* ignore */ }
        secondFastify = null;
      }
      await fastify.close();
    },
  };

  idleTimer.setStopFn(server.stop.bind(server));
  return server;
}
