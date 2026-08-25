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
import { isRecoveryAllowed } from "@blackbelt-technology/pi-dashboard-shared/boot-state.js";
import { findBundledExtension, registerBridgeExtension } from "@blackbelt-technology/pi-dashboard-shared/bridge-register.js";
import type { AuthConfig, DashboardConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { CONFIG_FILE, getPluginConfig as getPluginConfigFromFile, loadConfig, resolvePublicBaseUrls } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { advertiseDashboard, createBrowser, type DashboardBrowser, type DiscoveredServer, stopAdvertising } from "@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js";
import { setWindowsGitSourceSetting } from "@blackbelt-technology/pi-dashboard-shared/platform/git-source.js";
import {
  reconcilePluginBridgePackages,
  registerAllPluginBridges,
} from "@blackbelt-technology/pi-dashboard-shared/plugin-bridge-register.js";
import { RECOVERY_REATTACH_GRACE_MS } from "@blackbelt-technology/pi-dashboard-shared/recovery-timing.js";
import { isRecoveryCandidate, mergeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import compress from "@fastify/compress";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { createFitWorkerPool } from "./attachments/fit-worker-pool.js";
import { registerAuthPlugin, validateWsUpgrade } from "./auth/auth-plugin.js";
import { registerBearerAuth } from "./auth/bearer-auth.js";
import {
  computeBindReachability,
  formatBindReachabilityWarning,
  initBindReachability,
} from "./auth/bind-reachability-service.js";
import { decideBridgeTicketMint } from "./auth/bridge-ticket-eligibility.js";
import { isCorsOriginAllowed } from "./auth/cors-origin.js";
import { readAuthJson } from "./auth/provider-auth-storage.js";
import { registerCsp, resolveCspMode } from "./auth/csp.js";
import { ensureServerIdentity } from "./auth/identity.js";
import { ensureLocalToken, verifyLocalToken } from "./auth/local-token.js";
import { createNetworkGuard, isBypassedHost, isGenuinelyLocal } from "./auth/localhost-guard.js";
import { mintSpawnToken } from "./auth/spawn-token.js";
import { extractTicket, routeScopeForUrl, type WsRouteScope, WsTicketStore } from "./auth/ws-ticket.js";
import {
  buildDispatchReloadContext,
  type ReloadHostContext,
  respawnForRuntimeSwap,
} from "./browser-handlers/session-action-handler.js";
import { createCommitDraftRelay } from "./commit-draft-relay.js";
import { writeConfigPartial } from "./config-api.js";
import { liveCorsAllowedOrigins, liveTrustedNetworks } from "./config-snapshot.js";
// pending-load-manager removed — server loads sessions directly via DirectoryService
import { createDirectoryService, type DirectoryService } from "./directory-service.js";
import { createEmbedLifecycleController } from "./embed-lifecycle/embed-lifecycle-controller.js";
import { wireEvents } from "./event-wiring.js";
import { createFileWatchManager } from "./file-watch-manager.js";
import { createWorktreeInitRegistry } from "./git-worktree/worktree-init-registry.js";
import { decorateGoalsWithSpend } from "./goal/decorate-goals-spend.js";
import { decideBudgetHalt } from "./goal/goal-budget-guard.js";
import { buildGoalReprime, primeGoalSession } from "./goal/goal-session-primer.js";
import { createGoalStatusProjector } from "./goal/goal-status-projector.js";
import { createGoalStore } from "./goal/goal-store.js";
import { createGoalSupervisor, type GoalDriverSpawnRequest, type GoalSupervisor } from "./goal/goal-supervisor.js";
import { createGoalVerdictAccumulator } from "./goal/goal-verdict-accumulator.js";
import { runBoundedStartup } from "./lifecycle/bounded-startup.js";
import { ensureInstanceId } from "./lifecycle/instance-id.js";
import { createLiveServerManager } from "./live-server/live-server-manager.js";
import { handleLiveServerUpgrade, registerLiveServerProxy } from "./live-server/live-server-proxy.js";
import { startEventLoopSampler } from "./metrics/eventloop-sampler.js";
import { createEventLoopSpikeMetrics } from "./metrics/eventloop-spike-metrics.js";
import { createHydrationMetrics } from "./metrics/hydration-metrics.js";
import { createModelProxyAuthGate } from "./model-proxy/auth-gate.js";
import { getModelRegistry, getStreamSimpleFn } from "./model-proxy/registry-singleton.js";
import { createOpenSpecGroupStore, joinGroupIdsToOpenSpecData } from "./openspec/openspec-group-store.js";
import { PackageManagerWrapper } from "./package/package-manager-wrapper.js";
import { type BrowserGateway, createBrowserGateway } from "./pairing/browser-gateway.js";
import { PairedDeviceRegistry } from "./pairing/paired-devices.js";
import { PairingManager } from "./pairing/pairing.js";
import { createPendingAttachRegistry } from "./pending/pending-attach-registry.js";
import { createPendingAutomationRunRegistry } from "./pending/pending-automation-run-registry.js";
import { createPendingClientCorrelations } from "./pending/pending-client-correlations.js";
import { createPendingForkRegistry, type PendingForkRegistry } from "./pending/pending-fork-registry.js";
import { createPendingGoalLinkRegistry } from "./pending/pending-goal-link-registry.js";
import { createPendingInitialPromptRegistry } from "./pending/pending-initial-prompt-registry.js";
import { createPendingPromptAcks } from "./pending/pending-prompt-acks.js";
import { createPendingResumeIntentRegistry } from "./pending/pending-resume-intent-registry.js";
import { createPendingWorktreeBaseRegistry } from "./pending/pending-worktree-base-registry.js";
import { recordExitIntent, resolveExitIntent, stampBootStart } from "./persistence/boot-state.js";
import { createMemoryEventStore, DEFAULT_MAX_EVENT_DATA_SIZE, type EventStore } from "./persistence/memory-event-store.js";
import { createMetaPersistence, type MetaPersistence } from "./persistence/meta-persistence.js";
import { needsMigration, runMigration } from "./persistence/migrate-persistence.js";
import { createPreferencesStore, type PreferencesStore } from "./persistence/preferences-store.js";
import { PiCoreChecker } from "./pi/pi-core-checker.js";
import { PiCoreUpdater } from "./pi/pi-core-updater.js";
import { createPiGateway, type PiGateway } from "./pi/pi-gateway.js";
import { pluginIntentCache } from "./plugin-intent-cache.js";
import { registerAttachmentRoutes } from "./routes/attachment-routes.js";
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
import { registerPiRetryRoutes } from "./routes/pi-retry-routes.js";
import { registerPiRuntimeRoutes } from "./routes/pi-runtime-routes.js";
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
import {
  dispatchReload as dispatchReloadRaw,
  reloadTargetSessionIds,
} from "./rpc-keeper/dispatch-reload.js";
import { deriveEndedAt } from "./session/derive-ended-at.js";
import { createMemorySessionManager, type SessionManager } from "./session/memory-session-manager.js";
import { applyReattachPolicy } from "./session/reattach-placement.js";
import { reconcileSessionOrder } from "./session/reconcile-session-order.js";
import { createRemoteTranscriptStore } from "./session/remote-transcript-store.js";
import { resolveOrderKey } from "./session/resolve-order-key.js";
import { registerSessionApi } from "./session/session-api.js";
import { discoverAndBroadcastSessions } from "./session/session-bootstrap.js";
import { createSessionOrderManager, type SessionOrderManager } from "./session/session-order-manager.js";
import { scanAllSessions } from "./session/session-scanner.js";
import { sessionToMeta } from "./session/session-to-meta.js";
import { keeperOptsFromSpawnResult } from "./spawn-process/headless-pid-registry.js";
import { createIdleTimer } from "./spawn-process/idle-timer.js";
import { spawnPiSession } from "./spawn-process/process-manager.js";
import { removePid, writePid } from "./spawn-process/server-pid.js";
import { armSpawnWatchdog } from "./spawn-process/spawn-register-watchdog.js";
import { createTerminalGateway, type TerminalGateway } from "./terminal/terminal-gateway.js";
import { createTerminalManager, deriveTranscriptCapBytes, type TerminalManager } from "./terminal/terminal-manager.js";
import { cleanupStaleZrok, createTunnel, deleteTunnel, detectZrokBinary, ensureReservedName, getTunnelUrl, liveTunnelOrigins, scavengeOrphanZrokProcesses } from "./tunnel/tunnel.js";
import { startTunnelWatchdog, stopTunnelWatchdog } from "./tunnel/tunnel-watchdog.js";

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
  /**
   * The raw `--host` flag, or `null`. Retained so `pendingBindHost` can
   * re-resolve the full chain against the current config — a flag wins on the
   * next start too. See change: warn-unreachable-trusted-networks.
   */
  hostFlag?: string | null;
  /**
   * Bind the gateway's TCP listener. Defaults to the `PI_GATEWAY_TCP` opt-in;
   * the POSIX default is socket-only (D10, task 8.1). Explicit here so a test
   * server can exercise the TCP path without mutating process env.
   */
  gatewayTcp?: boolean;
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
  /**
   * The whole normalized `tunnel` block. Carried so the readiness board and the
   * concurrency resolver can read per-provider `enabled`/`mode` and zerotier's
   * `networkId` without re-loading config on every poll tick.
   * See change: add-zrok-custom-reserved-name.
   */
  tunnelConfig?: DashboardConfig["tunnel"];
  authConfig?: AuthConfig;
  /** Override WS ping interval for pi-gateway (ms). Default 60000. Set 0 to disable. */
  pingInterval?: number;
  /** Memory limit overrides from config */
  maxEventsPerSession?: number;
  maxStringFieldSize?: number;
  /** Override the event-store per-event data byte ceiling. Default DEFAULT_MAX_EVENT_DATA_SIZE. */
  maxEventDataSize?: number;
  maxWsBufferBytes?: number;
  /** Max events replayed on a FULL-stream browser subscribe (0 = unlimited).
   *  See change: lazy-load-session-history. */
  maxReplayEvents?: number;
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
  /**
   * Boot the server. Always tears down already-opened listeners when a startup
   * step fails. Pass `deadlineMs` to ALSO bound a startup that never settles —
   * `cli.ts` does, for the standalone process. In-process callers own the
   * lifetime themselves and default to no deadline.
   */
  start(opts?: { deadlineMs?: number | null }): Promise<void>;
  /**
   * @internal The raw startup body. `start()` wraps it in `runBoundedStartup`
   * so a step that throws or hangs after `piGateway.start()` cannot leave the
   * process resident holding the gateway port.
   * See change: fix-worktree-server-autostart-leak.
   */
  _startCore(): Promise<void>;
  stop(): Promise<void>;
  /**
   * Flush pending session-metadata + preference writes WITHOUT tearing the
   * server down. Used by the signal handler, where the process is about to
   * die anyway and a full `stop()` (which SIGTERMs every spawned pi) would be
   * the wrong teardown. See change: fix-recovery-exit-intent (D4).
   */
  flush(): void;
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
      urls.push(...resolvePublicBaseUrls(loadConfig()));
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
  // Open this boot's record BEFORE classification: the previous boot rolls
  // into the ring, so each restored session's `liveEpoch` resolves to the
  // intent that ended the boot which owned it.
  // See change: fix-recovery-exit-intent.
  stampBootStart(liveEpoch);
  const sessionOrderManager = createSessionOrderManager(preferencesStore);
  const pendingForkRegistry = createPendingForkRegistry();
  // Maps spawnToken → originating browser requestId. Surfaced as
  // session_added.spawnRequestId so the client can auto-select / dismiss
  // its placeholder by exact correlation. See change: spawn-correlation-token.
  const pendingClientCorrelations = createPendingClientCorrelations();
  // Prompts written to a bridge socket and awaiting its acknowledgement, so a
  // REST caller can tell "pi accepted it" from "a byte left the server".
  // See change: fix-spawn-correlation-ttl-coupling (D7).
  const pendingPromptAcks = createPendingPromptAcks();

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
    // Positive `exitIntent` gate: a boot that ended by `/api/restart` or
    // `/api/shutdown` left its sessions RUNNING and told every bridge to stay
    // away for longer than the reattach grace window, so those sessions will
    // reattach — after any window that could retract them. Suppress outright,
    // with no timing dependency. See change: fix-recovery-exit-intent.
    const ownerIntent = resolveExitIntent(session.liveEpoch);
    const diskCandidate = recoveryMode !== "off" && isRecoveryCandidate({
      live: session.live,
      status: session.status,
      closedReason: session.closedReason,
      kind: session.kind,
    });
    const candidate = diskCandidate && isRecoveryAllowed(ownerIntent);
    if (diskCandidate && !candidate) {
      console.info(
        `[recovery] ${session.id}: suppressed-by-intent (boot ${session.liveEpoch} exited via ${ownerIntent})`,
      );
    }
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
      // One rule for every reconstructed session: `Date.now()` here asserted a
      // session ended at boot when it ended weeks earlier, and fed the ended-tier
      // order seed. See change: fix-ended-session-missing-endedat.
      restored.endedAt = restored.endedAt ?? deriveEndedAt(restored);
    }
    sessionManager.restore(restored);
  }
  if (scanResult.cacheUpdates > 0) {
    console.log(`[dashboard] Session scan: ${scanResult.sessions.length} sessions, ${scanResult.cacheUpdates} cache updates`);
  }

  // Liveness-gated recovery (change: fix-recovery-offer-bridge-liveness-gate).
  // Candidates still eligible to be OFFERED (`ask`) or RESUMED (`auto`), keyed
  // by sessionId. Disk-only classification (`recoveryCandidates`) cannot tell a
  // plain restart (process survived) from a crash (process gone). A candidate is
  // removed from this map — and its on-disk marker consumed — the moment a
  // process-carrier proves it alive: synchronously by the keeper reclaim
  // (Class 1, in `start()`) or asynchronously when its bridge comes alive within
  // `RECOVERY_REATTACH_GRACE_MS` (Class 2, via the `onChange` retract check
  // below). After the grace window the map is finalized (cleared).
  const liveRecoveryCandidates = new Map<string, DashboardSession>(
    recoveryCandidates.map((c) => [c.id, c]),
  );
  if (liveRecoveryCandidates.size > 0) {
    console.info(`[recovery] ${liveRecoveryCandidates.size} candidate(s) after the exit-intent gate; awaiting liveness`);
  }
  let recoveryOfferBroadcast = false;
  let recoveryGraceTimer: ReturnType<typeof setTimeout> | undefined;

  // Save per-session .meta.json on any change. The meta payload is an EXPLICIT
  // field enumeration (`sessionToMeta`) written as a FULL overwrite — omitting a
  // field there wipes it on the next unrelated save. See change: add-session-tags.
  sessionManager.onChange = (sessionId: string, ctx) => {
    const session = sessionManager.get(sessionId);
    if (!session?.sessionFile) return;
    // Class 2 liveness gate (change: fix-recovery-offer-bridge-liveness-gate).
    // A pending recovery candidate that comes alive (its bridge reattached /
    // process re-registered) is a plain-restart survivor, not a loss. Retract
    // it: drop from the eligible set, consume its marker, and rebuild an
    // already-broadcast offer. Keyed on the ended→alive fact, not
    // `registerReason` — tmux/TUI/mDNS bridges re-register without one.
    if (session.status !== "ended" && liveRecoveryCandidates.has(sessionId)) {
      retractRecoveryCandidate(sessionId, "bridge-reattach");
    }
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

  /** This process's place in the per-HOME rendezvous (task 2.0a). */
  let homeRendezvous: import("./lifecycle/home-rendezvous.js").HomeRendezvous | null = null;

  const piGateway = createPiGateway(sessionManager, {
    ...(config.pingInterval !== undefined ? { pingInterval: config.pingInterval } : {}),
    // The identity a move TARGET announces on `provisional_accepted`, so the
    // mover can prove it reached the instance it named (D14). Unset, every
    // destination reported "" and the coordinator's identity check compared
    // empty strings — verification that always passes verifies nothing.
    instanceId: ensureInstanceId(undefined, config.piPort),
    // Every TCP bridge upgrade passes the auth gate (D10b, task 6.3). Without
    // it the gateway accepts anything that can reach it and lets it register
    // an arbitrary sessionId — harmless on loopback, fatal as the container's
    // `0.0.0.0:9999` default. The unix socket is exempt by design: the kernel
    // already decided (D5).
    bridgeAuth: {
      consumeTicket: (ticket) => wsTicketStore.consumeDetailed(ticket, "bridge"),
      // The D10b deprecation window is open: a tokenless LOOPBACK bridge is
      // still accepted (and logged) through 0.9.x, refused from 1.0.0. Remote
      // peers never get that grace.
      requireTicketOnLoopback: false,
      // A loopback bridge that presents the local token is authorised on its
      // own credential rather than on the grace — the only local credential
      // Windows has, since it gets no unix socket (D6, task 5.3).
      verifyLocalToken: (headers) => verifyLocalToken(headers, localToken),
    },
  });

  // Relay for AI-drafted commit messages (bridge fork-subagent ↔ HTTP).
  // See change: add-session-uncommitted-indicator-and-commit.
  const commitDraftRelay = createCommitDraftRelay();

  // ONE ceiling value feeds both the store and the transcript budget derived
  // from it — threading it into only one of the two is the silent drift D2a
  // exists to prevent. See change: preserve-inline-terminal-transcript.
  const eventDataCeiling = config.maxEventDataSize ?? DEFAULT_MAX_EVENT_DATA_SIZE;

  // Create event store with pinning callback and configurable limits
  const eventStore = createMemoryEventStore(
    (sessionId) =>
      piGateway.isSessionConnected(sessionId) ||
      browserGateway.getSubscriberCount(sessionId) > 0,
    undefined, // maxCachedSessions (use default)
    config.maxEventsPerSession,
    config.maxStringFieldSize,
    eventDataCeiling,
  );

  // Derive the inline-terminal transcript byte budget from the event-store
  // ceiling (75 %), so the capped transcript can never trip the store's size
  // clamp and destroy the `terminalId`. Assert both truncation knobs are safe
  // at boot rather than silently corrupting close events months later.
  // See change: preserve-inline-terminal-transcript (D2a/D2b).
  // Pass the config value THROUGH (undefined when unset) so the assert resolves
  // it to the store's real default. `?? 0` previously coerced an unset cap to
  // the sentinel that means "string pass disabled", which made the assert skip
  // the production configuration entirely.
  // See change: fit-attachments-for-display (task 5.5).
  const transcriptCapBytes = deriveTranscriptCapBytes(
    eventDataCeiling,
    config.maxStringFieldSize,
  );

  // Display-fit pool for inline image attachments. Sized small on purpose:
  // fitting is bursty (a paste at a time), and each worker holds a decoded
  // bitmap, so more slots buy latency we do not need at the cost of RSS we do.
  // See change: fit-attachments-for-display (task 5.1).
  const fitWorkerPool = createFitWorkerPool({ size: 2 });

  // Create terminal manager with exit callback
  const terminalManager = createTerminalManager({
    transcriptCapBytes,
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

  const browserGateway = createBrowserGateway(sessionManager, eventStore, piGateway, undefined, pendingForkRegistry, sessionOrderManager, preferencesStore, directoryService, terminalManager, pendingDashboardSpawns, config.maxWsBufferBytes, pendingAttachRegistry, pendingInitialPromptRegistry, pendingResumeIntents, pendingClientCorrelations, pendingWorktreeBaseRegistry, metaPersistence, fitWorkerPool, config.maxReplayEvents);

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
  // The resume handler refuses a `continue` reopen while a candidate's liveness
  // is still unresolved (grace window open), closing the Class-2 double-spawn
  // race even for non-UI clients. Membership in `liveRecoveryCandidates` IS the
  // pending signal: dead candidates leave when the window finalizes (map clear),
  // reattached ones leave on retract. See change: fix-recovery-offer-bridge-liveness-gate.
  browserGateway.isRecoveryLivenessPending = (sessionId: string) =>
    liveRecoveryCandidates.has(sessionId);

  // Epoch-ms deadline the ask-mode offer carries so the client can render a
  // non-actionable "verifying…" state until Class-2 liveness is finalized.
  // Set once at broadcast; reused when an offer is rebuilt on retract.
  let recoveryGraceUntil: number | undefined;

  // Build a recovery_offer wire message from the eligible candidate set.
  // See change: fix-recovery-offer-bridge-liveness-gate.
  function buildRecoveryOffer(
    candidates: DashboardSession[],
  ): import("@blackbelt-technology/pi-dashboard-shared/browser-protocol.js").RecoveryOfferMessage {
    return {
      type: "recovery_offer",
      candidates: candidates.map((s) => ({
        sessionId: s.id,
        name: s.name,
        cwd: s.cwd,
        model: s.model,
        liveEpoch: s.liveEpoch,
      })),
      graceUntil: recoveryGraceUntil,
    };
  }

  // Retract a still-pending recovery candidate proven alive (keeper reclaim or
  // bridge reattach). Idempotent: no-op once the candidate has left the eligible
  // set (already retracted, or the grace window finalized the map). Consumes the
  // on-disk liveness marker exactly like dismiss / clean stop, so a later cold
  // boot with no NEW unclean shutdown does not re-offer it. When an offer was
  // already broadcast, the held/replayed offer is rebuilt so a client connecting
  // afterward never sees the retracted candidate.
  // See change: fix-recovery-offer-bridge-liveness-gate.
  function retractRecoveryCandidate(sessionId: string, reason: string): void {
    const cand = liveRecoveryCandidates.get(sessionId);
    if (!cand) return;
    liveRecoveryCandidates.delete(sessionId);
    if (cand.sessionFile) metaPersistence.setLiveness(cand.sessionFile, { live: false });
    console.info(
      `[recovery] retracted candidate ${sessionId} (${reason}); ${liveRecoveryCandidates.size} still pending`,
    );
    if (!recoveryOfferBroadcast) return;
    if (liveRecoveryCandidates.size === 0) {
      pendingRecoveryOffer = null;
      browserGateway.broadcastToAll(buildRecoveryOffer([]));
    } else {
      pendingRecoveryOffer = buildRecoveryOffer([...liveRecoveryCandidates.values()]);
      browserGateway.broadcastToAll(pendingRecoveryOffer);
    }
  }

  // Plugin pi-message dispatch registry + raw-event subscribers.
  // Populated by ServerPluginContext.registerPiHandler / onEvent (see the
  // createContext block below); consumed by wireEvents — `plugin_pi_message`
  // envelopes route to handlers by messageType; every `event_forward` fans
  // out to raw-event subscribers. See change: add-goal-continuation-plugin.
  const pluginPiHandlers = new Map<string, Array<(msg: unknown, sessionId: string) => void>>();
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
  // Host services consumed by mcp-server-plugin. Registered HERE because the
  // plugin must verify a device bearer WITHOUT going through the global
  // `onRequest` hook — `/mcp` deliberately does not trust
  // `request.isAuthenticated`, so it needs the registry directly.
  // See change: add-dashboard-mcp-server.
  pluginServiceRegistry.set(
    "host.verifyDeviceToken",
    (token: string): string | null => pairedDeviceRegistry.verify(token),
  );
  // Prefers the BOUND port, falls back to the CONFIGURED one.
  //
  // Both halves are needed. Plugins consume this during `registerPlugin`, which
  // runs before `fastify.listen`, so the bound address is still null then and a
  // bound-only getter would silently yield nothing (mcp-server-plugin would
  // provision a URL hardcoded to 8000 regardless of `--port`). `config.port` is
  // known at load and is right for every case except `port: 0`, where the
  // caller must read the getter again after listen to learn the real port.
  pluginServiceRegistry.set("host.httpPort", (): number | null => {
    const addr = fastify.server.address();
    if (addr && typeof addr === "object") return addr.port;
    return config.port || null;
  });

  // `sessionId` comes from the gateway's socket key, never from `msg`. A
  // plugin that attributes a message to a session (e.g. minting a session-
  // scoped credential) depends on that being unspoofable.
  // See change: add-dashboard-mcp-server.
  function dispatchPluginPiMessage(messageType: string, msg: unknown, sessionId: string): void {
    const arr = pluginPiHandlers.get(messageType);
    if (!arr) return;
    for (const h of arr) {
      try { h(msg, sessionId); } catch (err) { console.error("[plugin-pi-handler]", messageType, err); }
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
    remoteTranscriptStore: createRemoteTranscriptStore(),
    eventStore,
    fitWorkerPool,
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
    pendingPromptAcks,
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
  // (3) Both inputs are read from the mtime-gated config snapshot on every
  //     decision, NOT captured here. A gateway origin added at runtime has to
  //     apply without a restart, else the browser hits exactly the
  //     ERR_ABORTED module-script failure described in (1). See change:
  //     config-override-oauth-redirect-base (D15).
  const corsAllowedOrigins = () => liveCorsAllowedOrigins(config.corsAllowedOrigins ?? []);
  const corsTrustedNetworks = () => liveTrustedNetworks(config.resolvedTrustedNetworks ?? []);
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
        configuredOrigins: corsAllowedOrigins(),
        trustedNetworks: corsTrustedNetworks(),
        // The PRIMARY's URL, which is also what mints OAuth redirect URIs.
        getTunnelUrl,
        // Every OTHER live tunnel. Deliberately a separate input from
        // `getTunnelUrl`: widening who may READ a response must never widen
        // which single origin we mint OAuth URIs and set cookies for.
        // See change: add-zrok-custom-reserved-name (D4).
        getLiveTunnelOrigins: liveTunnelOrigins,
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
    pendingPromptAcks,
  });

  // Register route modules
  // Create network guard from merged trusted networks
  // Thunk, not a boot snapshot (D15): a CIDR added through the gateway action
  // must admit that range on the next request, with no restart.
  const networkGuard = createNetworkGuard(
    () => liveTrustedNetworks(config.resolvedTrustedNetworks ?? []),
    { localToken },
  );

  // ── Reload fan-out plumbing ───────────────────────────────────────────
  // Every automated reload trigger goes through the SAME ladder as the
  // reload button. Previously each hand-rolled a `sendToSession` loop over
  // `getConnectedSessionIds()`, which (a) bypassed the server-side
  // interception entirely and landed on the bridge's no-op reload, and
  // (b) could never target a headless session whose bridge WS had died.
  // See change: fix-out-of-band-reload.
  const reloadCtx = (): ReloadHostContext => ({
    sessionManager,
    eventStore,
    piGateway,
    headlessPidRegistry: browserGateway.headlessPidRegistry,
    broadcast: (msg) => browserGateway.broadcast(msg),
  });
  const dispatchReload = (sid: string) =>
    dispatchReloadRaw(sid, buildDispatchReloadContext(reloadCtx()));
  // No `status`-based filter here on purpose. Every id in this set is either
  // bridge-connected or registry-known, and BOTH are reloadable regardless of
  // what the session map says: a headless session whose bridge died is stamped
  // `ended` while its pi is alive, and a connected session can be forwarded to
  // over its live socket. Filtering on `status !== "ended"` dropped exactly the
  // sessions this change exists to reach.
  const reloadFanOutTargets = (): string[] =>
    reloadTargetSessionIds(
      piGateway.getConnectedSessionIds(),
      browserGateway.headlessPidRegistry,
    );

  registerSessionRoutes(fastify, { sessionManager, eventStore, networkGuard });
  // pi retry policy editor. Reload fan-out dispatches `/reload` to every
  // connected session so a saved policy applies without a manual restart
  // (pi reads its settings only at session construction). See change:
  // retry-forever-with-stop-control.
  registerPiRetryRoutes(fastify, {
    networkGuard,
    reloadConnectedSessions: () => {
      // Fire-and-forget by contract (the route answers with the target count,
      // not per-session outcomes), but the rejection is OWNED: `dispatchReload`
      // reports failures as terminal `command_feedback`, so a throw here is a
      // bug and must be logged rather than becoming an unhandled rejection.
      const ids = reloadFanOutTargets();
      for (const id of ids) {
        dispatchReload(id).catch((err) => {
          console.error(`[dashboard] retry-policy reload fan-out failed for ${id}:`, err);
        });
      }
      return ids.length;
    },
  });
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
  // Grammar routes moved into the grammar plugin's server entry
  // (packages/grammar-plugin/src/server), which registers
  // /api/grammar/* via ctx.fastify + ctx.modelRuntime. See change:
  // make-grammar-fully-plugin-contained.
  // Full-resolution attachment originals for click-to-zoom. Not load-bearing:
  // the fitted derivative is already inline, so a failure here degrades only
  // the zoom view. See change: fit-attachments-for-display (task 5.7).
  registerAttachmentRoutes(fastify, { sessionManager, networkGuard });
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
    // Decorate with read-time spend so the WS path is not a raw second delivery
    // path. See change: fix-goal-detail-turns-and-spend.
    browserGateway.broadcastToAll({ type: "goals_update", cwd, goals: decorateGoalsWithSpend(payload.goals, sessionManager) });
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
        // REST/goal spawn has no browser socket; the reclaim must run anyway.
        // See change: fix-duplicate-bridge-registration (D0/D2).
        armSpawnWatchdog(cwd, "headless", result);
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
      // REST resume — the path that minted the incident's duplicate.
      armSpawnWatchdog(req.cwd, "headless", result);
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

  // Embed-session-lifecycle: construct the reaper + observability metrics wired
  // to the live server components. Dormant unless config.embedLifecycle.enabled
  // (off by default) — construction/start is behavior-preserving on upgrade.
  // Reclaims the automation-produced ephemeral sessions #383 is about; the
  // acquire registry + caps are shared-layer modules the embed front constructs.
  // See change: add-embed-session-lifecycle.
  const embedLifecycle = createEmbedLifecycleController({
    config: () => loadConfig().embedLifecycle,
    listSessions: () => sessionManager.listAll(),
    getSubscriberCount: (id) => browserGateway.getSubscriberCount(id),
    listTerminalCwds: () => terminalManager.list().map((t) => t.cwd),
    hasPendingUiRequest: (id) => browserGateway.hasPendingUiRequest(id),
    hasPendingPromptRequests: (id) => browserGateway.hasPendingPromptRequests(id),
    killBySessionId: (id) => browserGateway.headlessPidRegistry.killBySessionId(id),
    sendStopAfterTurn: (id) =>
      piGateway.sendToSession(id, { type: "stop_after_turn", sessionId: id }),
  });

  registerSystemRoutes(fastify, { sessionManager, preferencesStore, metaPersistence, config, networkGuard, version: pkgVersion, directoryService, piGateway, browserGateway, hydrationMetrics, readEventLoopDelay, eventLoopSpikes, eventStore, embedLifecycle });
  // GET /api/doctor — see change: doctor-rich-output (task 4.2). Auth-gated identically to /api/config.
  registerDoctorRoutes(fastify);
  registerToolRoutes(fastify, { registry: getDefaultRegistry(), networkGuard });
  // Pi runtime discovery + atomic dual selection. See change: select-pi-runtime-install.
  registerPiRuntimeRoutes(fastify, { registry: getDefaultRegistry(), networkGuard });

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
      void refreshRequirementProbesFor(
        null,
        {
          listInstalled: () => packageManagerWrapper.listInstalled("global"),
        },
        (id) => getPluginConfigFromFile(loadConfig(), id) as Record<string, unknown>,
      ).then((changed) => {
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
    // Count only what actually reloaded: `dispatchReload` resolves "refused"
    // for a busy session and "error" when no path existed, and reporting those
    // as reloads is the same class of lie this change removes.
    let count = 0;
    for (const sid of reloadFanOutTargets()) {
      const outcome = await dispatchReload(sid);
      if (outcome === "respawn" || outcome === "forwarded") count++;
    }
    return count;
  });

  registerPackageRoutes(fastify, { packageManagerWrapper });
  registerResourceActivationRoutes(fastify, {
    networkGuard,
    piGateway,
    sessionManager,
    dispatchReload,
    registrySessions: () =>
      browserGateway.headlessPidRegistry
        .listSessions()
        .map((e) => ({ sessionId: e.sessionId, cwd: e.cwd })),
  });
  registerRecommendedRoutes(fastify, { packageManagerWrapper });

  // Pi core version check + update (complements the extension package manager).
  const piCoreChecker = new PiCoreChecker();
  const piCoreUpdater = new PiCoreUpdater({
    packageManagerWrapper,
    // pi-core is a BINARY swap, not a resource reload. Route to respawn
    // directly rather than through `dispatchReload`, whose busy check would
    // refuse a streaming session — a swap cannot be deferred that way, the
    // binary under it has already changed. Targets every session the registry
    // knows is headless, including connected and streaming ones.
    // See change: fix-out-of-band-reload (design.md D6).
    onAllComplete: async () => {
      let count = 0;
      for (const entry of browserGateway.headlessPidRegistry.listSessions()) {
        await respawnForRuntimeSwap(entry.sessionId, reloadCtx());
        count++;
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
      // `bridge` is mintable by any authenticated caller (networkGuard: a
      // paired device's durable bearer, a cookie, or a trusted network). The
      // bearer authenticates this REST call and never rides the socket
      // (task 6.2/6.4).
      if (scope !== "browser" && scope !== "terminal" && scope !== "live" && scope !== "bridge") {
        reply.code(400);
        return { success: false as const, error: "invalid scope" };
      }
      if (scope === "bridge") {
        // networkGuard's OR branches include a cookie session and any
        // trusted-network host; the bridge surface is more privileged than
        // `/ws` (it registers sessions and attributes events), so it is
        // narrowed to actual bridges (@review Audit, major).
        const verdict = decideBridgeTicketMint({
          authorization: request.headers.authorization,
          ip: request.ip,
          headers: request.headers as Record<string, unknown>,
          verifyDeviceBearer: (token) => pairedDeviceRegistry.verify(token),
        });
        if (!verdict.allow) {
          reply.code(403);
          return { success: false as const, error: verdict.reason };
        }
        // The ticket carries the minting device so the bridge that presents it
        // registers ATTRIBUTABLE sessions (origin gate, #E15).
        return {
          success: true as const,
          data: { ticket: wsTicketStore.mint(scope, verdict.deviceId) },
        };
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

    flush() {
      metaPersistence.flushAll();
      preferencesStore.flush();
    },

    httpPort() {
      const addr = fastify.server.address();
      if (addr && typeof addr === "object") return addr.port;
      return null;
    },
    piPort() {
      // TCP only: a UDS listener has no port, and callers of `piPort()` are
      // building `ws://host:<port>` URLs. Socket-transport callers read
      // `piGateway.transport()` instead. See change:
      // add-pi-gateway-transport-identity (task 2.9).
      const addr = piGateway.address();
      return typeof addr === "number" ? addr : null;
    },

    async start(opts: { deadlineMs?: number | null } = {}) {
      // D1: bound + tear down. A failure after `piGateway.start()` must not
      // leave this process holding the gateway port, and a startup that never
      // settles must not linger forever. Teardown preserves the original error.
      await runBoundedStartup({
        deadlineMs: opts.deadlineMs ?? null,
        core: () => server._startCore(),
        teardown: async () => {
          // Gateway FIRST — it is the port bound earliest and the one the
          // captured zombie held. `stop()` also clears `pingTimer`, which is
          // what actually lets the process exit.
          try { piGateway.stop(); } catch { /* ignore */ }
          if (secondFastify) {
            try { await secondFastify.close(); } catch { /* ignore */ }
            secondFastify = null;
          }
          try { await fastify.close(); } catch { /* ignore */ }
        },
      });
    },

    async _startCore() {
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
        const keeperAliveIds = await browserGateway.headlessPidRegistry.cleanupKeeperOrphans();
        // Class 1 synchronous liveness gate: a candidate whose keeper+pi the
        // reclaim found alive was never lost — drop it before the offer is
        // built and consume its marker. Runs before the broadcast below.
        // See change: fix-recovery-offer-bridge-liveness-gate.
        for (const id of keeperAliveIds) {
          if (liveRecoveryCandidates.has(id)) {
            retractRecoveryCandidate(id, "keeper-alive");
          }
        }
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

      // Claim (or attach to) this HOME's rendezvous BEFORE the gateway starts
      // listening: the record is what an unpinned bridge resolves its
      // dashboard through, and until this call existed no `server.lock` was
      // ever written for a running dashboard (task 2.0a).
      //
      // An attach-mode instance still binds its own per-instance socket and
      // serves pinned bridges — it just never claims the HOME's default
      // (task 2.0c).
      try {
        const { ensureInstanceId } = await import("./lifecycle/instance-id.js");
        const { establishHomeRendezvous } = await import("./lifecycle/home-rendezvous.js");
        homeRendezvous = await establishHomeRendezvous({
          httpPort: config.port,
          piPort: config.piPort,
          version: pkgVersion,
          identity: ensureInstanceId(undefined, config.piPort),
          // NO signal handlers. `installReleaseHandlers` ends in
          // `process.exit(0)`, and `cli.ts` already owns SIGTERM/SIGINT
          // (`recordExitIntent` → `flush` → exit). A second exit-forcing
          // handler registered from inside `start()` races that teardown and
          // can cost the exit-intent record. Release happens in `stop()`; a
          // record left behind by a signal is safe, because every reader
          // verifies liveness + identity before trusting it, and the next
          // starter takes over through acquire-then-verify.
          installHandlers: false,
        });
        console.log(`[home-lock] rendezvous mode: ${homeRendezvous.mode}`);
      } catch (err) {
        // A dashboard that cannot claim the rendezvous still serves pinned
        // bridges; refusing to boot would be a worse failure than no default.
        console.warn("[home-lock] could not establish the rendezvous:", err);
      }

      // D10/D15 (tasks 8.1, 8.6, 5.2): the default POSIX start binds the unix
      // socket and NO TCP port. TCP survives as an explicit `PI_GATEWAY_TCP`
      // opt-in (bridge auth mandatory — section 6) and as the loopback
      // fallback where a socket is unrepresentable, pinned to 127.0.0.1.
      {
        const { resolveLocalGatewayEndpoint } = await import(
          "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js"
        );
        const { decideGatewayListeners, isTcpOptIn } = await import("./pi/gateway-transport-policy.js");
        const policy = decideGatewayListeners({
          local: resolveLocalGatewayEndpoint(undefined, config.piPort),
          tcpOptIn: config.gatewayTcp ?? isTcpOptIn(process.env),
          host: config.host,
          piPort: config.piPort,
        });
        console.log(`[pi-gateway] ${policy.reason}`);
        // TCP first: `startOnSocket` installs the shared WebSocketServer, and
        // `start()` refuses to run after it rather than orphan the listener.
        if (policy.tcp) piGateway.start(policy.tcp.port, policy.tcp.host);
        if (policy.socketPath) {
          try {
            await piGateway.startOnSocket(policy.socketPath);
          } catch (err) {
            // A refused socket bind (a live incumbent — D9) must not leave the
            // gateway with no listener at all. Fall back to loopback, never to
            // discovery.
            console.error(`[pi-gateway] socket bind refused: ${err}`);
            if (!policy.tcp) {
              console.warn(`[pi-gateway] falling back to 127.0.0.1:${config.piPort}`);
              piGateway.start(config.piPort, "127.0.0.1");
            }
          }
        }
      }

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
          // Supplies the validated config a `requires.paths` ${configKey}
          // placeholder resolves against. See change: add-apple-tools-imcp-plugin.
          getPluginConfig: (id) =>
            getPluginConfigFromFile(loadConfig(), id) as Record<string, unknown>,
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
                  // Plugin/automation spawn: transport-less, reclaim required.
                  armSpawnWatchdog(opts.cwd, "headless", result);
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
              // In-process model runtime seam for plugin server entries (e.g. the
              // grammar plugin's llm backend) — mirrors the grammar-route wiring
              // above; maps `system`→`context.systemPrompt` (pi-ai contract).
              // See change: make-grammar-fully-plugin-contained.
              // Stored provider credentials for plugin server entries (e.g. the
              // quota plugin's usage fetch). Replaces deep-importing
              // provider-auth-storage from this package — a plugin published to
              // npm has no pi-dashboard-server source tree to reach into.
              //
              // Trust gate is SCOPE-based, deliberately NOT the `priority <= 100`
              // gate used by spawnSession/abortSession: `priority` also drives
              // slot render-order, so a plugin that renders late (quota = 600)
              // cannot raise it without moving its widget AND silently gaining
              // spawn/abort powers. Returns raw OAuth refresh/access tokens, so
              // untrusted plugins get `undefined`.
              // See change: publish-quota-plugin.
              providerAuth: {
                getCredential: (provider: string) => {
                  if (!plugin.packageName.startsWith("@blackbelt-technology/")) return undefined;
                  try {
                    return readAuthJson()[provider];
                  } catch {
                    return undefined;
                  }
                },
              },
              modelRuntime: {
                getModelRegistry: async () => {
                  try {
                    return await getModelRegistry();
                  } catch {
                    return null;
                  }
                },
                streamSimple: (opts) => {
                  const fn = getStreamSimpleFn();
                  if (!fn) throw new Error("streamSimple not available");
                  return fn(opts.model, { messages: opts.messages, systemPrompt: opts.system }, opts);
                },
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
        // `bridge` belongs to the pi-gateway listener, not to this one. Letting
        // it through would CONSUME the single-use ticket here and then fall to
        // the routing `default:` and destroy the socket — a bridge that dialled
        // the dashboard port would silently burn its ticket and see a bare TCP
        // close (@review Audit, minor).
        if (scope === "bridge") {
          socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
          socket.destroy();
          return;
        }
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

      // Bind-vs-trust reachability. A loopback or specific-NIC bind silently
      // voids a trusted network outside its range: the TCP connection is
      // refused before any handler runs, so no block event is ever recorded and
      // the Settings banner stays blank. Operators who never open Settings get
      // this line instead. Failure-isolated — never blocks startup.
      // See change: warn-unreachable-trusted-networks.
      try {
        initBindReachability({ resolvedBindHost: config.host, hostFlag: config.hostFlag });
        const warning = formatBindReachabilityWarning(computeBindReachability(loadConfig));
        if (warning) console.warn(warning);
      } catch { /* advisory only */ }
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
        // Boot must not hang or die on a failed sweep: a leftover zrok process
        // is a degraded state, not a fatal one. Log and keep booting.
        // See change: cleanup-async-semantics-server-extension (design D1).
        cleanupStaleZrok().catch((err: unknown) => {
          console.warn("[zrok] stale-process cleanup failed (continuing boot):", err);
        });
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
      // Deliberately not awaited — boot proceeds to listening while discovery
      // runs. The rejection needs an owner all the same, or a discovery failure
      // is invisible except as an anonymous crash-safety-net line.
      // See change: cleanup-async-semantics-server-extension (design D1).
      discoverAndBroadcastSessions({ sessionManager, browserGateway, directoryService }).catch(
        (err: unknown) => {
          console.warn("[boot] session discovery failed:", err);
        },
      );

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
      // Start the embed-lifecycle reaper sweep (dormant unless the feature is
      // enabled). See change: add-embed-session-lifecycle.
      embedLifecycle.start();

      // Cold-start recovery offer. Gated by `reopenSessionsAfterShutdown`:
      //   off  → handled at classify time (candidates normalized to `ended`,
      //          so `liveRecoveryCandidates` is empty here — this block is skipped)
      //   ask  → broadcast one recovery offer to all connected clients
      //   auto → resume every candidate via the existing resume flow
      // Concurrent acceptances are deduped by `pendingResumeIntents`
      // (last-write-wins) so a session spawns at most once.
      //
      // Liveness gate (change: fix-recovery-offer-bridge-liveness-gate): the
      // Class 1 keeper-alive candidates were already removed from
      // `liveRecoveryCandidates` above; the remaining set is offered/resumed.
      // A late bridge reattach within `RECOVERY_REATTACH_GRACE_MS` retracts a
      // candidate (Class 2, via the onChange check); after the window the map
      // is finalized so a legitimate offer for a genuine loss is never revoked.
      // See change: reopen-sessions-after-shutdown.
      if (liveRecoveryCandidates.size > 0) {
        const mode = recoveryMode;
        if (mode === "ask") {
          // Deadline until which Class-2 liveness is unresolved. Retained on the
          // wire for a client that connects mid-window (it renders the
          // non-actionable "verifying" state). See change: fix-recovery-offer-bridge-liveness-gate.
          recoveryGraceUntil = Date.now() + RECOVERY_REATTACH_GRACE_MS;
          // DEFER the broadcast until liveness is finalized. Broadcasting now
          // and merely disabling the button still renders a card for every
          // candidate that is about to be retracted — the flash-then-vanish
          // offer users actually complain about. Wait out the window, then
          // broadcast ONCE with the survivors. See change: fix-recovery-exit-intent (D6).
          recoveryGraceTimer = setTimeout(() => {
            const survivors = [...liveRecoveryCandidates.values()];
            // Stop retracting: a reattach after this must NOT revoke a
            // legitimate offer for a genuine loss.
            liveRecoveryCandidates.clear();
            console.info(`[recovery] grace window closed; offering ${survivors.length} candidate(s)`);
            if (survivors.length === 0) return;
            pendingRecoveryOffer = buildRecoveryOffer(survivors);
            recoveryOfferBroadcast = true;
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
            // marker clear in `recovery_dismiss`.
            // See change: fix-recovery-offer-dismiss-and-phantom-reopen.
            for (const cand of survivors) {
              if (cand.sessionFile) metaPersistence.setLiveness(cand.sessionFile, { live: false });
            }
          }, RECOVERY_REATTACH_GRACE_MS);
          recoveryGraceTimer.unref?.();
        } else if (mode === "auto") {
          // Defer the resume by the grace window so a session whose bridge
          // reattaches (Class 2) is retracted before we spawn — a second
          // `continue` for an already-alive sessionId double-registers it and
          // breaks message routing. Keeper-alive candidates (Class 1) were
          // already excluded above.
          recoveryGraceTimer = setTimeout(() => {
            void (async () => {
              const resumeConfig = loadConfig();
              const survivors = [...liveRecoveryCandidates.values()];
              liveRecoveryCandidates.clear();
              for (const cand of survivors) {
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
                // Cold-start recovery resume: no ws, reclaim still required.
                armSpawnWatchdog(cand.cwd, resumeConfig.spawnStrategy as any, result);
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
            })();
          }, RECOVERY_REATTACH_GRACE_MS);
          recoveryGraceTimer.unref?.();
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
      // Stop the embed-lifecycle reaper sweep.
      // See change: add-embed-session-lifecycle.
      try { embedLifecycle.stop(); } catch { /* ignore */ }
      // Stop mDNS before closing
      try {
        if (mdnsBrowser) { mdnsBrowser.stop(); mdnsBrowser = null; }
        stopAdvertising();
      } catch { /* ignore mDNS cleanup errors */ }
      removePid();
      idleTimer.cancel();
      directoryService.stopPolling();
      // SIGTERMs every dashboard-spawned pi: after this the sessions below are
      // GONE and can never reattach.
      browserGateway.shutdownHeadlessProcesses();
      // Record `exitIntent:"idle"` instead of erasing the evidence. `stop()`
      // reaches here from the idle timer — the server chose to stop, the user
      // closed nothing — so the sessions it just killed stay recoverable. Clearing
      // their `live` markers here (the old behaviour) is what destroyed the
      // recovery signal for a reboot preceded by an idle auto-stop. Per-session
      // user intent still lives in `closedReason:"manual"`; marker consumption
      // on dismiss / retract / offer-broadcast is unchanged.
      // See change: fix-recovery-exit-intent (D3).
      recordExitIntent("idle");
      metaPersistence.flushAll();
      metaPersistence.dispose();
      // Cancel the deferred boot reconcile + dispose supervisor (pending backoff
      // timers) so a create/stop cycle in one process leaves no stale timer.
      // See change: add-goal-session-supervisor.
      clearTimeout(bootReconcileTimer);
      // Cancel the recovery grace timer (ask: finalize-clear; auto: deferred
      // resume) so a create/stop cycle leaves no stale timer / late spawn.
      // See change: fix-recovery-offer-bridge-liveness-gate.
      if (recoveryGraceTimer) clearTimeout(recoveryGraceTimer);
      goalSupervisor?.dispose();
      pendingForkRegistry.dispose();
      // Every pending ack holds a timer; a create/stop cycle must not leak them.
      // See change: fix-spawn-correlation-ttl-coupling (D7).
      pendingPromptAcks.dispose();
      preferencesStore.flush();
      preferencesStore.dispose();
      // Terminate fit workers so a restart never leaves orphaned threads.
      // See change: fit-attachments-for-display (task 5.1).
      await fitWorkerPool.dispose();

      stopTunnelWatchdog();
      await deleteTunnel(config.port);
      // Release the HOME's rendezvous before the gateway stops answering, so
      // no bridge resolves a record whose endpoint is already dead.
      try {
        await homeRendezvous?.stop();
      } catch {
        /* ignore */
      }
      homeRendezvous = null;
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
