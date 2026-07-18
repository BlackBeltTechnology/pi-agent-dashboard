/**
 * Dashboard HTTP + WebSocket server.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createServerPluginContext, discoverPlugins, getPluginStatusStore, loadServerEntries, refreshRequirementProbesFor } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { findBundledExtension, registerBridgeExtension } from "@blackbelt-technology/pi-dashboard-shared/bridge-register.js";
import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { CONFIG_FILE, getPluginConfig as getPluginConfigFromFile, loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { advertiseDashboard, createBrowser, type DashboardBrowser, type DiscoveredServer, stopAdvertising } from "@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js";
import { setWindowsGitSourceSetting } from "@blackbelt-technology/pi-dashboard-shared/platform/git-source.js";
import {
  reconcilePluginBridgePackages,
  registerAllPluginBridges,
} from "@blackbelt-technology/pi-dashboard-shared/plugin-bridge-register.js";
import { isRecoveryCandidate, mergeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import compress from "@fastify/compress";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { registerAuthPlugin, validateWsUpgrade } from "./auth/auth-plugin.js";
import { registerBearerAuth } from "./auth/bearer-auth.js";
import { type BrowserGateway, createBrowserGateway } from "./pairing/browser-gateway.js";
import { createCommitDraftRelay } from "./commit-draft-relay.js";
import { writeConfigPartial } from "./config-api.js";
import { isCorsOriginAllowed } from "./auth/cors-origin.js";
import { registerCsp, resolveCspMode } from "./auth/csp.js";
// pending-load-manager removed — server loads sessions directly via DirectoryService
import { createDirectoryService, type DirectoryService } from "./directory-service.js";
import { wireEvents } from "./event-wiring.js";
import { startEventLoopSampler } from "./metrics/eventloop-sampler.js";
import { createEventLoopSpikeMetrics } from "./metrics/eventloop-spike-metrics.js";
import { createFileWatchManager } from "./file-watch-manager.js";
import { decideBudgetHalt } from "./goal/goal-budget-guard.js";
import { buildGoalReprime, primeGoalSession } from "./goal/goal-session-primer.js";
import { createGoalStatusProjector } from "./goal/goal-status-projector.js";
import { createGoalStore } from "./goal/goal-store.js";
import { createGoalSupervisor, type GoalDriverSpawnRequest, type GoalSupervisor } from "./goal/goal-supervisor.js";
import { createGoalVerdictAccumulator } from "./goal/goal-verdict-accumulator.js";
import { keeperOptsFromSpawnResult } from "./spawn-process/headless-pid-registry.js";
import { createHydrationMetrics } from "./metrics/hydration-metrics.js";
import { ensureServerIdentity } from "./auth/identity.js";
import { createIdleTimer } from "./spawn-process/idle-timer.js";
import { createLiveServerManager } from "./live-server/live-server-manager.js";
import { handleLiveServerUpgrade, registerLiveServerProxy } from "./live-server/live-server-proxy.js";
import { ensureLocalToken, verifyLocalToken } from "./auth/local-token.js";
import { createNetworkGuard, isBypassedHost, isGenuinelyLocal } from "./auth/localhost-guard.js";
import { createMemoryEventStore, type EventStore } from "./persistence/memory-event-store.js";
import { createMemorySessionManager, type SessionManager } from "./session/memory-session-manager.js";
import { createMetaPersistence, type MetaPersistence } from "./persistence/meta-persistence.js";
import { needsMigration, runMigration } from "./persistence/migrate-persistence.js";
import { createModelProxyAuthGate } from "./model-proxy/auth-gate.js";
import { getModelRegistry, getStreamSimpleFn } from "./model-proxy/registry-singleton.js";
import { createOpenSpecGroupStore, joinGroupIdsToOpenSpecData } from "./openspec/openspec-group-store.js";
import { PackageManagerWrapper } from "./package/package-manager-wrapper.js";
import { PairedDeviceRegistry } from "./pairing/paired-devices.js";
import { PairingManager } from "./pairing/pairing.js";
import { createPendingAttachRegistry } from "./pending/pending-attach-registry.js";
import { createPendingAutomationRunRegistry } from "./pending/pending-automation-run-registry.js";
import { createPendingClientCorrelations } from "./pending/pending-client-correlations.js";
import { createPendingForkRegistry, type PendingForkRegistry } from "./pending/pending-fork-registry.js";
import { createPendingGoalLinkRegistry } from "./pending/pending-goal-link-registry.js";
import { createPendingInitialPromptRegistry } from "./pending/pending-initial-prompt-registry.js";
import { createPendingResumeIntentRegistry } from "./pending/pending-resume-intent-registry.js";
import { createPendingWorktreeBaseRegistry } from "./pending/pending-worktree-base-registry.js";
import { PiCoreChecker } from "./pi/pi-core-checker.js";
import { PiCoreUpdater } from "./pi/pi-core-updater.js";
import { createPiGateway, type PiGateway } from "./pi/pi-gateway.js";
import { pluginIntentCache } from "./plugin-intent-cache.js";
import { createPreferencesStore, type PreferencesStore } from "./persistence/preferences-store.js";
import { spawnPiSession } from "./spawn-process/process-manager.js";
import { applyReattachPolicy } from "./session/reattach-placement.js";
import { reconcileSessionOrder } from "./session/reconcile-session-order.js";
import { resolveOrderKey } from "./session/resolve-order-key.js";
import { registerCanvasTypesRoutes } from "./routes/canvas-types-routes.js";
import { registerDoctorRoutes } from "./routes/doctor-routes.js";
import { registerFileRoutes } from "./routes/file-routes.js";
import { registerGitRoutes } from "./routes/git-routes.js";
import { registerGoalRoutes } from "./routes/goal-routes.js";
import { registerGrepRoutes } from "./routes/grep-routes.js";
import { registerKnownServersRoutes } from "./routes/known-servers-routes.js";
import { registerLiveServerRoutes } from "./routes/live-server-routes.js";
import { registerManifestRoute } from "./routes/manifest-route.js";
import { registerModelProxyApiKeyRoutes } from "./routes/model-proxy-api-key-routes.js";
import { registerModelProxyDiagnosticsRoutes } from "./routes/model-proxy-diagnostics-routes.js";
import { registerModelProxyRefreshRoutes } from "./routes/model-proxy-refresh-routes.js";
import { registerModelProxyRoutes } from "./routes/model-proxy-routes.js";
import { registerModelsIntrospectionRoute } from "./routes/models-introspection-routes.js";
import { registerOpenSpecGroupRoutes } from "./routes/openspec-group-routes.js";
import { registerOpenSpecRoutes } from "./routes/openspec-routes.js";
import { registerPackageRoutes } from "./routes/package-routes.js";
import { registerPairingRoutes } from "./routes/pairing-routes.js";
import { registerPiChangelogRoutes } from "./routes/pi-changelog-routes.js";
import { registerPiCoreRoutes } from "./routes/pi-core-routes.js";
import { registerPluginActivationRoutes } from "./routes/plugin-activation-routes.js";
import { registerPluginConfigRoutes } from "./routes/plugin-config-routes.js";
import { registerPreferencesAutoNameRoutes } from "./routes/preferences-auto-name-routes.js";
import { registerPreferencesDisplayRoutes } from "./routes/preferences-display-routes.js";
import { registerPreferencesWorktreeInitRoutes } from "./routes/preferences-worktree-init-routes.js";
import { registerProviderAuthRoutes } from "./routes/provider-auth-routes.js";
import { registerProviderRoutes } from "./routes/provider-routes.js";
import { invalidateRecommendedCache, registerRecommendedRoutes } from "./routes/recommended-routes.js";
import { registerResourceActivationRoutes } from "./routes/resource-activation-routes.js";
import { registerSessionRoutes } from "./routes/session-routes.js";
import { registerSystemRoutes } from "./routes/system-routes.js";
import { registerToolRoutes } from "./routes/tool-routes.js";
import { removePid, writePid } from "./spawn-process/server-pid.js";
import { registerSessionApi } from "./session/session-api.js";
import { discoverAndBroadcastSessions } from "./session/session-bootstrap.js";
import { createSessionOrderManager, type SessionOrderManager } from "./session/session-order-manager.js";
import { scanAllSessions } from "./session/session-scanner.js";
import { sessionToMeta } from "./session/session-to-meta.js";
import { mintSpawnToken } from "./auth/spawn-token.js";
import { createTerminalGateway, type TerminalGateway } from "./terminal/terminal-gateway.js";
import { createTerminalManager, type TerminalManager } from "./terminal/terminal-manager.js";
import { cleanupStaleZrok, createTunnel, deleteTunnel, detectZrokBinary, ensureReservedName, getTunnelUrl, scavengeOrphanZrokProcesses } from "./tunnel/tunnel.js";
import { startTunnelWatchdog, stopTunnelWatchdog } from "./tunnel/tunnel-watchdog.js";
import { createWorktreeInitRegistry } from "./git-worktree/worktree-init-registry.js";
import { extractTicket, routeScopeForUrl, type WsRouteScope, WsTicketStore } from "./auth/ws-ticket.js";

export interface ServerConfig {
  port: number;
  piPort: number;
  /**
   * Host/interface the HTTP server and pi gateway bind to. Resolved by
   * `buildConfig()` through `--host` → `PI_DASHBOARD_HOST` → `config.bindHost`
   * → `"127.0.0.1"`. Governs both primary listeners; the model-proxy second
   * port stays loopback. See change: configurable-bind-host.
   */
  host: string;
  dev: boolean;
  autoShutdown: boolean;
  shutdownIdleSeconds: number;
  tunnel: boolean;
  /** v2 reserved NAME sourced from `tunnel.zrok.reservedName`. */
  tunnelReservedName?: string;
  /** v2 persistence opt-in sourced from `tunnel.zrok.persistent`. */
  tunnelPersistent?: boolean;
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
  /** OpenSpec polling config (interval, concurrency, change detection, jitter) */
  openspec?: import("@blackbelt-technology/pi-dashboard-shared/config.js").OpenSpecPollConfig;
  /** Session behavior — hydration worker offload toggle.
   *  See change: offload-session-events-load-to-worker. */
  sessions?: import("@blackbelt-technology/pi-dashboard-shared/config.js").SessionsConfig;
  /** Reattach-placement policy applied when a bridge re-registers after
   *  a dashboard restart. Defaults to `"always"`.
   *  See change: reattach-move-to-front. */
  reattachPlacement?: import("@blackbelt-technology/pi-dashboard-shared/config.js").ReattachPlacement;
  /** Gate: move completed/ended sessions to front of their tier. Default false.
   *  See change: simplify-session-card-ordering. */
  completedFirst?: boolean;
  /** Gate: move ask_user sessions to front of active tier. Default false.
   *  See change: simplify-session-card-ordering. */
  questionFirst?: boolean;
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
  /**
   * In-process OpenSpec poll cache + discovery service. Exposed for tests
   * that need to stub `getOpenSpecData` (e.g. the deleted-proposal bypass).
   * Not part of the public API.
   * See change: replace-proposal-dialog-with-race-handling.
   */
  directoryService: DirectoryService;
  /**
   * Per-cwd session order manager. Exposed for in-process tests that assert
   * order-key placement/re-keying. Not part of the public API.
   * See change: fix-worktree-spawn-placeholder-and-ordering.
   */
  sessionOrderManager: SessionOrderManager;
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

  // Seed Windows git/bash source from config so spawn-env augmentation
  // (ToolResolver.buildSpawnEnv + PTY) picks bundled vs host correctly.
  // No-op on macOS/Linux. See change: embed-git-bash-on-windows.
  setWindowsGitSourceSetting(loadConfig().windowsGitSource);

  // Run migration from sessions.json + state.json if needed
  if (needsMigration()) {
    const migResult = runMigration();
    console.log(`[dashboard] Migration complete: ${migResult.sessionsWritten} sessions, ${migResult.hiddenApplied} hidden applied, ${migResult.hiddenOrphaned} orphaned, renamed: ${migResult.oldFilesRenamed.join(", ")}`);
  }

  const preferencesStore = createPreferencesStore();
  // Server identity + device pairing (D2/D5/D6). Additive; independent of OAuth.
  const serverIdentity = ensureServerIdentity();
  const pairedDeviceRegistry = new PairedDeviceRegistry();
  const wsTicketStore = new WsTicketStore();
  // Local-IPC allowlist token (D10, narrowed): affirmative genuine-local trust
  // for same-host process callers, independent of the forgeable loopback IP.
  const localToken = ensureLocalToken();
  const pairingManager = new PairingManager({
    registry: pairedDeviceRegistry,
    getFingerprint: () => serverIdentity.fingerprint,
    getReachableUrls: () => {
      const urls: string[] = [];
      const tunnelUrl = getTunnelUrl();
      if (tunnelUrl) urls.push(tunnelUrl);
      urls.push(...(loadConfig().pairing?.publicBaseUrls ?? []));
      // Test-only (PI_E2E_SEED): expose the loopback http origin so the
      // Playwright/Docker harness can pair over http://localhost (a genuine
      // secure context) without TLS. `reachableUrls()` re-gates it behind the
      // same flag; prod never reaches this branch.
      // See change: make-pairing-qr-camera-scannable.
      if (process.env.PI_E2E_SEED === "1") urls.push(`http://localhost:${config.port}`);
      return urls;
    },
  });
  const sessionManager = createMemorySessionManager();
  const metaPersistence = createMetaPersistence();
  // Stable per-boot id stamped into the liveness marker so cold start can
  // attribute a `live:true` sidecar to a specific server run. A new value
  // each createServer() call is sufficient — the classifier needs
  // `live===true && status!=="ended"`; the epoch is diagnostic and
  // guards the once-per-activation rewrite. Sidecars lacking `liveEpoch`
  // (pre-feature or fallback) still classify on `live` alone (task 4.1).
  // See change: reopen-sessions-after-shutdown.
  const liveEpoch = Date.now();
  const sessionOrderManager = createSessionOrderManager(preferencesStore);
  const pendingForkRegistry = createPendingForkRegistry();
  // Maps spawnToken → originating browser requestId. Surfaced as
  // session_added.spawnRequestId so the client can auto-select / dismiss
  // its placeholder by exact correlation. See change: spawn-correlation-token.
  const pendingClientCorrelations = createPendingClientCorrelations();

  // Worktree-init progress registry: maps requestId -> originating ws
  // so `worktree_init_*` events stream only to the dialog that
  // initiated the run. See change: generalize-worktree-init-hook.
  const worktreeInitRegistry = createWorktreeInitRegistry();

  // Restore sessions from per-session .meta.json files (scans ~/.pi/agent/sessions/)
  const scanResult = scanAllSessions();
  // Interrupted-session recovery candidates discovered on cold start. A
  // candidate (`live===true && status!=="ended"`, see isRecoveryCandidate)
  // was running when the host died. Candidates are NORMALIZED to `ended` on
  // cold start in ALL modes (`ask`, `auto`, `off`) exactly like any other
  // non-`ended` restored session — nothing looks pre-reopened before the user
  // clicks Reopen. In `ask`/`auto` the candidate is ALSO collected into
  // `recoveryCandidates` (carrying `sessionFile`, `cwd`, `name`, `model`,
  // `liveEpoch`) so the offer / auto-resume can re-hydrate it via the resume
  // flow, which does not depend on the pre-reopen status.
  // See change: fix-recovery-offer-dismiss-and-phantom-reopen.
  const recoveryMode = loadConfig().reopenSessionsAfterShutdown;
  const recoveryCandidates: DashboardSession[] = [];
  for (const session of scanResult.sessions) {
    const restored = { ...session, dataUnavailable: true };
    const candidate = recoveryMode !== "off" && isRecoveryCandidate({
      live: session.live,
      status: session.status,
      closedReason: session.closedReason,
      kind: session.kind,
    });
    if (candidate) {
      // Collect for the offer / auto-resume BEFORE normalization, so the
      // candidate carries its resume metadata (sessionFile, cwd, name, model,
      // liveEpoch). Push the same `restored` reference we normalize below.
      restored.recoveryCandidate = true;
      recoveryCandidates.push(restored);
    }
    if (restored.status !== "ended") {
      // Force any non-`ended` restored status to `ended` — candidates and
      // non-candidates alike. Reopen re-hydrates independently of this status.
      restored.status = "ended";
      restored.endedAt = restored.endedAt ?? Date.now();
    }
    sessionManager.restore(restored);
  }
  if (scanResult.cacheUpdates > 0) {
    console.log(`[dashboard] Session scan: ${scanResult.sessions.length} sessions, ${scanResult.cacheUpdates} cache updates`);
  }

  // Save per-session .meta.json on any change. The meta payload is an EXPLICIT
  // field enumeration (`sessionToMeta`) written as a FULL overwrite — omitting a
  // field there wipes it on the next unrelated save. See change: add-session-tags.
  sessionManager.onChange = (sessionId: string, ctx) => {
    const session = sessionManager.get(sessionId);
    if (!session?.sessionFile) return;
    metaPersistence.save(session.sessionFile, sessionToMeta(session));
    // Order-map key for this session: the RESOLVED group path (parent repo
    // for worktree sessions), the same key the client reads.
    // See change: simplify-session-card-ordering.
    const orderKey = resolveOrderKey(session, preferencesStore.getPinnedDirectories());
    // Status-transition tracking: the gated move runs ONCE per transition
    // to ended. Subsequent `update()` calls on an already-ended session
    // (heartbeat tail, click-induced state sync, late bridge events) do
    // NOT re-fire it.
    // See changes: pin-and-search-sessions, simplify-session-card-ordering.
    const wasEnded = endedSessionIds.has(sessionId);
    const isEnded = session.status === "ended";
    if (isEnded && !wasEnded) {
      // Just transitioned alive→ended. The id STAYS in the order map
      // (all-status list); the client status-partition re-tiers it into
      // the ended tier. When `completedFirst` is on, surface it at the top
      // of the ended tier via move-to-front; otherwise no-op (keep slot).
      // See change: simplify-session-card-ordering.
      endedSessionIds.add(sessionId);
      if (config.completedFirst) {
        sessionOrderManager.moveToFront(orderKey, sessionId);
        browserGateway.broadcastToAll({
          type: "sessions_reordered",
          cwd: orderKey,
          sessionIds: sessionOrderManager.getOrder(orderKey) ?? [],
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
            orderKey,
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
      sessionOrderManager.moveToFront(orderKey, sessionId);
      const next = sessionOrderManager.getOrder(orderKey) ?? [];
      browserGateway.broadcastToAll({
        type: "sessions_reordered",
        cwd: orderKey,
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
        sessionOrderManager.moveToFront(orderKey, sessionId);
        const next = sessionOrderManager.getOrder(orderKey) ?? [];
        browserGateway.broadcastToAll({
          type: "sessions_reordered",
          cwd: orderKey,
          sessionIds: next,
        });
      } else if (intent === "keep") {
        // Honor dropped slot; do nothing.
      } else {
        applyReattachPolicy(
          sessionId,
          orderKey,
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

  // Startup reconciliation (inverted from the old alive-only prune).
  // The order map now holds ALL-status ids. On boot:
  //   1. Prune stale ids (no longer in the session manager at all).
  //   2. Backfill ended ids that exist under the resolved key but are
  //      absent from the stored list, ordered by `(endedAt ?? startedAt)`
  //      desc — the old implicit ended-tier ordering — so pre-migration
  //      maps (which stripped ended ids) render identically on first load.
  // Idempotent: ended ids already present keep their slot.
  // See changes: pin-and-search-sessions, simplify-session-card-ordering.
  {
    const pinnedDirs = preferencesStore.getPinnedDirectories();
    const changes = reconcileSessionOrder(
      sessionOrderManager.getAllOrders(),
      sessionManager.listAll(),
      (s) => resolveOrderKey(s, pinnedDirs),
    );
    for (const [key, ids] of Object.entries(changes)) {
      sessionOrderManager.reorder(key, ids);
    }
  }

  // Track cwds with pending dashboard-spawned sessions (for writing .meta.json).
  // Uses a counter per cwd to handle multiple spawns and avoid reconnects consuming entries.
  const pendingDashboardSpawns = new Map<string, number>();

  // Pending spawn-with-attach intents (cwd → FIFO queue of changeNames).
  // Consumed in event-wiring.ts on session_register. See change:
  // add-folder-task-checker-and-spawn-attach.
  const pendingAttachRegistry = createPendingAttachRegistry();
  // Pending initial-prompt intents (cwd → prompt). Populated by the no-hook
  // Initialize button spawn, consumed by event-wiring's session_register hook
  // to dispatch `/skill:project-init` as the session's first prompt.
  // See change: project-init-skill-and-profiles.
  const pendingInitialPromptRegistry = createPendingInitialPromptRegistry();
  // Pending worktree-base intents (cwd → base). Populated by the
  // worktree spawn dialog flow, consumed by event-wiring's session_register
  // hook to write .meta.json#gitWorktreeBase.
  // See change: add-worktree-spawn-dialog.
  const pendingWorktreeBaseRegistry = createPendingWorktreeBaseRegistry();
  // Pending automation-run stamps (cwd → { name, runId, visibility }).
  // Populated by the automation-plugin spawn hook, consumed by event-wiring's
  // session_register hook to stamp kind="automation" + automationRun.
  // See change: add-automation-plugin.
  const pendingAutomationRunRegistry = createPendingAutomationRunRegistry();
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

  // Folder-scoped goal store + pending-link registry. The store owns durable
  // GoalRecords (objective, criteria, linked sessions); the pending registry
  // correlates spawn-from-goal sessions to their goalId at session_register.
  // See change: add-goals-folder-page.
  const goalStore = createGoalStore();
  const pendingGoalLinkRegistry = createPendingGoalLinkRegistry();
  // Goal session supervisor (main-server; owns GoalStore). Assigned below once
  // browserGateway/spawn deps exist, then rides `dispatchPluginSessionEnded`.
  // See change: add-goal-session-supervisor.
  let goalSupervisor: GoalSupervisor | undefined;

  // Process-local instrumentation for session hydration. The same instance is
  // shared with the directory-service (records per `loadSessionEvents`) and the
  // `/api/health` route (reads `snapshot()`). See change:
  // instrument-session-hydration-timing.
  const hydrationMetrics = createHydrationMetrics(20);

  // Event-loop delay histogram, started once at boot. `/api/health` reads
  // {meanMs,p99Ms,maxMs} then resets the window so each read reflects recent
  // activity. Negligible libuv-timer overhead. See change above.
  const eventLoopDelayHistogram = monitorEventLoopDelay({ resolution: 20 });
  eventLoopDelayHistogram.enable();
  const readEventLoopDelay = () => {
    const ms = (ns: number) => (Number.isFinite(ns) ? ns / 1e6 : 0);
    const snapshot = {
      meanMs: ms(eventLoopDelayHistogram.mean),
      p99Ms: ms(eventLoopDelayHistogram.percentile(99)),
      maxMs: ms(eventLoopDelayHistogram.max),
    };
    eventLoopDelayHistogram.reset();
    return snapshot;
  };

  // Sub-threshold event-loop stall retention. A bounded, process-local ring
  // buffer fed by two independent feeds: the OpenSpec poll path self-records
  // per-turn synchronous stalls (`directory-service.ts`), and the dedicated
  // sampler below records `turn: null` for stalls no instrumented turn owns
  // (GC, hydration deserialize, WS on-connect). `/api/health` reads its
  // snapshot. See change: attribute-openspec-poll-eventloop-stalls.
  const EVENTLOOP_SPIKE_FLOOR_MS = 100;
  const EVENTLOOP_SAMPLE_INTERVAL_MS = 1000;
  const eventLoopSpikes = createEventLoopSpikeMetrics(50);
  // Dedicated `monitorEventLoopDelay` instance — NEVER the boot histogram
  // above (which `/api/health` reads-and-resets). Owning a separate histogram
  // avoids a reset race: `/api/health`'s mean/p99/max stay unaffected.
  const eventLoopSampler = startEventLoopSampler({
    floorMs: EVENTLOOP_SPIKE_FLOOR_MS,
    intervalMs: EVENTLOOP_SAMPLE_INTERVAL_MS,
    onSpike: (ms) => {
      try { eventLoopSpikes.record({ at: Date.now(), ms, turn: null }); }
      catch { /* measurement must never break the loop */ }
    },
  });

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
      // Worker-path enrichment: fetch only the assignments map so the worker
      // can apply the join in-thread and emit a fully-joined `serialized`
      // payload. See change: offload-openspec-poll-to-worker.
      getOpenSpecGroupAssignments: async (cwd) => {
        try {
          const file = await openspecGroupStore.read(cwd);
          return file.assignments ?? {};
        } catch {
          return {};
        }
      },
      hydrationMetrics,
      // Per-turn self-record feed into the shared spike buffer + the per-turn
      // slow-tick alarm. See change: attribute-openspec-poll-eventloop-stalls.
      eventLoopSpikes,
      eventLoopSpikeFloorMs: EVENTLOOP_SPIKE_FLOOR_MS,
      useLoadWorker: config.sessions?.useLoadWorker !== false,
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

  // Relay for AI-drafted commit messages (bridge fork-subagent ↔ HTTP).
  // See change: add-session-uncommitted-indicator-and-commit.
  const commitDraftRelay = createCommitDraftRelay();

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

  // Live-server-preview manager (loopback dev-server allowlist + proxy).
  const liveServerManager = createLiveServerManager(preferencesStore);

  const browserGateway = createBrowserGateway(sessionManager, eventStore, piGateway, undefined, pendingForkRegistry, sessionOrderManager, preferencesStore, directoryService, terminalManager, pendingDashboardSpawns, config.maxWsBufferBytes, pendingAttachRegistry, pendingInitialPromptRegistry, pendingResumeIntents, pendingClientCorrelations, pendingWorktreeBaseRegistry, metaPersistence);

  // Editor-pane changed-on-disk watch: the browser declares its open files via
  // `watch_files`; the server watches exactly those and pushes `file_changed`.
  // Torn down on disconnect so no fd leaks. See change: split-editor-workspace.
  const fileWatchManager = createFileWatchManager();
  browserGateway.registerHandler("watch_files", (msg: { sessionId?: string; cwd?: string; paths?: unknown }, _ws) => {
    if (!msg?.sessionId || !msg?.cwd) return;
    // Gate: only watch under a known session cwd (mirrors /api/file).
    if (!sessionManager.listAll().some((s) => s.cwd === msg.cwd)) return;
    // Harden against a malformed client payload: keep only string rel-paths.
    const paths = Array.isArray(msg.paths) ? msg.paths.filter((p): p is string => typeof p === "string") : [];
    fileWatchManager.setWatched(_ws, msg.sessionId, msg.cwd, paths, (sessionId, path) =>
      browserGateway.broadcast({ type: "file_changed", sessionId, path }),
    );
  });
  browserGateway.registerDisconnectHandler((ws) => fileWatchManager.clearConnection(ws));

  // Resolve package version once at startup
  const __require = createRequire(import.meta.url);
  let pkgVersion = "unknown";
  try { pkgVersion = __require("../package.json").version ?? "unknown"; } catch {}
  const selfHostname = os.hostname();

  // Pending cold-start recovery offer (ask mode). Held so it replays to every
  // client that connects after start() broadcast it once — broadcastToAll at
  // cold start reaches nobody (clients attach later). Cleared server-side on
  // any resolving action (reopen or dismiss) so onConnect replay stops after
  // the first resolution ("shown once per dirty boot").
  // See change: fix-recovery-offer-dismiss-and-phantom-reopen.
  let pendingRecoveryOffer: import("@blackbelt-technology/pi-dashboard-shared/browser-protocol.js").RecoveryOfferMessage | null = null;

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
    if (pendingRecoveryOffer) browserGateway.sendToClient(ws, pendingRecoveryOffer);
  };

  // Dismissing a recovery offer is a resolving action: null the held offer so
  // onConnect stops replaying it. The gateway already consumed the on-disk
  // liveness markers for the dismissed ids, so a full restart won't re-offer.
  // See change: fix-recovery-offer-dismiss-and-phantom-reopen.
  browserGateway.onRecoveryDismiss = () => {
    pendingRecoveryOffer = null;
  };

  // Reopen (resume_session) is likewise a resolving action: null the held
  // offer so onConnect stops replaying it after the first resolution.
  // See change: fix-recovery-offer-dismiss-and-phantom-reopen.
  browserGateway.onRecoveryResolve = () => {
    pendingRecoveryOffer = null;
  };

  // Plugin pi-message dispatch registry + raw-event subscribers.
  // Populated by ServerPluginContext.registerPiHandler / onEvent (see the
  // createContext block below); consumed by wireEvents — `plugin_pi_message`
  // envelopes route to handlers by messageType; every `event_forward` fans
  // out to raw-event subscribers. See change: add-goal-continuation-plugin.
  const pluginPiHandlers = new Map<string, Array<(msg: unknown) => void>>();
  const pluginRawEventSubs = new Set<(sessionId: string, event: unknown) => void>();
  // Plugin session-end subscribers (ServerPluginContext.onSessionEnded). Fired
  // from sessionManager.onUnregister via wireEvents — the transport-independent
  // death signal, even when no terminal pi event was forwarded.
  // See change: finalize-automation-run-on-session-death.
  const pluginSessionEndSubs = new Set<(sessionId: string) => void>();
  // Host-owned cross-plugin service registry backing ServerPluginContext
  // provide/consume. One instance shared across every plugin context; the
  // loader's topological order guarantees a provider's registerPlugin runs
  // before a dependent's consume. In-process only.
  // See change: register-plugin-automation-events.
  const pluginServiceRegistry = new Map<string, unknown>();
  // Host-provided known-folder set for plugin cwd validation: session cwds ∪
  // pinned directories, as a LIVE getter (not a boot-time snapshot) so plugins
  // see folders added later. kb-plugin consumes this to guard its /api/kb/*
  // routes against arbitrary-path indexing — a session-less worktree appears
  // only via pinned dirs, unreachable from the plugin sessionManager surface.
  // See change: add-kb-folder-slot.
  pluginServiceRegistry.set("host.knownFolderCwds", (): string[] => {
    const set = new Set<string>();
    for (const s of sessionManager.listAll()) if (s.cwd) set.add(s.cwd);
    for (const d of preferencesStore.getPinnedDirectories()) set.add(d);
    return [...set];
  });
  function dispatchPluginPiMessage(messageType: string, msg: unknown): void {
    const arr = pluginPiHandlers.get(messageType);
    if (!arr) return;
    for (const h of arr) {
      try { h(msg); } catch (err) { console.error("[plugin-pi-handler]", messageType, err); }
    }
  }
  function dispatchPluginRawEvent(sessionId: string, event: unknown): void {
    for (const h of pluginRawEventSubs) {
      try { h(sessionId, event); } catch (err) { console.error("[plugin-onEvent]", err); }
    }
  }
  function dispatchPluginSessionEnded(sessionId: string): void {
    // Ride the existing death fanout for the goal supervisor (main-server; it
    // owns GoalStore, unlike the goal plugin). C2a: subscribe here, never
    // reassign sessionManager.onUnregister. See change: add-goal-session-supervisor.
    if (goalSupervisor) void goalSupervisor.onDriverDeath(sessionId);
    for (const h of pluginSessionEndSubs) {
      try { h(sessionId); } catch (err) { console.error("[plugin-onSessionEnded]", err); }
    }
  }

  // Main-server consumer of goal_status snapshots: accumulates bounded judge
  // verdict history onto the owning GoalRecord. The goal-plugin server can't
  // reach the GoalStore, so retention lives here. Registered as a peer of the
  // plugin's own goal_status handler (both fire via dispatchPluginPiMessage).
  // See change: sophisticate-goal-authoring-and-control (task 2.2).
  {
    const accumulator = createGoalVerdictAccumulator({
      store: goalStore,
      lookupSession: (sessionId) => {
        const s = sessionManager.get(sessionId);
        return s ? { goalId: s.goalId, cwd: s.cwd } : null;
      },
    });
    // Protocol message type mirrored by the goal-plugin bridge → server.
    // Kept as a literal to avoid a server→goal-plugin package dependency.
    const GOAL_STATUS_MESSAGE = "goal_status";
    const arr = pluginPiHandlers.get(GOAL_STATUS_MESSAGE) ?? [];
    arr.push((msg) => accumulator.handle(msg));

    // Peer consumer: project the live snapshot onto the GoalRecord's durable
    // status + turn fields so the board/budget survive a reload/restart.
    // See change: persist-goal-status-and-progress.
    const statusProjector = createGoalStatusProjector({
      store: goalStore,
      lookupSession: (sessionId) => {
        const s = sessionManager.get(sessionId);
        return s ? { goalId: s.goalId, cwd: s.cwd } : null;
      },
    });
    arr.push((msg) => statusProjector.handle(msg));

    // Dashboard-side budget enforcement (degraded tier): once a linked goal's
    // live turnsUsed reaches GoalRecord.budget.maxTurns, dispatch /goal pause.
    // Deduped per session so an already-capped loop isn't re-paused every
    // snapshot. See change: sophisticate-goal-authoring-and-control (task 3.2).
    const budgetPaused = new Set<string>();
    arr.push((msg) => {
      const m = msg as { sessionId?: string; payload?: { status?: string; turnsUsed?: unknown } };
      if (!m.sessionId || !m.payload || typeof m.payload.status !== "string") return;
      const sessionId = m.sessionId;
      if (m.payload.status !== "active") {
        budgetPaused.delete(sessionId);
        return;
      }
      const turnsUsed = m.payload.turnsUsed;
      if (typeof turnsUsed !== "number" || !Number.isFinite(turnsUsed)) return;
      // Add to dedup set BEFORE the async lookup to close the race window.
      // Removed again if the lookup shows no halt.
      if (budgetPaused.has(sessionId)) return;
      budgetPaused.add(sessionId);
      const sess = sessionManager.get(sessionId);
      if (!sess?.goalId || !sess.cwd) { budgetPaused.delete(sessionId); return; }
      const cwd = sess.cwd;
      const goalId = sess.goalId;
      void goalStore
        .list(cwd)
        .then((goals) => {
          const goal = goals.find((g) => g.id === goalId);
          // Budget on CUMULATIVE turns (design D3): respawns accumulate onto
          // `totalTurnsUsed`, so a fresh driver's low per-session count cannot
          // reset/defeat the cap. Fall back to the live per-session count for a
          // legacy record with no cumulative yet, and take the max to be robust
          // against a projector write that lags this same snapshot.
          // See change: add-goal-session-supervisor.
          const cumulativeTurns = Math.max(goal?.totalTurnsUsed ?? 0, turnsUsed);
          const decision = decideBudgetHalt(
            { status: "active", turnsUsed: cumulativeTurns },
            goal?.budget,
          );
          if (decision.halt && decision.command) {
            piGateway.sendToSession(sessionId, { type: "send_prompt", sessionId, text: decision.command });
          } else {
            budgetPaused.delete(sessionId); // no halt → allow future checks
          }
        })
        .catch((err) => { budgetPaused.delete(sessionId); console.warn(`[goal-budget-guard] budget check failed for ${goalId}:`, err); });
    });
    pluginPiHandlers.set(GOAL_STATUS_MESSAGE, arr);
  }

  // Rename a session card + dispatch the goal kickoff so a goal-linked session
  // actually pursues its objective. Shared by the spawn path (event-wiring
  // goal-link arm) and the explicit link path (goal-routes).
  const primeGoalSessionImpl = (
    sessionId: string,
    goal: { objective: string; criteria?: import("@blackbelt-technology/pi-dashboard-shared/types.js").GoalCriterion[] },
  ): void => {
    primeGoalSession(
      {
        sendPrompt: (sid, text) => piGateway.sendToSession(sid, { type: "send_prompt", sessionId: sid, text }),
        renameSession: (sid, name) => {
          const updates = { name: name || undefined };
          sessionManager.update(sid, updates);
          browserGateway.broadcastSessionUpdated(sid, updates);
          piGateway.sendToSession(sid, { type: "rename_session", sessionId: sid, name });
        },
      },
      sessionId,
      goal,
    );
  };

  // Wire up event forwarding from pi gateway to browser gateway
  wireEvents({
    sessionManager,
    eventStore,
    piGateway,
    browserGateway,
    sessionOrderManager,
    preferencesStore,
    isCompletedFirst: () => config.completedFirst ?? false,
    isQuestionFirst: () => config.questionFirst ?? false,
    pendingForkRegistry,
    directoryService,
    knownSessionIds,
    pendingDashboardSpawns,
    pendingAttachRegistry,
    pendingWorktreeBaseRegistry,
    pendingAutomationRunRegistry,
    pendingGoalLinkRegistry,
    goalStore,
    primeGoalSession: primeGoalSessionImpl,
    pendingInitialPromptRegistry,
    viewedSessionTracker: browserGateway.viewedSessionTracker,
    pendingClientCorrelations,
    dispatchPluginPiMessage,
    dispatchPluginRawEvent,
    dispatchPluginSessionEnded,
    metaPersistence,
    liveEpoch,
    commitDraftRelay,
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
  const corsTrustedNetworks = config.resolvedTrustedNetworks ?? [];
  await fastify.register(cors, {
    // Decision extracted to a pure, unit-tested helper (cors-origin.ts) so the
    // security-critical allow/deny logic is tested against the REAL code, not a
    // hand-mirrored copy. Trusted-network origins are allowed for LAN-to-LAN
    // switching; the `null`-origin refusal and unknown-origin rejection stand.
    // On mismatch return `cb(null, false)` (no CORS headers) rather than an
    // Error — the latter makes @fastify/cors 500 same-origin module-script
    // requests. See change: fix-remote-connect-cors-gates.
    origin: (origin, cb) => {
      const allowed = isCorsOriginAllowed(origin ?? undefined, {
        configuredOrigins: corsAllowedOrigins,
        trustedNetworks: corsTrustedNetworks,
        getTunnelUrl,
      });
      cb(null, allowed);
    },
    credentials: true,
  });

  // Baseline CSP (defense in depth). Report-only by default (non-breaking);
  // `PI_DASHBOARD_CSP=enforce` flips to enforcing once report-only is clean.
  // Skips proxied prefixes (/editor, /live) so their own policies stand.
  // See change: improve-content-editor (§7).
  registerCsp(fastify, resolveCspMode(process.env.PI_DASHBOARD_CSP));

  // Register auth plugin if configured (must be before routes)
  // Decorate isAuthenticated once, up front, so both the bearer branch and the
  // OAuth plugin can read/set it without racing on the decorator.
  fastify.decorateRequest("isAuthenticated", false);
  // Bearer device-auth branch — registered BEFORE the OAuth plugin so its
  // onRequest hook runs first and OAuth can early-return when already
  // authenticated. Additive (D5/D7); independent of whether OAuth is on.
  registerBearerAuth(fastify, { registry: pairedDeviceRegistry });
  if (config.authConfig) {
    await registerAuthPlugin(fastify, {
      authConfig: config.authConfig,
      port: config.port,
      resolvedTrustedNetworks: config.resolvedTrustedNetworks,
      localToken,
    });
  } else {
    // Auth disabled — still expose /auth/status so clients can detect this
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
  const networkGuard = createNetworkGuard(config.resolvedTrustedNetworks ?? [], { localToken });

  registerSessionRoutes(fastify, { sessionManager, eventStore, networkGuard });
  registerGitRoutes(fastify, {
    networkGuard, sessionManager, browserGateway, worktreeInitRegistry,
    sendToSession: (id, msg) => piGateway.sendToSession(id, msg),
    commitDraftRelay,
  });

  // Browser channel for worktree-init event subscriptions. The dialog
  // sends `worktree_init_subscribe { requestId }` over its existing ws
  // BEFORE issuing POST /api/git/worktree/init so the server knows which
  // ws to stream progress to. See change: generalize-worktree-init-hook.
  browserGateway.registerHandler("worktree_init_subscribe", (msg, ws) => {
    const requestId = typeof msg?.requestId === "string" ? msg.requestId : undefined;
    if (requestId) worktreeInitRegistry.subscribe(requestId, ws);
    // cwd-keyed fan-out: survives refresh, reaches every tab.
    // See change: friendlier-worktree-init.
    const cwd = typeof msg?.cwd === "string" ? msg.cwd : undefined;
    if (cwd) worktreeInitRegistry.subscribeCwd(cwd, ws);
  });
  browserGateway.registerHandler("worktree_init_unsubscribe", (msg, ws) => {
    const requestId = typeof msg?.requestId === "string" ? msg.requestId : undefined;
    if (requestId) worktreeInitRegistry.unsubscribe(requestId);
    const cwd = typeof msg?.cwd === "string" ? msg.cwd : undefined;
    if (cwd) worktreeInitRegistry.unsubscribeCwd(cwd, ws);
  });
  registerFileRoutes(fastify, { sessionManager, preferencesStore, networkGuard });
  registerGrepRoutes(fastify, { sessionManager, networkGuard });
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
      changeOrder: payload.changeOrder,
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

  // Folder-scoped goals: broadcast on mutation + REST surface.
  // See change: add-goals-folder-page.
  goalStore.subscribe((cwd, payload) => {
    browserGateway.broadcastToAll({ type: "goals_update", cwd, goals: payload.goals });
  });
  // Stamp/clear goalId on a session: in-memory + .meta.json + broadcast.
  const applyGoalIdToSession = (sessionId: string, goalId: string | null): void => {
    const next = goalId ?? undefined;
    sessionManager.update(sessionId, { goalId: next });
    const session = sessionManager.get(sessionId);
    if (session?.sessionFile) {
      try {
        mergeSessionMeta(session.sessionFile, { goalId: next });
      } catch (err) {
        console.warn(`[goal-routes] failed to persist goalId to .meta.json for ${sessionId}:`, err);
      }
    }
    browserGateway.broadcastSessionUpdated(sessionId, { goalId: next });
  };
  registerGoalRoutes(fastify, {
    sessionManager,
    preferencesStore,
    networkGuard,
    store: goalStore,
    applyGoalIdToSession,
    primeGoalSession: primeGoalSessionImpl,
    // Route clear/pause/delete through the supervisor (assigned just below,
    // before the server listens). See change: add-goal-session-supervisor.
    abortGoalSupervision: (cwd, goalId, terminal) =>
      goalSupervisor ? goalSupervisor.abort(cwd, goalId, terminal) : Promise.resolve(),
    spawnGoalSession: async (cwd, goalId, opts) => {
      // PRIMARY correlation: mint the spawn token up front and stamp `goalId`
      // onto the registry entry keyed to it, so `session_register` links via
      // the strong token path (getGoalId). The cwd-FIFO enqueue stays only as
      // a legacy fallback for bridges that don't echo the token.
      // See change: add-goal-session-supervisor (Correlation).
      const spawnToken = mintSpawnToken();
      pendingGoalLinkRegistry.enqueue(cwd, goalId);
      try {
        const result = await spawnPiSession(cwd, {
          strategy: "headless",
          spawnToken,
          ...(opts?.model ? { model: opts.model } : {}),
        });
        if (result.process && result.pid) {
          browserGateway.headlessPidRegistry.register(
            result.pid,
            cwd,
            result.process,
            result.spawnToken ?? spawnToken,
            keeperOptsFromSpawnResult(result),
            goalId,
          );
        }
        // On spawn failure, drop the goalId we just enqueued so it can't be
        // mis-consumed by a later unrelated session in the same cwd.
        if (!result.success) pendingGoalLinkRegistry.consume(cwd);
        return { success: result.success, ...(result.message ? { message: result.message } : {}) };
      } catch (err) {
        pendingGoalLinkRegistry.consume(cwd);
        return { success: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  // ── Goal session supervisor ─────────────────────────────────────
  // Rides the death fanout (dispatchPluginSessionEnded, wired above) and adds
  // goal PURSUIT policy: progress-gated auto-respawn, crash-loop breaker,
  // cumulative budget. Host owns the mechanism (spawn/token-correlate/kill/
  // resume). See change: add-goal-session-supervisor.
  const spawnGoalDriver = async (req: GoalDriverSpawnRequest): Promise<{ success: boolean; message?: string }> => {
    // Fresh spawns re-prime with a verdict summary dispatched on register.
    if (req.reason === "fresh" && req.reprime) {
      pendingInitialPromptRegistry.enqueue(req.cwd, req.reprime);
    }
    pendingGoalLinkRegistry.enqueue(req.cwd, req.goalId);
    try {
      const result = await spawnPiSession(req.cwd, {
        strategy: "headless",
        spawnToken: req.spawnToken,
        ...(req.reason === "resume" && req.sessionFile
          ? { sessionFile: req.sessionFile, mode: "continue" as const }
          : {}),
      });
      if (result.process && result.pid) {
        browserGateway.headlessPidRegistry.register(
          result.pid,
          req.cwd,
          result.process,
          result.spawnToken ?? req.spawnToken,
          keeperOptsFromSpawnResult(result),
          req.goalId,
        );
      }
      if (!result.success) {
        pendingGoalLinkRegistry.consume(req.cwd);
        if (req.reason === "fresh" && req.reprime) pendingInitialPromptRegistry.consume(req.cwd);
      }
      return { success: result.success, ...(result.message ? { message: result.message } : {}) };
    } catch (err) {
      pendingGoalLinkRegistry.consume(req.cwd);
      if (req.reason === "fresh" && req.reprime) pendingInitialPromptRegistry.consume(req.cwd);
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  };
  goalSupervisor = createGoalSupervisor({
    store: goalStore,
    isSessionLive: (sessionId) => {
      const s = sessionManager.get(sessionId);
      return !!s && s.status !== "ended";
    },
    resolveSessionFile: (sessionId) => sessionManager.get(sessionId)?.sessionFile,
    spawnDriver: spawnGoalDriver,
    killByToken: (token) => browserGateway.headlessPidRegistry.killByToken(token),
    killBySession: (sessionId) => browserGateway.headlessPidRegistry.killBySessionId(sessionId),
    buildReprime: (goal) => buildGoalReprime(goal),
    // Respawn spawns force strategy:"headless" (spawnGoalDriver); the dashboard
    // always spawns headless, so RPC control is available. See change:
    // add-goal-session-supervisor (C2j).
    headlessAvailable: () => true,
    log: (msg, meta) => console.error(msg, meta ?? ""),
  });
  // Boot-time reconcile: classify any pursuing/respawning goal whose driver did
  // not re-register after a restart. DEFERRED past a reconnect grace window so
  // live drivers re-register first (else every restart would falsely see all
  // drivers dead and respawn them). See change: add-goal-session-supervisor (S10).
  const GOAL_BOOT_RECONCILE_DELAY_MS = 30_000;
  const bootReconcileTimer = setTimeout(() => {
    goalSupervisor?.reconcileOnBoot().catch((err) => console.error("[goal-supervisor] boot reconcile failed", err));
  }, GOAL_BOOT_RECONCILE_DELAY_MS);
  bootReconcileTimer.unref?.();

  registerSystemRoutes(fastify, { sessionManager, preferencesStore, metaPersistence, config, networkGuard, version: pkgVersion, directoryService, piGateway, browserGateway, hydrationMetrics, readEventLoopDelay, eventLoopSpikes, eventStore });
  // GET /api/doctor — see change: doctor-rich-output (task 4.2). Auth-gated identically to /api/config.
  registerDoctorRoutes(fastify);
  registerToolRoutes(fastify, { registry: getDefaultRegistry(), networkGuard });

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
  registerResourceActivationRoutes(fastify, { networkGuard, piGateway, sessionManager });
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

  // Live-server-preview routes + reverse proxy (main-origin /live/:id/*).
  registerLiveServerRoutes(fastify, liveServerManager, { networkGuard });
  registerLiveServerProxy(fastify, liveServerManager);

  registerProviderAuthRoutes(fastify, { piGateway, browserGateway });
  // Ungated model-introspection surface for in-session agents (GET /api/models).
  // Registered unconditionally (not behind modelProxy.enabled), subject only to
  // the dashboard's own auth gate — same posture as /api/provider-auth/status.
  // See change: surface-model-introspection-to-agents.
  registerModelsIntrospectionRoute(fastify, {
    getRegistry: async () => {
      try {
        return await getModelRegistry();
      } catch {
        return null;
      }
    },
  });
  registerKnownServersRoutes(fastify, { networkGuard, getPeerServers: () => peerServers });
  registerPairingRoutes(fastify, {
    networkGuard,
    identity: serverIdentity,
    pairing: pairingManager,
    registry: pairedDeviceRegistry,
  });
  // Mint a single-use WS ticket (D11). Authenticated (networkGuard: cookie,
  // trusted network, or Authorization: Bearer). The ticket is bound to a WS
  // route scope so it can't be replayed against a more-privileged route.
  fastify.post<{ Body: { scope?: WsRouteScope } }>(
    "/api/ws-ticket",
    { preHandler: networkGuard },
    async (request, reply) => {
      const scope = request.body?.scope;
      if (scope !== "browser" && scope !== "terminal" && scope !== "live") {
        reply.code(400);
        return { success: false as const, error: "invalid scope" };
      }
      return { success: true as const, data: { ticket: wsTicketStore.mint(scope) } };
    },
  );
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
  // Canvas-type registry read/write (auto-canvas task 5.2).
  registerCanvasTypesRoutes(fastify, { networkGuard });
  // Opt-in worktree auto-init-on-spawn preference (auto-init-worktree-on-spawn).
  registerPreferencesWorktreeInitRoutes(fastify, { preferencesStore, networkGuard });
  // Global auto-session-naming toggle (add-auto-session-naming). Broadcasts
  // `preferences_update` to bridges on change.
  registerPreferencesAutoNameRoutes(fastify, { preferencesStore, piGateway, networkGuard });
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

      // Register diagnostics route (JWT-gated). See change: filter-oauth-incompatible-models.
      registerModelProxyDiagnosticsRoutes(fastify);
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
    directoryService,
    sessionOrderManager,

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
        const { getKeeperManager } = await import("./spawn-process/process-manager.js");
        browserGateway.headlessPidRegistry.setKeeperWriter(getKeeperManager());
        await browserGateway.headlessPidRegistry.cleanupKeeperOrphans();
      } catch (err) {
        console.warn("[dashboard] keeper-manager wire-up failed (RPC dispatch disabled):", err);
      }

      // Spawned pi sessions must connect back to THIS server's gateway, not
      // the config-default piPort. Critical for multi-instance setups (e.g. a
      // git-worktree dashboard on a non-default --pi-port). See
      // setSpawnDashboardPiPort in process-manager.ts.
      {
        const { setSpawnDashboardPiPort } = await import("./spawn-process/process-manager.js");
        setSpawnDashboardPiPort(config.piPort);
      }

      piGateway.start(config.piPort, config.host);

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
              registerPiHandler: (type, handler) => {
                const arr = pluginPiHandlers.get(type) ?? [];
                arr.push(handler);
                pluginPiHandlers.set(type, arr);
              },
              onEvent: (handler) => {
                pluginRawEventSubs.add(handler);
                return () => pluginRawEventSubs.delete(handler);
              },
              onSessionEnded: (handler) => {
                pluginSessionEndSubs.add(handler);
                return () => pluginSessionEndSubs.delete(handler);
              },
              sendToSession: (sessionId, text) =>
                piGateway.sendToSession(sessionId, { type: "send_prompt", sessionId, text }),
              // Session-spawn hook. Gated to first-party/trusted plugins
              // (priority <= 100 by convention). Untrusted plugins get a
              // hook that always rejects. See change: add-automation-plugin.
              spawnSession: async (opts) => {
                const trusted = (plugin.manifest.priority ?? 1000) <= 100;
                if (!trusted) {
                  return { success: false, message: `spawn not permitted for plugin "${plugin.manifest.id}"` };
                }
                if (opts.automationRun) {
                  pendingAutomationRunRegistry.enqueue(opts.cwd, opts.automationRun);
                }
                // mode/sandbox threading (change: redesign-automation-editor-and-board).
                // DOCUMENTED LIMITATION (task 4.2): the host hook does not yet
                // enforce these. `worktree` would need ephemeral worktree
                // create+cleanup wired to run-end correlation (discard/merge
                // policy unspecified); pi exposes no `--sandbox` flag so the
                // sandbox level cannot be applied at spawn. Both fall back to
                // running in-place at `opts.cwd`. Log non-default requests so
                // the gap is visible until the host gains support.
                if (opts.mode === "worktree" || (opts.sandbox && opts.sandbox !== "workspace-write")) {
                  console.warn(
                    `[plugin-spawn] mode=${opts.mode ?? "local"} sandbox=${opts.sandbox ?? "(default)"} requested but not yet enforced by the host hook; running in-place at ${opts.cwd}`,
                  );
                }
                try {
                  const result = await spawnPiSession(opts.cwd, {
                    strategy: "headless",
                    ...(opts.model ? { model: opts.model } : {}),
                    // Flow/automation runs know an intended name — set it at
                    // creation via `--name`. See change: adopt-pi-074-080-features.
                    ...(opts.automationRun?.name ? { name: opts.automationRun.name } : {}),
                  });
                  if (result.process && result.pid) {
                    browserGateway.headlessPidRegistry.register(
                      result.pid,
                      opts.cwd,
                      result.process,
                      result.spawnToken,
                      keeperOptsFromSpawnResult(result),
                    );
                  }
                  return {
                    success: result.success,
                    message: result.message,
                    ...(result.spawnToken ? { spawnToken: result.spawnToken } : {}),
                  };
                } catch (err) {
                  return { success: false, message: err instanceof Error ? err.message : String(err) };
                }
              },
              // Session-abort hook. Gated to first-party/trusted plugins
              // (priority <= 100), mirroring `spawnSession`. Untrusted plugins
              // get a hook that returns false without sending anything.
              // See change: automation-ui-mockup-parity.
              abortSession: (sessionId) => {
                const trusted = (plugin.manifest.priority ?? 1000) <= 100;
                if (!trusted) return false;
                return piGateway.sendToSession(sessionId, { type: "abort", sessionId });
              },
              // Terminate an automation run's spawned session. Same trust
              // gate as spawnSession/abortSession. `graceful` sends a clean-
              // exit {type:"shutdown"} hint AND escalates via the kill
              // ladder (mirroring handleShutdown — the hint is dropped when
              // the bridge WS is not OPEN, so the kill is the guarantee).
              // Hard path kills by sessionId, falling back to spawnToken for
              // a run spawned but not yet registered.
              // See change: fix-automation-stop-zombie-runs.
              abortSpawnedRun: async ({ sessionId, spawnToken, graceful }) => {
                const trusted = (plugin.manifest.priority ?? 1000) <= 100;
                if (!trusted) return false;
                const reg = browserGateway.headlessPidRegistry;
                if (graceful && sessionId) {
                  piGateway.sendToSession(sessionId, { type: "shutdown", sessionId });
                  return reg.killBySessionId(sessionId);
                }
                if (sessionId) {
                  const killed = await reg.killBySessionId(sessionId);
                  if (killed) return true;
                  if (spawnToken) return reg.killByToken(spawnToken);
                  return false;
                }
                if (spawnToken) return reg.killByToken(spawnToken);
                return false;
              },
              // Emit a configured pi event into a session (relayed as a
              // `plugin_emit_event` control message; the in-session bridge
              // re-emits it on pi.events). Same trust gate as abortSession.
              // See change: automation-emit-configured-event.
              emitEventToSession: (sessionId, eventType, data) => {
                const trusted = (plugin.manifest.priority ?? 1000) <= 100;
                if (!trusted) return false;
                if (typeof eventType !== "string" || eventType.length === 0) return false;
                return piGateway.sendToSession(sessionId, {
                  type: "plugin_emit_event",
                  sessionId,
                  eventType,
                  data: data ?? {},
                });
              },
              provide: (name, value) => { pluginServiceRegistry.set(name, value); },
              consume: <T = unknown>(name: string) =>
                pluginServiceRegistry.get(name) as T | undefined,
              // Prefix enumeration for publish/collect (in-process only).
              // See change: decouple-automation-action-registry.
              consumeAll: <T = unknown>(prefix: string) => {
                const out: Array<{ key: string; value: T }> = [];
                for (const [key, value] of pluginServiceRegistry) {
                  if (key.startsWith(prefix)) out.push({ key, value: value as T });
                }
                return out;
              },
              // plugin_action fans out by pluginId (manifest-authoritative, not
              // self-declared) so multiple plugins coexist; other custom types
              // stay single-owner. See change: fix-plugin-action-fanout-and-handlers.
              registerBrowserHandler: (type, handler) =>
                type === "plugin_action"
                  ? browserGateway.registerPluginActionHandler(
                      plugin.manifest.id,
                      (msg, ws) => handler(msg, ws as unknown),
                    )
                  : browserGateway.registerHandler(type, (msg, ws) =>
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
        const secWsProtocol = request.headers["sec-websocket-protocol"] as string | undefined;
        // Ephemeral single-use ticket (D11) bound to the requested WS route
        // scope. Origin check is defense-in-depth only (absent-Origin exists),
        // never the sole gate.
        const scope = routeScopeForUrl(request.url);
        const ticket = extractTicket(request.url, secWsProtocol);
        const consumeTicket = (t: string, s: WsRouteScope) => wsTicketStore.consume(t, s);
        const wsHeaders = request.headers as unknown as Record<string, unknown>;
        if (config.authConfig?.secret) {
          if (!validateWsUpgrade(request.headers.cookie, remoteAddress, config.authConfig.secret, trusted, { ticket, scope, consumeTicket, headers: wsHeaders, localToken })) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }
        } else if (
          !isGenuinelyLocal(remoteAddress, wsHeaders) &&
          !verifyLocalToken(wsHeaders, localToken) &&
          (trusted.length === 0 || !isBypassedHost(remoteAddress, trusted)) &&
          !(scope && ticket && consumeTicket(ticket, scope))
        ) {
          // No auth configured — allow genuine-local, local-IPC token, trusted
          // networks, or a valid single-use ticket. A tunnel presenting as
          // 127.0.0.1 (forwarding header) is NOT trusted (D10, narrowed).
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }

        // Route on the already-computed `scope` (the single source of truth
        // for "which gateway"), NOT on `request.url` — the raw URL carries the
        // `?ticket=` query a paired device appends (F6), so an exact-match on
        // "/ws" would destroy the authorized upgrade. `routeScopeForUrl` strips
        // the query, so scope stays query-string-safe by construction and
        // auth-scope + routing-scope cannot drift.
        switch (scope) {
          case "browser":
            browserGateway.wss.handleUpgrade(request, socket, head, (ws) => {
              browserGateway.wss.emit("connection", ws, request);
            });
            break;
          case "terminal":
            terminalGateway.handleUpgrade(request, socket, head);
            break;
          case "live":
            handleLiveServerUpgrade(liveServerManager, request, socket, head);
            break;
          default:
            socket.destroy();
        }
      });

      await fastify.listen({ port: config.port, host: config.host });
      writePid(process.pid);
      console.log(`Dashboard server running at http://${config.host}:${config.port}`);
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

      // Opt-out for isolated / CI runs: PI_DASHBOARD_NO_MDNS=1 keeps the
      // server network-silent (no multicast advertise, no peer browser) so a
      // test instance never leaks onto the LAN or pollutes a live dashboard's
      // peer list. NOTE: test-infra, not part of auto-hide-headless-worker-sessions.
      const rawNoMdns = (process.env.PI_DASHBOARD_NO_MDNS ?? "").trim().toLowerCase();
      const mdnsDisabled = rawNoMdns === "1" || rawNoMdns === "true" || rawNoMdns === "yes";

      // Advertise via mDNS
      try {
        if (mdnsDisabled) {
          console.log("mDNS: advertising disabled (PI_DASHBOARD_NO_MDNS)");
        } else {
          advertiseDashboard(config.port, config.piPort);
          console.log(`mDNS: advertising _pi-dashboard._tcp on port ${config.port}`);
        }
      } catch (err) {
        console.warn(`mDNS advertisement failed (will continue without):`, err);
      }

      // Start continuous mDNS browser for peer discovery
      try {
        if (mdnsDisabled) {
          // skip peer discovery entirely
        } else {
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
        }
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
          // v2: resolve the reserved NAME (stored or minted-when-persistent),
          // cache it so watchdog recycles reuse the SAME name (stable URL).
          const reservedName = ensureReservedName({
            reservedName: config.tunnelReservedName,
            persistent: config.tunnelPersistent,
          });
          config.tunnelReservedName = reservedName;
          const tunnelUrl = await createTunnel(config.port, reservedName);
          if (tunnelUrl) {
            console.log(`🌐 Tunnel: ${tunnelUrl}`);
            // Start the watchdog so a stale zrok edge connection is detected
            // and recycled automatically (preserves reserved name / URL).
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

      // Cold-start recovery offer. Gated by `reopenSessionsAfterShutdown`:
      //   off  → handled at classify time (candidates normalized to `ended`,
      //          so `recoveryCandidates` is empty here — this block is skipped)
      //   ask  → broadcast one recovery offer to all connected clients
      //   auto → resume every candidate via the existing resume flow
      // Concurrent acceptances are deduped by `pendingResumeIntents`
      // (last-write-wins) so a session spawns at most once.
      // See change: reopen-sessions-after-shutdown.
      if (recoveryCandidates.length > 0) {
        const mode = recoveryMode;
        if (mode === "ask") {
          pendingRecoveryOffer = {
            type: "recovery_offer",
            candidates: recoveryCandidates.map((s) => ({
              sessionId: s.id,
              name: s.name,
              cwd: s.cwd,
              model: s.model,
              liveEpoch: s.liveEpoch,
            })),
          };
          // Reaches any already-connected clients; onConnect replays to the rest.
          browserGateway.broadcastToAll(pendingRecoveryOffer);
          // Consume each offered candidate's on-disk liveness sentinel so the
          // offer is shown ONCE per dirty boot: a later cold start (no NEW
          // unclean shutdown) will NOT re-classify these sessions, regardless
          // of whether the user reopens, dismisses (×), or just hides the
          // session card. Without this, `restore()`'s in-memory-only
          // normalization leaves `live:true` on disk, so every cold boot
          // re-offers a session the user already dealt with (the phantom).
          // The in-memory `pendingRecoveryOffer` still drives within-boot
          // reconnect replay; Reopen re-stamps `{live:true,liveEpoch}` on the
          // resumed session's next activity (event-wiring). Mirrors the
          // marker clears in `recovery_dismiss` and clean `stop()`.
          // See change: fix-recovery-offer-dismiss-and-phantom-reopen.
          for (const cand of recoveryCandidates) {
            if (cand.sessionFile) metaPersistence.setLiveness(cand.sessionFile, { live: false });
          }
        } else if (mode === "auto") {
          const resumeConfig = loadConfig();
          for (const cand of recoveryCandidates) {
            if (!cand.sessionFile) continue;
            // Tag the resume intent so the ended→alive reattach branch keeps
            // the slot; dedupes concurrent acceptances. Mirrors the core of
            // handleResumeSession (no ws at cold start).
            pendingResumeIntents.record(cand.id, "keep");
            const result = await spawnPiSession(cand.cwd, {
              sessionFile: cand.sessionFile,
              mode: "continue",
              strategy: resumeConfig.spawnStrategy,
            });
            if (result.process && result.pid) {
              browserGateway.headlessPidRegistry.register(
                result.pid,
                cand.cwd,
                result.process,
                result.spawnToken,
                keeperOptsFromSpawnResult(result),
              );
            }
            if (result.dashboardSpawned && result.success) {
              pendingDashboardSpawns.set(cand.cwd, (pendingDashboardSpawns.get(cand.cwd) ?? 0) + 1);
            }
          }
        }
        // mode === "off": no-op.
      }
    },

    async stop() {
      // Stop the event-loop-delay monitor so the libuv timer doesn't linger
      // after teardown. See change: instrument-session-hydration-timing.
      try { eventLoopDelayHistogram.disable(); } catch { /* ignore */ }
      // Stop the dedicated ELD safety-net sampler + its histogram.
      // See change: attribute-openspec-poll-eventloop-stalls.
      try { eventLoopSampler.stop(); } catch { /* ignore */ }
      // Stop mDNS before closing
      try {
        if (mdnsBrowser) { mdnsBrowser.stop(); mdnsBrowser = null; }
        stopAdvertising();
      } catch { /* ignore mDNS cleanup errors */ }
      removePid();
      idleTimer.cancel();
      directoryService.stopPolling();
      browserGateway.shutdownHeadlessProcesses();
      // Clean teardown (idle timer / app quit) is intentional: clear the
      // liveness marker for every still-running session so cold start does
      // NOT classify them as interrupted recovery candidates. No
      // `closedReason` — this is a clean stop, not a manual close.
      // See change: reopen-sessions-after-shutdown.
      for (const s of sessionManager.listActive()) {
        if (s.sessionFile) metaPersistence.setLiveness(s.sessionFile, { live: false });
      }
      metaPersistence.flushAll();
      metaPersistence.dispose();
      // Cancel the deferred boot reconcile + dispose supervisor (pending backoff
      // timers) so a create/stop cycle in one process leaves no stale timer.
      // See change: add-goal-session-supervisor.
      clearTimeout(bootReconcileTimer);
      goalSupervisor?.dispose();
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
      // Close any pending OAuth callback servers
      try { const { closeAllCallbackServers } = await import("./auth/oauth-callback-server.js"); await closeAllCallbackServers(); } catch {}
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
