/**
 * Browser Gateway - WebSocket handler for browser client connections.
 * Runs on the HTTP server port via upgrade handling.
 */

import type {
  BrowserOpenSpecUpdateMessage,
  BrowserToServerMessage,
  ServerToBrowserMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { NotifyLogEntry } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { WebSocket, WebSocketServer } from "ws";
import { getLastBindReachability } from "../auth/bind-reachability-service.js";
import { type DirectoryService, hasOpenSpecDir, hasOpenSpecRoot } from "../directory-service.js";
import type { PendingForkRegistry } from "../pending/pending-fork-registry.js";
import type { EventStore } from "../persistence/memory-event-store.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import type { SessionOrderManager } from "../session/session-order-manager.js";
// PendingLoadManager removed — server loads sessions directly via DirectoryService
import { createHeadlessPidRegistry, type HeadlessPidRegistry } from "../spawn-process/headless-pid-registry.js";
import { createNotifyLog, type NotifyLogStats } from "./notify-log.js";

/**
 * Pure helper: build the per-cwd `openspec_update` messages a freshly
 * connecting browser should receive. One message per known cwd.
 * Disambiguates three states:
 *   - cache populated         → cached payload
 *   - openspec dir but cold   → { initialized: false, pending: true }
 *   - no openspec dir         → { initialized: false, pending: false }
 *
 * Exported so cold-boot snapshot semantics can be unit-tested without
 * spinning up a WS server. See change: fix-cold-boot-openspec-protocol.
 */
export function buildOpenSpecConnectSnapshot(
  directoryService: Pick<DirectoryService, "knownDirectories" | "getOpenSpecData">,
  hasDir: (cwd: string) => boolean,
  hasRoot: (cwd: string) => boolean = hasDir,
): Array<BrowserOpenSpecUpdateMessage> {
  const out: Array<BrowserOpenSpecUpdateMessage> = [];
  for (const cwd of directoryService.knownDirectories()) {
    const cached = directoryService.getOpenSpecData(cwd);
    const root = hasRoot(cwd);
    if (cached && cached.initialized) {
      // Cached payload already carries `hasOpenspecDir` set by `pollOne`; if
      // an old cache entry predates that field, fill it from the live probe.
      const data = cached.hasOpenspecDir === undefined
        ? { ...cached, hasOpenspecDir: root }
        : cached;
      out.push({ type: "openspec_update", cwd, data });
    } else if (cached?.readiness) {
      // Finalized non-initialized payload from the readiness fold (ABSENT /
      // BROKEN / OPTED_OUT / GLOBAL_OFF). Pass through VERBATIM — rebuilding a
      // shape here would drop `readiness` and force the connecting browser
      // into the legacy gate, losing the ABSENT Initialize offer on every
      // reload. See change: add-openspec-init-affordances.
      out.push({ type: "openspec_update", cwd, data: cached });
    } else if (hasDir(cwd)) {
      out.push({
        type: "openspec_update",
        cwd,
        data: { initialized: false, pending: true, changes: [], hasOpenspecDir: root },
      });
    } else {
      out.push({
        type: "openspec_update",
        cwd,
        data: { initialized: false, pending: false, changes: [], hasOpenspecDir: root },
      });
    }
  }
  return out;
}

/**
 * D1 — a frame's delivery class is a STATIC function of its message type;
 * it never depends on socket condition. `state` frames are idempotent
 * snapshots of server-held state keyed by `(type, entityKey)`; everything
 * else is `transcript` (recoverable via replay/history backfill). The third
 * class, `blocking`, is NOT derivable from the message — it is the
 * `ctx.critical` flag `sendTo` handles (the pending-prompt exemption).
 * Key rules: singleton types use the bare type; cwd-keyed types carry the
 * type in the key (openspec vs git for one cwd never collide); the terminal
 * lifecycle frames deliberately share ONE key `terminal:<id>` so a later
 * lifecycle frame supersedes an earlier pending one.
 * See change: fix-connect-snapshot-frame-loss (D1).
 */
export function frameClassOf(
  msg: ServerToBrowserMessage,
): { cls: "state" | "transcript"; key: string } {
  switch (msg.type) {
    case "sessions_snapshot":
    case "pinned_dirs_updated":
    case "workspaces_updated":
    case "collapsed_folders_updated":
    case "favorite_models_updated":
    case "display_prefs_updated":
    case "reachability_updated":
      return { cls: "state", key: msg.type };
    case "openspec_update":
    case "git_head_update":
    case "sessions_page_result":
    case "sessions_reordered":
      return { cls: "state", key: `${msg.type}:${msg.cwd}` };
    case "openspec_get_result":
      // The two-phase reply (placeholder then final) is NOT idempotent, so the
      // delivery key carries requestId + phase: a final must not supersede its
      // own queued placeholder, and a newer request for the same cwd must not
      // coalesce over an older one. See change: fix-connect-snapshot-frame-loss.
      return {
        cls: "state",
        key: `openspec_get_result:${msg.cwd}:${msg.requestId}:${msg.final ? "final" : "placeholder"}`,
      };
    case "terminal_added":
      return { cls: "state", key: `terminal:${msg.terminal.id}` };
    case "terminal_updated":
    case "terminal_removed":
      return { cls: "state", key: `terminal:${msg.terminalId}` };
    default:
      return { cls: "transcript", key: msg.type };
  }
}

import { handleAddFolderToWorkspace, handleCreateWorkspace, handleDeleteWorkspace, handleExtensionUiResponse, handleFavoriteModel, handleMoveFolderToWorkspace, handleOpenSpecBulkArchive, handleOpenSpecGet, handleOpenSpecRefresh, handlePiGatewayForward, handlePinDirectory, handleRemoveFolderFromWorkspace, handleRenameWorkspace, handleReorderPinnedDirs, handleReorderSessions, handleReorderWorkspaceFolders, handleReorderWorkspaces, handleSetFolderCollapsed, handleSetWorkspaceCollapsed, handleUnfavoriteModel, handleUnpinDirectory } from "../browser-handlers/directory-handler.js";
import type { BrowserHandlerContext } from "../browser-handlers/handler-context.js";
import { handleAbort, handleClearFollowupEntries, handleEditFollowupEntry, handleFlowControl, handleForceKill, handleKillProcess, handlePromoteFollowupEntry, handlePromptResyncRequest, handleRemoveFollowupEntry, handleResumeSession, handleRetrySession, handleSendPrompt, handleShutdown, handleSpawnSession, handleStopAfterTurn, handleSubagentResyncRequest, shutdownSession as shutdownSessionImpl } from "../browser-handlers/session-action-handler.js";
import { handleAcceptReplaceProposal, handleArchiveSession, handleAttachProposal, handleDetachProposal, handleDismissReplaceProposal, handleFetchContent, handleListSessions, handleRemoveTagGlobally, handleRenameSession, handleSessionsPage, handleSetSessionDisplayPrefs, handleSetSessionProcessDrawer, handleSetSessionTags, handleUnarchiveSession } from "../browser-handlers/session-meta-handler.js";
import { clearGapState, handleHistoryBackfill, handleSubscribe } from "../browser-handlers/subscription-handler.js";
import { handleCloseInlineTerminal, handleCreateTerminal, handleKillTerminal, handleOpenInlineTerminal, handleRenameTerminal } from "../browser-handlers/terminal-handler.js";
import { createPendingResumeRegistry, type PendingResumeRegistry } from "../pending/pending-resume-registry.js";
import { createViewedSessionTracker, type ViewedSessionTracker } from "../session/viewed-session-tracker.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import { ResyncRequesterRegistry, resyncRequestIdOf } from "./subagent-resync-routing.js";



/**
 * Per-delivery cap on exempted critical frames (fix-pending-prompt-lost-on-replay,
 * D2): one pending-prompt replay (or one resync delivery) may bypass the
 * MAX_WS_BUFFER shed for at most this many frames. Fixed, not configurable.
 */
const CRITICAL_FRAMES_PER_DELIVERY = 4;

/** Slack added to MAX_WS_BUFFER to form the absolute critical-frame ceiling. */
const CRITICAL_FRAME_SLACK_BYTES = 1 * 1024 * 1024; // 1 MB

/** Wire shape of `/api/health#droppedFrames.serverToBrowser`, split by frame class. */
export interface DroppedFrameStats {
  /** Transcript-class drops (ordinary frames shed under back-pressure). */
  total: number;
  bySession: Record<string, number>;
  /** Blocking-class drops (critical frames past the cap or the ceiling). */
  blocking: { total: number; bySession: Record<string, number> };
  /** Pending state entries superseded before flush (latest-wins coalescing — NOT a drop). */
  coalescedState: number;
  /** Sockets terminated by the pending-state byte ceiling (stalled). */
  stalledSocketsTerminated: number;
  /**
   * Shed session-REGISTRY CAPTURES — not distinct ids. A re-entry of an
   * already-owed id counts again, as does a shed reconcile, and all three
   * registry kinds (`session_updated`/`session_added`/`session_removed`) count.
   * `queued - sent` is therefore NOT the outstanding debt; read
   * `getStatusReconcileInfo(ws)` for that.
   */
  statusReconcileQueued: number;
  /** Reconcile registry frames actually PUT ON THE WIRE after drain (all kinds). */
  statusReconcileSent: number;
}

/** Owed registry kind — the frame shape the reconcile must rebuild (D2). */
type RegistryDebtKind = "updated" | "added" | "removed";

/**
 * One owed registry id, as exposed by `getStatusReconcileInfo` for diagnostics.
 * Contains only an id, a kind tag, a boolean flag, and at most one short
 * correlation id — never a queued payload (D2).
 */
interface StatusDebtEntryInfo {
  id: string;
  kind: RegistryDebtKind;
  /**
   * Set once a `session_added` for this id was shed; survives the kind being
   * superseded by `removed`. It is the register's memory that the browser was
   * never successfully told the session exists (D2).
   */
  sawAdd: boolean;
  /** The shed `session_added`'s `spawnRequestId`, when it carried one. */
  spawnRequestId?: string;
}

/**
 * Wire shape of `/api/health#socketBufferOccupancy` — browser-socket
 * `bufferedAmount` occupancy, sampled at the send-decision sites (never on a
 * timer). Makes a back-pressure claim measurable instead of inferred from
 * cumulative drop counters. `p95` is pooled across sockets, over a bounded
 * reservoir. See change: fix-backpressure-status-and-subagent-frames.
 */
export interface SocketBufferOccupancy {
  /** Highest `bufferedAmount` observed on any browser socket since boot. */
  max: number;
  /** 95th percentile over the bounded sample reservoir. */
  p95: number;
  /** Cumulative ms any socket was sampled above `MAX_WS_BUFFER`. */
  msAboveThreshold: number;
}

/** Zero-value `SocketBufferOccupancy`, so route fallbacks stay TYPED. */
export const EMPTY_SOCKET_BUFFER_OCCUPANCY: SocketBufferOccupancy = {
  max: 0,
  p95: 0,
  msAboveThreshold: 0,
};

/** Zero-value `DroppedFrameStats`, so route fallbacks stay TYPED, not inline literals. */
export const EMPTY_DROPPED_FRAME_STATS: DroppedFrameStats = {
  total: 0,
  bySession: {},
  blocking: { total: 0, bySession: {} },
  coalescedState: 0,
  stalledSocketsTerminated: 0,
  statusReconcileQueued: 0,
  statusReconcileSent: 0,
};

export interface BrowserGateway {
  wss: WebSocketServer;
  broadcastEvent(sessionId: string, seq: number, event: any): void;
  broadcastSessionAdded(session: any, opts?: { spawnRequestId?: string }): void;
  broadcastSessionUpdated(sessionId: string, updates: any): void;
  broadcastSessionRemoved(sessionId: string): void;
  /**
   * End a session the same way the browser `shutdown` message does — terminate
   * the process for ANY spawn strategy, write the manual-close liveness marker,
   * then unregister and broadcast.
   *
   * Exposed so `POST /api/session/:id/shutdown` stops being a parallel
   * implementation: as a duplicate it omitted the liveness write (#449) and,
   * once the WS path learned to terminate a tmux session, kept leaking one
   * (#452). See change: fix-tmux-session-shutdown-leak.
   */
  shutdownSession(sessionId: string): Promise<void>;
  sendToSubscribers(sessionId: string, msg: ServerToBrowserMessage): void;
  /**
   * Register an IN-PROCESS subscriber for one session's live server→browser
   * frames — for a headless plugin acting as a browser-protocol client without
   * a WebSocket. Receives the same frames `sendToSubscribers`/`broadcastEvent`
   * fan out to browser sockets (`event`, `prompt_request`, `prompt_dismiss`,
   * `session_state_reset`). Returns an idempotent unsubscribe fn.
   * See change: add-chat-gateway.
   */
  addInProcessSubscriber(
    sessionId: string,
    handler: (msg: ServerToBrowserMessage) => void,
  ): () => void;
  /**
   * Replay currently-pending PromptBus requests for `sessionId` to ONE
   * in-process subscriber, so a gateway that (re)subscribes renders an
   * already-open `ask_user`. The in-process sibling of
   * `replayPendingUiRequests`.
   * See change: add-chat-gateway.
   */
  replayPendingPromptsTo(
    sessionId: string,
    handler: (msg: ServerToBrowserMessage) => void,
  ): void;
  broadcastToAll(msg: ServerToBrowserMessage): void;
  /**
   * Broadcast an `openspec_update` envelope using a pre-stringified `data`
   * payload (from the OpenSpec poll worker). The envelope JSON is built by
   * string concatenation so the large `data` is NOT re-serialized on the
   * main thread — it flows from worker → ws.send in exactly one form.
   * Mirrors `broadcast()`'s back-pressure + readyState guards.
   * See change: offload-openspec-poll-to-worker.
   */
  broadcastOpenSpecUpdate(cwd: string, dataSerialized: string): void;
  /** Get number of browser subscribers for a session */
  getSubscriberCount(sessionId: string): number;
  /**
   * Whether an unanswered interactive UI request (`ask_user`) is currently
   * tracked for the session. Read by the embed-lifecycle reaper's quiescence
   * gate. See change: add-embed-session-lifecycle.
   */
  hasPendingUiRequest(sessionId: string): boolean;
  /**
   * Whether ≥1 unanswered PromptBus request is currently tracked for the
   * session. Read by the `currentTool` derivation in event-wiring and by the
   * embed-lifecycle reaper's pending-ask union. Returns a boolean, never the
   * map — prompt payloads stay owned by the gateway.
   * See change: restore-ask-user-tool-state-on-reconnect (D6).
   */
  hasPendingPromptRequests(sessionId: string): boolean;
  /**
   * Per-hop dropped-frame counters for the diagnostics/health surface. A
   * server→browser frame is dropped when a browser socket's send buffer
   * crosses MAX_WS_BUFFER under back-pressure. `total`/`bySession` carry the
   * TRANSCRIPT class (back-compat shape); `blocking` carries critical frames
   * dropped past the exemption bounds. See changes:
   * fix-stuck-tool-card-on-dropped-event, fix-pending-prompt-lost-on-replay.
   */
  getDroppedFrameStats(): DroppedFrameStats;
  /**
   * Per-socket pending-state diagnostics (D2): entry count and retained
   * bytes for `ws`, or `undefined` when no pending map is allocated. Zero
   * cost in steady state. See change: fix-connect-snapshot-frame-loss.
   */
  getPendingStateInfo(ws: WebSocket): { entries: number; bytes: number } | undefined;
  /**
   * Per-socket status-reconcile diagnostics: the session ids currently owed to
   * `ws` after a shed registry frame, the owed kind + `sawAdd` flag per id, and
   * whether the reconcile timer is live. `undefined` when nothing is owed (zero
   * cost in steady state).
   * See changes: fix-backpressure-status-and-subagent-frames,
   *              close-registry-frame-shed-gaps.
   */
  getStatusReconcileInfo(ws: WebSocket): {
    owed: string[];
    timerActive: boolean;
    entries: StatusDebtEntryInfo[];
  } | undefined;
  /**
   * Browser-socket buffered-amount occupancy for the health surface.
   * See change: fix-backpressure-status-and-subagent-frames.
   */
  getSocketBufferOccupancy(): SocketBufferOccupancy;
  /**
   * TEST-ONLY back-pressure injector. Real saturation is caused by a browser
   * failing to drain its own socket, which a browser automation driver cannot
   * induce deterministically — so the L3 convergence specs have no way to
   * observe a shed without one. Forces every transcript-class frame to shed as
   * if the socket were over `MAX_WS_BUFFER`, leaving `bufferedAmount` itself
   * untouched.
   *
   * INERT unless `PI_E2E_FORCE_SHED=1` was set in the server's environment at
   * gateway construction. Returns the effective state, so a caller that is not
   * running under the flag learns the request was refused instead of silently
   * believing it took.
   * See change: fix-backpressure-status-and-subagent-frames.
   */
  setTestForceShed(enabled: boolean): boolean;
  /**
   * Requester-scoped delivery of a prompt-resync reply (fix B, server half).
   * `msg` is an ordinary bridge `prompt_request` that may carry the echoed
   * `__resyncRequestId` token of a `prompt_resync_request` this gateway
   * recorded. Resolution is NON-CONSUMING (peek, D5): every re-emitted prompt
   * of one reply routes to the same requester, as a critical frame under the
   * same bounded exemption as the replay path. Returns true when delivered;
   * false (no/expired token, requester gone or no longer a subscriber) means
   * the caller keeps the ordinary fan-out. Mid-replay requesters are NOT
   * suppressed — mid-replay arrival is the expected timing for refresh.
   * See change: fix-pending-prompt-lost-on-replay (D4/D5).
   */
  deliverPromptResyncReply(msg: ServerToBrowserMessage, sessionId: string): boolean;
  /** Track a pending interactive UI request for replay on reconnect */
  trackUiRequest(sessionId: string, requestId: string, method: string, params: Record<string, unknown>): boolean | void;
  /** Clear a pending interactive UI request (resolved or cancelled) */
  clearUiRequest(sessionId: string, requestId: string): void;
  /**
   * Append one notification to the session's bounded notify log (cap 50,
   * oldest evicted) and persist it on the session record. Transcript history
   * only — it never feeds `hasPendingPromptRequests` / `hasPendingAsk` / the
   * `currentTool` fold. See change: split-notify-from-prompt-request.
   */
  appendNotify(sessionId: string, entry: NotifyLogEntry): void;
  /**
   * Notify-log eviction counters for `/api/health`. Cap-50 eviction is silent
   * transcript loss, so it is counted beside `droppedFrames` / `storeTrim`.
   * See change: split-notify-from-prompt-request.
   */
  getNotifyLogStats(): NotifyLogStats;
  /** Track a pending PromptBus request for replay on browser refresh */
  trackPromptRequest(sessionId: string, msg: Record<string, unknown>): void;
  /** Clear a pending PromptBus request (dismissed or cancelled) */
  clearPromptRequest(sessionId: string, promptId: string): void;
  /**
   * Snapshot setter over the PromptBus registry: drop every tracked prompt for
   * the session whose id is not in `promptIds`. Used at each replay exit, where
   * the bridge's re-sent prompt burst is the authoritative pending set — this is
   * what recovers from a `prompt_dismiss` lost across a socket drop.
   * See change: restore-ask-user-tool-state-on-reconnect (D4).
   */
  reconcilePromptRequests(sessionId: string, promptIds: readonly string[]): void;
  /**
   * Drop both pending registries for a dead session. Turning these maps into
   * load-bearing reaper signals obliges this change to own their lifecycle —
   * a leaked entry would make the session permanently unreapable.
   * See change: restore-ask-user-tool-state-on-reconnect (D6b).
   */
  clearPendingRequestsForSession(sessionId: string): void;
  /** Tell browser subscribers to reset accumulated state for a session (bridge reconnected) */
  broadcastSessionStateReset(sessionId: string): void;
  /** Shut down all tracked headless child processes */
  shutdownHeadlessProcesses(): void;
  /** Registry for linking headless PIDs to session IDs */
  headlessPidRegistry: HeadlessPidRegistry;
  /** Registry for pending auto-resume prompts */
  pendingResumeRegistry: PendingResumeRegistry;
  /**
   * Tracker for which browser is currently viewing which session. Used by
   * the unread-trigger evaluation in event-wiring.ts.
   * See change: session-card-unread-stripes.
   */
  viewedSessionTracker: ViewedSessionTracker;
  /** Send a message to a specific WebSocket client */
  sendToClient(ws: WebSocket, msg: ServerToBrowserMessage): void;
  /** Callback invoked when a new browser client connects */
  onConnect?: (ws: WebSocket) => void;
  /**
   * Callback invoked when a browser dismisses a cold-start recovery offer
   * (`recovery_dismiss`). The gateway already consumes the on-disk liveness
   * markers; the server assigns this to null its held `pendingRecoveryOffer`
   * so `onConnect` replay stops after the resolving action.
   * See change: fix-recovery-offer-dismiss-and-phantom-reopen.
   */
  onRecoveryDismiss?: (sessionIds: string[]) => void;
  /**
   * Callback invoked when a session is resumed via `resume_session` (the
   * Reopen path). The server assigns this to null its held
   * `pendingRecoveryOffer` so `onConnect` replay stops after the first
   * resolving action, matching "shown once per dirty boot".
   * See change: fix-recovery-offer-dismiss-and-phantom-reopen.
   */
  onRecoveryResolve?: () => void;
  /**
   * Predicate: true while a cold-start recovery candidate's process liveness is
   * still unresolved (the Class-2 grace window). The server assigns this from
   * its `liveRecoveryCandidates` set; the resume handler consults it to refuse
   * a `continue` reopen that could double-spawn a still-alive session.
   * See change: fix-recovery-offer-bridge-liveness-gate.
   */
  isRecoveryLivenessPending?: (sessionId: string) => boolean;
  /** Broadcast a message to all connected clients */
  broadcast(msg: ServerToBrowserMessage): void;
  /**
   * Register a handler for a Browser→Server message type the gateway does
   * not natively handle. Used by plugins to receive `plugin_action`
   * messages without modifying the gateway's switch statement.
   * See change: adopt-server-driven-intent-rendering.
   */
  registerHandler(
    type: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (msg: any, ws: WebSocket) => void,
  ): void;
  /**
   * Register a `plugin_action` handler keyed by pluginId, so multiple plugins
   * service `plugin_action` concurrently without one shadowing another. The
   * host supplies the pluginId from the plugin manifest (not self-declared).
   * See change: fix-plugin-action-fanout-and-handlers.
   */
  registerPluginActionHandler(
    pluginId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (msg: any, ws: WebSocket) => void,
  ): void;
  /**
   * Register a callback invoked when any browser connection closes, so
   * per-connection resources (e.g. the open-files watch) are torn down.
   * See change: split-editor-workspace.
   */
  registerDisconnectHandler(handler: (ws: WebSocket) => void): void;
}

/** Default browser keepalive ping interval. See change: harden-ios-safari-memory-and-ws-diagnostics. */
export const DEFAULT_BROWSER_PING_INTERVAL_MS = 30_000;

/** Per-socket close-diagnostics + keepalive state (design D2/D3). */
interface SocketDiag {
  connectedAt: number;
  frames: number;
  missedPongs: number;
  /** `bufferedAmount` at the previous keepalive tick (drain-progress check). */
  lastBuffered: number;
  cause: "peer" | "keepalive" | "stalled";
}

export function createBrowserGateway(
  sessionManager: SessionManager,
  eventStore: EventStore,
  piGateway: PiGateway,
  _pendingLoadManager?: unknown,
  pendingForkRegistry?: PendingForkRegistry,
  sessionOrderManager?: SessionOrderManager,
  preferencesStore?: PreferencesStore,
  directoryService?: DirectoryService,
  terminalManager?: TerminalManager,
  pendingDashboardSpawns?: Map<string, number>,
  maxWsBufferBytes?: number,
  pendingAttachRegistry?: import("../pending/pending-attach-registry.js").PendingAttachRegistry,
  pendingInitialPromptRegistry?: import("../pending/pending-initial-prompt-registry.js").PendingInitialPromptRegistry,
  pendingResumeIntents?: import("../pending/pending-resume-intent-registry.js").PendingResumeIntentRegistry,
  pendingClientCorrelations?: import("../pending/pending-client-correlations.js").PendingClientCorrelations,
  pendingWorktreeBaseRegistry?: import("../pending/pending-worktree-base-registry.js").PendingWorktreeBaseRegistry,
  metaPersistence?: import("../persistence/meta-persistence.js").MetaPersistence,
  /** Display-fit pool, so session hydration fits inline images like the live
   *  path does. See change: fit-attachments-for-display (test-plan #E9). */
  fitWorkerPool?: import("../attachments/fit-worker-pool.js").FitWorkerPool,
  /** Max events replayed on a FULL-stream subscribe (0 = unlimited).
   *  See change: lazy-load-session-history (D1). */
  maxReplayEvents?: number,
  /** Shape of the replay window when one applies. Absent → `head-tail`.
   *  See change: add-tail-only-replay-window (D1). */
  replayWindowMode?: import("@blackbelt-technology/pi-dashboard-shared/memory-limits.js").ReplayWindowMode,
  /** Archive index + transition owner (snapshot counts, archive verbs).
   *  See change: archive-sessions-lazy-load. */
  sessionArchive?: import("../session/session-archive.js").SessionArchive,
  /** One-shot intents for idle-alive archive requests.
   *  See change: archive-sessions-lazy-load. */
  pendingArchiveIntents?: import("../pending/pending-archive-intent-registry.js").PendingArchiveIntentRegistry,
  /** Retention store for REMOTE-origin session hydration: a remote session's
   *  transcript is not on this filesystem, so this is where its history comes
   *  from. See change: serve-retained-remote-transcripts. */
  remoteTranscriptStore?: import("../session/remote-transcript-store.js").RemoteTranscriptStore,
  /** Protocol-level keepalive ping interval for browser sockets (ms).
   *  See change: harden-ios-safari-memory-and-ws-diagnostics (design D2). */
  browserPingIntervalMs: number = DEFAULT_BROWSER_PING_INTERVAL_MS,
): BrowserGateway {
  const wss = new WebSocketServer({ noServer: true });

  /**
   * Per-socket close diagnostics + keepalive state (D2/D3). A WeakMap, so a
   * closed socket needs no explicit cleanup.
   * See change: harden-ios-safari-memory-and-ws-diagnostics.
   */
  const socketDiag = new WeakMap<WebSocket, SocketDiag>();

  // Keepalive: ping every interval; a socket that left two consecutive pings
  // unanswered is terminated on the next tick (60–90 s at the default). The
  // timer runs only while tracked (upgraded) clients exist, never keeps the
  // process alive, and is cleared when the wss closes.
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  function keepaliveTick(): void {
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      const diag = socketDiag.get(client);
      if (!diag) continue;
      // The ping queues behind buffered data, so a live client on a slow link
      // cannot answer until it drains: drain progress counts as liveness.
      const buffered = client.bufferedAmount;
      if (buffered > 0 && buffered < diag.lastBuffered) diag.missedPongs = 0;
      diag.lastBuffered = buffered;
      if (diag.missedPongs >= 2) {
        diag.cause = "keepalive";
        client.terminate();
        continue;
      }
      diag.missedPongs++;
      try {
        client.ping();
      } catch {
        // A socket racing to close — its close event settles it.
      }
    }
  }
  function startKeepalive(): void {
    if (keepaliveTimer) return;
    keepaliveTimer = setInterval(keepaliveTick, browserPingIntervalMs);
    if (typeof keepaliveTimer.unref === "function") keepaliveTimer.unref();
  }
  function stopKeepalive(): void {
    if (!keepaliveTimer) return;
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
  wss.on("close", stopKeepalive);

  /**
   * Plugin-registered handlers for custom Browser→Server message types.
   * Lives outside subscriptions because handlers are global, not per-WS.
   * See change: adopt-server-driven-intent-rendering.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customHandlers = new Map<string, (msg: any, ws: WebSocket) => void>();

  /**
   * `plugin_action` handlers keyed by pluginId (fan-out registry). Distinct
   * from `customHandlers` (single-owner types like `watch_files`): a
   * `plugin_action` is routed to the handler whose pluginId matches
   * `message.pluginId`, so N plugins coexist regardless of load order.
   * See change: fix-plugin-action-fanout-and-handlers.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pluginActionHandlers = new Map<string, (msg: any, ws: WebSocket) => void>();

  // Callbacks invoked on browser disconnect (per-connection resource cleanup).
  // See change: split-editor-workspace.
  const disconnectHandlers: Array<(ws: WebSocket) => void> = [];

  // Track subscriptions: ws → Set<sessionId>
  const subscriptions = new Map<WebSocket, Set<string>>();
  // In-process (non-WebSocket) subscribers: sessionId → handlers. A headless
  // plugin acting as a browser-protocol client consumes the same live frames a
  // browser socket does, without opening a socket.
  // See change: add-chat-gateway.
  const inProcessSubscribers = new Map<string, Set<(msg: ServerToBrowserMessage) => void>>();
  // Track which sessions are mid-replay per WebSocket (suppress live events)
  const replayingSessions = new Map<WebSocket, Set<string>>();

  // Track headless child processes with sessionId linkage
  const headlessPidRegistry = createHeadlessPidRegistry();

  // Track which browser is viewing which session (for unread state machine).
  // See change: session-card-unread-stripes.
  const viewedSessionTracker = createViewedSessionTracker();
  /** requestId → the browser awaiting that subagent-resync reply (C5). */
  const resyncRequesters = new ResyncRequesterRegistry<WebSocket>();

  // Track pending interactive UI requests per session for replay on reconnect
  const pendingUiRequests = new Map<string, Map<string, { requestId: string; method: string; params: Record<string, unknown> }>>();

  /**
   * Clear a pending interactive-UI request. Extracted so the browser WS case
   * and the exposed `clearUiRequest` (used by `POST
   * /api/session/:id/extension-ui-response`) mutate the map identically
   * (change: expand-mcp-tiered-surface, D3).
   */
  function clearUiRequestImpl(sessionId: string, requestId: string): void {
    const sessionMap = pendingUiRequests.get(sessionId);
    if (sessionMap) {
      sessionMap.delete(requestId);
      if (sessionMap.size === 0) pendingUiRequests.delete(sessionId);
    }
  }

  // Track pending PromptBus requests per session for replay on browser refresh
  const pendingPromptRequests = new Map<string, Map<string, Record<string, unknown>>>();

  // Bounded per-session notification history. Strictly separate from the
  // pending registries above: never a pending ask, retained after session end,
  // persisted on the session record. See change: split-notify-from-prompt-request.
  const notifyLog = createNotifyLog();

  // Track pending auto-resume prompts for ended sessions
  const pendingResumeRegistry = createPendingResumeRegistry({
    onTimeout(oldSessionId) {
      // Clear resuming flag when resume times out
      sessionManager.update(oldSessionId, { resuming: false });
      broadcast({ type: "session_updated", sessionId: oldSessionId, updates: { resuming: false } });
    },
  });

  /** Send any pending interactive UI requests to a specific browser socket */
  function replayPendingUiRequests(ws: WebSocket, sessionId: string) {
    const sessionPending = pendingUiRequests.get(sessionId);
    if (sessionPending) {
      for (const req of sessionPending.values()) {
        sendTo(ws, {
          type: "extension_ui_request",
          sessionId,
          requestId: req.requestId,
          method: req.method,
          params: req.params,
        });
      }
    }
    // Also replay pending PromptBus requests. These frames are BLOCKING (the
    // agent is awaiting an answer), so this leg — and only this leg — is sent
    // under the critical-frame exemption: bounded by a per-delivery cap and
    // the absolute ceiling. The dead extension_ui_request leg above and
    // replayNotifyLog stay fully guarded (D3).
    // See change: fix-pending-prompt-lost-on-replay (D1/D2/D3).
    const sessionPrompts = pendingPromptRequests.get(sessionId);
    if (sessionPrompts) {
      const criticalBudget = { remaining: CRITICAL_FRAMES_PER_DELIVERY };
      for (const msg of sessionPrompts.values()) {
        sendTo(ws, msg as any, { sessionId, critical: true, criticalBudget });
      }
    }
  }

  /**
   * Replay the retained notifications to a single browser socket. A sibling of
   * `replayPendingUiRequests`, deliberately NOT folded into it: the two stores
   * have opposite semantics. The client dedups by `notifyId`, so re-firing on a
   * warm reconnect is idempotent.
   * See change: split-notify-from-prompt-request.
   */
  /**
   * Cold hydration: after a server restart (or a bridge reattach) the in-memory
   * log is empty while the restored session record still carries the persisted
   * rows. Both readers AND the appender must seed from the record — an append
   * onto an empty in-memory list would mirror back a one-row array and wipe the
   * persisted history before any browser ever saw it.
   */
  function hydrateNotifyLog(sessionId: string): void {
    if (!notifyLog.isEmpty(sessionId)) return;
    const persisted = sessionManager.get(sessionId)?.notifyLog;
    if (persisted && persisted.length > 0) notifyLog.hydrate(sessionId, persisted);
  }

  function replayNotifyLog(ws: WebSocket, sessionId: string) {
    hydrateNotifyLog(sessionId);
    for (const entry of notifyLog.get(sessionId)) {
      sendTo(ws, {
        type: "notify",
        sessionId,
        notifyId: entry.notifyId,
        message: entry.message,
        ...(entry.level === undefined ? {} : { level: entry.level }),
      } as ServerToBrowserMessage);
    }
  }

  function appendNotify(sessionId: string, entry: NotifyLogEntry): void {
    hydrateNotifyLog(sessionId);
    const list = notifyLog.append(sessionId, entry);
    // Mirror onto the session record so the debounced `.meta.json` save carries
    // the log across a server restart, like the rest of the transcript.
    sessionManager.update(sessionId, { notifyLog: [...list] });
  }

  function trackUiRequest(sessionId: string, requestId: string, method: string, params: Record<string, unknown>): boolean | void {
    let sessionMap = pendingUiRequests.get(sessionId);
    if (!sessionMap) {
      sessionMap = new Map();
      pendingUiRequests.set(sessionId, sessionMap);
    }
    const title = params.title;
    if (title !== undefined) {
      for (const existing of sessionMap.values()) {
        if (existing.method === method && existing.params.title === title) {
          return false;
        }
      }
    }
    sessionMap.set(requestId, { requestId, method, params });
    return true;
  }

  function trackPromptRequest(sessionId: string, msg: Record<string, unknown>): void {
    let sessionMap = pendingPromptRequests.get(sessionId);
    if (!sessionMap) {
      sessionMap = new Map();
      pendingPromptRequests.set(sessionId, sessionMap);
    }
    const promptId = msg.promptId as string;
    if (promptId) {
      sessionMap.set(promptId, msg);
    }
  }

  function clearPromptRequest(sessionId: string, promptId: string): void {
    const sessionMap = pendingPromptRequests.get(sessionId);
    if (sessionMap) {
      sessionMap.delete(promptId);
      if (sessionMap.size === 0) pendingPromptRequests.delete(sessionId);
    }
  }

  function reconcilePromptRequests(sessionId: string, promptIds: readonly string[]): void {
    const sessionMap = pendingPromptRequests.get(sessionId);
    if (!sessionMap) return;
    const keep = new Set(promptIds);
    for (const promptId of [...sessionMap.keys()]) {
      if (!keep.has(promptId)) sessionMap.delete(promptId);
    }
    if (sessionMap.size === 0) pendingPromptRequests.delete(sessionId);
  }

  function getSubscribers(sessionId: string): WebSocket[] {
    const result: WebSocket[] = [];
    for (const [ws, subs] of subscriptions) {
      if (subs.has(sessionId) && ws.readyState === WebSocket.OPEN) {
        result.push(ws);
      }
    }
    return result;
  }

  /**
   * Fan one live server→browser frame to every IN-PROCESS subscriber of the
   * session. A headless plugin (chat-gateway) that consumes the browser
   * protocol without a WebSocket receives the same frames a browser socket
   * does. Called from the live-frame choke points — `broadcastEvent` (live
   * `event`) and `sendToSubscribers` (`prompt_request`/`prompt_dismiss`/ui
   * frames) — plus `broadcastSessionStateReset`.
   *
   * A throwing subscriber NEVER breaks the browser fan-out: each handler is
   * isolated, mirroring the failure-isolation rule for plugin server entries.
   * See change: add-chat-gateway.
   */
  function deliverInProcess(sessionId: string, msg: ServerToBrowserMessage): void {
    const handlers = inProcessSubscribers.get(sessionId);
    if (!handlers) return;
    for (const handler of handlers) {
      invokeSubscriber(handler, msg, "subscriber", sessionId);
    }
  }

  /**
   * Invoke an in-process subscriber handler, isolating BOTH sync throws and
   * async rejections. The declared type is `(msg) => void`, but an `async`
   * handler is legal: observing only the sync path would let its rejected
   * promise escape to the process-level unhandled-rejection handler.
   */
  function invokeSubscriber(
    handler: (msg: ServerToBrowserMessage) => void,
    msg: ServerToBrowserMessage,
    label: string,
    sessionId: string,
  ): void {
    try {
      const ret = handler(msg) as unknown;
      if (ret && typeof (ret as { then?: unknown }).then === "function") {
        void (ret as Promise<unknown>).catch((err) => {
          console.error(`[browser-gw] in-process ${label} rejected for ${sessionId}:`, err);
        });
      }
    } catch (err) {
      console.error(`[browser-gw] in-process ${label} threw for ${sessionId}:`, err);
    }
  }

  /** Max buffered bytes per browser WebSocket before dropping messages (0 = no limit) */
  const MAX_WS_BUFFER = maxWsBufferBytes ?? 4 * 1024 * 1024; // 4MB default

  // ── Critical-frame exemption bounds (change: fix-pending-prompt-lost-on-replay, D2) ──
  // A blocking frame (a pending-prompt replay / resync reply) bypasses the
  // MAX_WS_BUFFER shed ONLY while the socket stays under an ABSOLUTE ceiling
  // of MAX_WS_BUFFER + 1 MB — so repeated resyncs on a stalled socket can pin
  // at most 1 extra MB, never unbounded memory. Both bounds are fixed, not
  // configurable; the ceiling derives from the same maxWsBufferBytes arg as
  // the threshold itself.
  const CRITICAL_FRAME_CEILING = MAX_WS_BUFFER + CRITICAL_FRAME_SLACK_BYTES;

  // ── Drop-site instrumentation (change: fix-stuck-tool-card-on-dropped-event) ──
  // The server→browser hop silently drops a frame when the send buffer crosses
  // MAX_WS_BUFFER (browser not draining under back-pressure / a stall). Count
  // every drop and emit a rate-limited warning so the next stuck-card incident
  // is attributable. Logging is rate-limited because drops cluster during a
  // stall (a log-storm would itself add load). Counters are SPLIT by frame
  // class (fix-pending-prompt-lost-on-replay, D1): `transcript` = ordinary
  // frames shed under back-pressure; `blocking` = exempt-eligible frames that
  // exceeded a bound (cap or ceiling) — a future regression is attributable to
  // the exemption, not to transcript shedding.
  let droppedFramesTotal = 0;
  const droppedFramesBySession = new Map<string, number>();
  let droppedBlockingTotal = 0;
  const droppedBlockingBySession = new Map<string, number>();
  const DROP_WARN_WINDOW_MS = 5_000;
  let lastDropWarnAt = 0;

  function recordDroppedFrame(
    sessionId: string | undefined,
    seq: number | undefined,
    bufferedAmount: number,
    frameClass: "transcript" | "blocking",
  ) {
    if (frameClass === "blocking") {
      droppedBlockingTotal++;
      if (sessionId) droppedBlockingBySession.set(sessionId, (droppedBlockingBySession.get(sessionId) ?? 0) + 1);
    } else {
      droppedFramesTotal++;
      if (sessionId) droppedFramesBySession.set(sessionId, (droppedFramesBySession.get(sessionId) ?? 0) + 1);
    }
    const now = Date.now();
    if (now - lastDropWarnAt >= DROP_WARN_WINDOW_MS) {
      lastDropWarnAt = now;
      console.warn(
        `[browser-gw] dropped frame (back-pressure) class=${frameClass} hop=server→browser sessionId=${sessionId ?? "n/a"} seq=${seq ?? "n/a"} bufferedAmount=${bufferedAmount} > MAX_WS_BUFFER=${MAX_WS_BUFFER} (total dropped=${droppedFramesTotal}, blocking=${droppedBlockingTotal})`,
      );
    }
  }

  // ── Per-socket pending-state map (D2) — change: fix-connect-snapshot-frame-loss ──
  // A `state` frame is NEVER shed: over threshold it defers into this map
  // (latest-wins per delivery key, byte-accounted, FIFO by first insertion)
  // and is flushed by send-completion, by a 250 ms interval while non-empty,
  // and ahead of any transcript send. The byte ceiling bounds memory on a
  // stalled socket by terminating it (the browser reconnects; the bootstrap
  // after reconnect is small). `blocking` (critical) frames are NOT deferred
  // — they keep their own bounded exemption above.
  interface PendingState {
    map: Map<string, string /* serialized */>;
    bytes: number;
    timer?: NodeJS.Timeout;
  }
  const pendingState = new Map<WebSocket, PendingState>();
  let coalescedState = 0;
  let stalledSocketsTerminated = 0;
  const STATE_FLUSH_INTERVAL_MS = 250;
  let lastStateFlushWarnAt = 0;

  /** Clear the flush timer and drop the socket's pending map (close/error/terminate). */
  function dropPendingState(ws: WebSocket): void {
    const pending = pendingState.get(ws);
    if (!pending) return;
    if (pending.timer !== undefined) clearInterval(pending.timer);
    pendingState.delete(ws);
  }

  /** Send-callback: re-flush on success; log rate-limited on error (X3). */
  function onStateSent(ws: WebSocket): (err?: Error | null) => void {
    return (err) => {
      if (err) {
        const now = Date.now();
        if (now - lastStateFlushWarnAt >= DROP_WARN_WINDOW_MS) {
          lastStateFlushWarnAt = now;
          console.warn(`[browser-gw] state flush send failed (will not retry this frame) hop=server→browser:`, err);
        }
        return;
      }
      flushPendingState(ws);
    };
  }

  /** Drain the map in insertion order while the socket is under threshold. */
  function flushPendingState(ws: WebSocket): void {
    const pending = pendingState.get(ws);
    if (!pending || pending.map.size === 0) return;
    if (ws.readyState !== WebSocket.OPEN) return;
    while (pending.map.size > 0 && ws.bufferedAmount <= MAX_WS_BUFFER) {
      const next = pending.map.entries().next();
      if (next.done) break;
      const [key, serialized] = next.value;
      pending.map.delete(key);
      pending.bytes -= Buffer.byteLength(serialized);
      ws.send(serialized, onStateSent(ws));
    }
    if (pending.map.size === 0) dropPendingState(ws);
  }

  /**
   * Deliver one `state` frame (D2): immediate send while the socket is under
   * threshold and nothing is pending; otherwise defer latest-wins per key.
   * Over the byte ceiling the socket is terminated as stalled (counted) and
   * the map is dropped. `MAX_WS_BUFFER === 0` (no-limit mode) always sends.
   */
  function sendState(ws: WebSocket, key: string, serialized: string): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (MAX_WS_BUFFER === 0) {
      ws.send(serialized);
      return;
    }
    let pending = pendingState.get(ws);
    if (ws.bufferedAmount <= MAX_WS_BUFFER && (pending === undefined || pending.map.size === 0)) {
      ws.send(serialized, onStateSent(ws));
      return;
    }
    if (pending === undefined) {
      pending = { map: new Map(), bytes: 0 };
      pendingState.set(ws, pending);
    }
    const old = pending.map.get(key);
    if (old !== undefined) {
      pending.bytes -= Buffer.byteLength(old);
      coalescedState++;
    }
    const len = Buffer.byteLength(serialized);
    if (pending.bytes + len > MAX_WS_BUFFER) {
      const diag = socketDiag.get(ws);
      if (diag) diag.cause = "stalled";
      ws.terminate();
      stalledSocketsTerminated++;
      dropPendingState(ws);
      // A terminated socket can never receive its reconcile either.
      dropStatusDebt(ws);
      closeOccupancySpan(ws);
      return;
    }
    pending.map.set(key, serialized);
    pending.bytes += len;
    if (pending.timer === undefined) {
      pending.timer = setInterval(() => flushPendingState(ws), STATE_FLUSH_INTERVAL_MS);
    }
  }

  // ── Registry-reconcile debt register ────────────────────────────────────
  // Every REGISTRY frame (`session_updated`, `session_added`, `session_removed`)
  // is transcript-class and has NO recovery path: no seq, no backfill, no
  // guaranteed successor. A session that changes status once and then runs
  // quiet for minutes (a long tool call) therefore shows the stale value until a
  // reconnect — the same unbounded-stale shape for a shed add/remove. A shed
  // registry frame is recorded here as a DEBT owed to that socket: an id, the
  // owed KIND, the shed add's `spawnRequestId`, and a `sawAdd` flag — never a
  // queued payload, so it cannot contribute to the pending-state byte ceiling.
  // On flush the frame is REBUILT from `sessionManager.get(id)`, so nothing
  // stale is ever queued and two partial `updates` never have to be merged.
  // See changes: fix-backpressure-status-and-subagent-frames (D1),
  //              close-registry-frame-shed-gaps (D2).
  interface StatusDebtEntry {
    kind: RegistryDebtKind;
    /** The shed `session_added`'s correlation id; only meaningful while owed `added`. */
    spawnRequestId?: string;
    sawAdd: boolean;
  }
  interface StatusDebt {
    entries: Map<string, StatusDebtEntry>;
    timer?: NodeJS.Timeout;
  }
  const statusDebt = new Map<WebSocket, StatusDebt>();
  let statusReconcileQueued = 0;
  let statusReconcileSent = 0;
  // Own interval, deliberately NOT the pending-state one: that timer exists only
  // when a STATE frame defers, and a socket saturated purely by transcript
  // traffic — the incident's exact shape — never creates it (D3).
  const STATUS_RECONCILE_INTERVAL_MS = 250;

  /**
   * The debt-relevant identity of a registry frame. `session_added` carries its
   * id at `msg.session.id` — the siblings at top-level `sessionId` — so a shared
   * derivation MUST NOT read `msg.sessionId` blindly (it would record
   * `undefined`). Returns `undefined` for every non-registry frame.
   */
  function deliveryInfoOf(
    msg: ServerToBrowserMessage,
  ): { id: string; kind: RegistryDebtKind; spawnRequestId?: string } | undefined {
    switch (msg.type) {
      case "session_updated":
        return { id: msg.sessionId, kind: "updated" };
      case "session_added":
        return msg.spawnRequestId !== undefined
          ? { id: msg.session.id, kind: "added", spawnRequestId: msg.spawnRequestId }
          : { id: msg.session.id, kind: "added" };
      case "session_removed":
        return { id: msg.sessionId, kind: "removed" };
      default:
        return undefined;
    }
  }

  /** Clear the reconcile timer and drop the socket's debt (close/error/terminate). */
  function dropStatusDebt(ws: WebSocket): void {
    const debt = statusDebt.get(ws);
    if (!debt) return;
    if (debt.timer !== undefined) clearInterval(debt.timer);
    statusDebt.delete(ws);
  }

  /**
   * Record a shed registry frame as owed to `ws`; start the timer if idle.
   * Kind precedence is last-write-wins with `updated` unable to downgrade a
   * pending lifecycle kind: a newly recorded `added`/`removed` always
   * overwrites, while a newly recorded `updated` overwrites only an existing
   * `updated` (D2). `sawAdd` is set the moment an `added` is recorded and
   * survives a kind supersede — it is the register's memory that the client was
   * never told the session exists.
   */
  function recordStatusDebt(ws: WebSocket, sessionId: string, kind: RegistryDebtKind, spawnRequestId?: string): void {
    let debt = statusDebt.get(ws);
    if (debt === undefined) {
      debt = { entries: new Map() };
      statusDebt.set(ws, debt);
    }
    const existing = debt.entries.get(sessionId);
    const supersedes = kind !== "updated" || existing === undefined || existing.kind === "updated";
    if (supersedes) {
      const next: StatusDebtEntry = {
        kind,
        sawAdd: kind === "added" ? true : (existing?.sawAdd ?? false),
      };
      // The shed `session_added`'s correlation id is the register's memory of
      // WHICH spawn never got its placeholder cleared, so it survives a later
      // lifecycle kind superseding the `added` kind. Dropping it there would
      // leave the sawAdd-branch reconcile unable to match the pending spawn,
      // forcing the placeholder to wait out the generic timeout (D2).
      const spawnReq = kind === "added" ? spawnRequestId : existing?.spawnRequestId;
      if (spawnReq !== undefined) next.spawnRequestId = spawnReq;
      debt.entries.set(sessionId, next);
    }
    statusReconcileQueued++;
    if (debt.timer === undefined) {
      debt.timer = setInterval(() => flushStatusDebt(ws), STATUS_RECONCILE_INTERVAL_MS);
    }
  }

  /**
   * A lifecycle frame that reaches the wire is this socket's current truth for
   * the id, so any older debt for it is satisfied. Only `session_added` /
   * `session_removed` clear: a delivered `updated` carries a PARTIAL `updates`
   * payload, so it does not supersede the fuller reconcile (D2).
   */
  function clearDebtOnDelivered(ws: WebSocket, info: { id: string; kind: RegistryDebtKind }): void {
    if (info.kind === "updated") return;
    const debt = statusDebt.get(ws);
    if (!debt) return;
    debt.entries.delete(info.id);
    if (debt.entries.size === 0) dropStatusDebt(ws);
  }

  /**
   * Build the reconcile frame for one owed id from CURRENT server state. The
   * branch ORDER is load-bearing (D2): an owed `removed` whose record is
   * absent, still live, or was never announced to this socket resolves to the
   * frame the browser actually needs — never a ghost-ended card, and never a
   * resurrection of a row the socket was told to drop.
   *
   * Record shaping: there is NO separate `session_added` shaping helper — every
   * `broadcastSessionAdded` call site forwards `sessionManager.get(id)`'s
   * current record verbatim. Rebuilding from that SAME accessor here is
   * therefore byte-equivalent to the original broadcast, so the shape cannot
   * drift (D2).
   */
  function buildReconcileFrame(id: string, entry: StatusDebtEntry): ServerToBrowserMessage {
    const session = sessionManager.get(id);
    if (entry.kind === "removed") {
      if (!session) return { type: "session_removed", sessionId: id };
      // A live record means the id was re-registered after the shed removal; an
      // ended record whose `add` was ALSO shed means the browser holds no row.
      // Both want the current record as a reconciled add, not a removal.
      if (session.status !== "ended" || entry.sawAdd) {
        return entry.spawnRequestId !== undefined
          ? { type: "session_added", session, reconciled: true, spawnRequestId: entry.spawnRequestId }
          : { type: "session_added", session, reconciled: true };
      }
      return { type: "session_removed", sessionId: id };
    }
    if (!session) return { type: "session_removed", sessionId: id };
    if (entry.kind === "added") {
      return entry.spawnRequestId !== undefined
        ? { type: "session_added", session, reconciled: true, spawnRequestId: entry.spawnRequestId }
        : { type: "session_added", session, reconciled: true };
    }
    return {
      type: "session_updated",
      sessionId: id,
      // `?? null` is load-bearing. `currentTool` is optional, and the client
      // merges with `{ ...existing, ...updates }` — an `undefined` here is
      // dropped by `JSON.stringify`, so the merge would PRESERVE the stale
      // tool name. `null` is the established clearing value, so a session
      // that finished its tool reconciles to "no tool", not to the old one.
      // `hostPressure` joins the rebuild for the same reason and with the
      // same `?? null` clearing semantics: it is pushed on a TRANSITION
      // only, so a shed recovery frame has no successor — the badge would
      // stay lit until a reconnect.
      // See change: fix-false-unresponsive-badge.
      updates: {
        status: session.status,
        currentTool: session.currentTool ?? null,
        hostPressure: session.hostPressure ?? null,
      },
    };
  }

  /**
   * Re-send each owed id's CURRENT state while the socket is under threshold.
   * The entry is removed BEFORE the send: a reconcile that is itself shed
   * re-records itself at the drop site (self-heal), and any debt recorded
   * during the send therefore survives — a delete-after-send would discard it
   * (D2). Only the settled value is delivered; an intermediate transition
   * inside one flood window is not recovered.
   */
  function flushStatusDebt(ws: WebSocket): void {
    const debt = statusDebt.get(ws);
    if (!debt) return;
    if (ws.readyState !== WebSocket.OPEN) {
      dropStatusDebt(ws);
      closeOccupancySpan(ws);
      return;
    }
    for (const [id, entry] of [...debt.entries]) {
      if (shouldShed(ws.bufferedAmount)) break; // still saturated — the rest stay owed
      debt.entries.delete(id);
      const delivered = sendTo(ws, buildReconcileFrame(id, entry), { sessionId: id });
      // Only a frame that reached the wire counts. `sendTo` re-checks the
      // threshold and can shed this very frame (the X1 race), in which case the
      // id was just re-recorded as owed — counting it as sent would report a
      // delivery that never happened and corrupt the queued/sent attribution.
      if (delivered) statusReconcileSent++;
    }
    // Guard on identity: a delivered lifecycle frame may already have dropped
    // the debt, and a re-record during the loop would have allocated a NEW entry
    // map — dropping through the stale local would then destroy the wrong one.
    if (statusDebt.get(ws) === debt && debt.entries.size === 0) dropStatusDebt(ws);
  }

  // ── Socket buffer occupancy (lever B) ──
  // Sampled at the send-decision sites, which ALREADY read `bufferedAmount` for
  // the shed predicate — so the sample is free of an extra property read, and
  // no timer is introduced. A periodic sampler was tried first and rejected: it
  // breaks the gateway's "zero timers on an unsaturated socket" invariant
  // (browser-gateway-critical-frames P3/E9).
  //
  // Time-above-threshold is measured per socket by an entry/exit span rather
  // than by counting samples, so it stays correct under a bursty send rate.
  // The exit branch is the HOT one, so it is gated on `size > 0` — a field read
  // that is zero in steady state — instead of an unconditional Map lookup.
  const OCCUPANCY_SAMPLE_CAP = 512;
  const occupancySamples: number[] = [];
  let occupancyWriteIdx = 0;
  let occupancyMax = 0;
  let occupancyMsAboveThreshold = 0;
  const occupancyAboveSince = new Map<WebSocket, number>();

  function noteOccupancy(ws: WebSocket, buffered: number, above: boolean): void {
    if (buffered > occupancyMax) occupancyMax = buffered;
    if (occupancySamples.length < OCCUPANCY_SAMPLE_CAP) occupancySamples.push(buffered);
    else {
      occupancySamples[occupancyWriteIdx] = buffered;
      occupancyWriteIdx = (occupancyWriteIdx + 1) % OCCUPANCY_SAMPLE_CAP;
    }
    if (above) {
      if (!occupancyAboveSince.has(ws)) occupancyAboveSince.set(ws, Date.now());
    } else if (occupancyAboveSince.size > 0) {
      const since = occupancyAboveSince.get(ws);
      if (since !== undefined) {
        occupancyMsAboveThreshold += Date.now() - since;
        occupancyAboveSince.delete(ws);
      }
    }
  }

  // ── Test-only shed injector ──
  // Read ONCE at construction, so the production hot path below is a single
  // already-false boolean read that short-circuits before anything else.
  const FORCE_SHED_AVAILABLE = process.env.PI_E2E_FORCE_SHED === "1";
  let forceShedTranscript = false;

  /**
   * The transcript shed predicate, in ONE place: over the byte threshold, or
   * under the test-only injector. Three sites ask (`sendTo`, `fanout`, the
   * reconcile flush) and they must never drift apart — a flush that thought the
   * socket was drained while `sendTo` disagreed would spin.
   * `FORCE_SHED_AVAILABLE` is a construction-time constant, so on a production
   * instance this short-circuits to the bare threshold compare.
   */
  function shouldShed(bufferedAmount: number): boolean {
    if (FORCE_SHED_AVAILABLE && forceShedTranscript) return true;
    return MAX_WS_BUFFER > 0 && bufferedAmount > MAX_WS_BUFFER;
  }

  /** Close an open above-threshold span when the socket goes away. */
  function closeOccupancySpan(ws: WebSocket): void {
    const since = occupancyAboveSince.get(ws);
    if (since === undefined) return;
    occupancyMsAboveThreshold += Date.now() - since;
    occupancyAboveSince.delete(ws);
  }

  /**
   * Deliver one frame to one socket. Returns whether it reached the wire — a
   * `false` means shed, deferred as state, or socket not open. Most callers
   * ignore it; the status reconcile does not (it must not count a shed frame as
   * sent). See change: fix-backpressure-status-and-subagent-frames.
   */
  function sendTo(
    ws: WebSocket,
    msg: ServerToBrowserMessage,
    ctx?: { sessionId?: string; seq?: number; critical?: boolean; criticalBudget?: { remaining: number } },
  ): boolean {
    if (ws.readyState === WebSocket.OPEN) {
      // Dispatch on the static frame class (D1/D2): a `state` frame routes
      // through `sendState` (deferred, never shed) so no handler can
      // accidentally send state onto the shedding path. A `critical` ctx
      // stays on the blocking exemption below — that flag, not the type,
      // defines the blocking class.
      const { cls, key } = frameClassOf(msg);
      if (cls === "state" && ctx?.critical !== true) {
        sendState(ws, key, JSON.stringify(msg));
        return false;
      }
      // Transcript/blocking: already-flushable pending state goes first, so
      // a state frame never waits behind a later transcript frame (D2).
      if (pendingState.get(ws)?.map.size) flushPendingState(ws);
      const buffered = ws.bufferedAmount;
      noteOccupancy(ws, buffered, MAX_WS_BUFFER > 0 && buffered > MAX_WS_BUFFER);
      // Drop transcript messages if the send buffer is full (browser not consuming).
      // A `critical` frame (pending-prompt replay / resync reply) is exempt
      // from the shed while under the absolute ceiling and within its
      // per-delivery budget — the one carve-out that keeps a blocking prompt
      // deliverable on a socket a full replay just saturated.
      // See change: fix-pending-prompt-lost-on-replay (D1/D2).
      if (shouldShed(buffered)) {
        const exempt =
          ctx?.critical === true &&
          ws.bufferedAmount <= CRITICAL_FRAME_CEILING &&
          (ctx.criticalBudget === undefined || ctx.criticalBudget.remaining > 0);
        if (!exempt) {
          recordDroppedFrame(ctx?.sessionId, ctx?.seq, ws.bufferedAmount, ctx?.critical === true ? "blocking" : "transcript");
          // A shed registry frame is a debt, not a loss — including a shed
          // RECONCILE, which re-enters here and is re-recorded with its kind (D2).
          const info = deliveryInfoOf(msg);
          if (info !== undefined) recordStatusDebt(ws, info.id, info.kind, info.spawnRequestId);
          return false;
        }
        if (ctx.criticalBudget !== undefined) ctx.criticalBudget.remaining--;
      }
      ws.send(JSON.stringify(msg));
      // A delivered lifecycle frame is this socket's current truth for the id,
      // so it satisfies any older debt for that id (D2).
      const deliveredInfo = deliveryInfoOf(msg);
      if (deliveredInfo !== undefined) clearDebtOnDelivered(ws, deliveredInfo);
      return true;
    }
    return false;
  }

  /**
   * D4 — project a live `sessions_reordered` through a fresh snapshot window
   * BEFORE serialization (fanout only sees strings). Filtering by the GLOBAL
   * visible set is exactly per-group: a group's first-3 contains only that
   * group's ids, so a group's own ids are in the global set iff they are in
   * the group's window. Terminal ids and out-of-window ended ids drop here,
   * at the single choke point every reorder site routes through.
   * Guarded for lean fakes lacking the window fn (folderHeadSnapshot precedent).
   * See change: fix-connect-snapshot-frame-loss (D4).
   */
  function projectOrderThroughWindow(ids: readonly string[]): string[] {
    if (typeof sessionManager.snapshotVisibleIds !== "function") return [...ids];
    const pinned = preferencesStore?.getPinnedDirectories?.() ?? [];
    const visible = sessionManager.snapshotVisibleIds(pinned);
    return ids.filter((id) => visible.has(id));
  }

  function broadcast(msg: ServerToBrowserMessage) {
    // Serialize once per fan-out: O(payload) instead of O(payload ×
    // subscribers). Matters for large recurring frames such as
    // `openspec_update` on repos with many changes. Back-pressure and
    // liveness guards are preserved (mirrors `sendTo`).
    // See change: scope-openspec-poll-to-active-cwds.
    if (msg.type === "sessions_reordered") {
      msg = { ...msg, sessionIds: projectOrderThroughWindow(msg.sessionIds) };
    }
    const { cls, key } = frameClassOf(msg);
    const serialized = JSON.stringify(msg);
    // `fanout` sees only the serialized string and cannot recover the frame's
    // type or session id without parsing it. `broadcast` still holds the TYPED
    // message, so the shed site's debt identity is derived here and passed down
    // (D2). A non-registry frame yields `undefined` and pays nothing.
    const dirty = deliveryInfoOf(msg);
    fanout(serialized, cls === "state" ? key : undefined, dirty);
  }

  function fanout(
    serialized: string,
    stateKey?: string,
    dirty?: { id: string; kind: RegistryDebtKind; spawnRequestId?: string },
  ) {
    for (const [ws] of subscriptions) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (stateKey !== undefined) {
        // State class: deferred when over threshold, never shed (D2).
        sendState(ws, stateKey, serialized);
        continue;
      }
      // Transcript class: already-flushable pending state goes first (D2).
      if (pendingState.get(ws)?.map.size) flushPendingState(ws);
      const buffered = ws.bufferedAmount;
      noteOccupancy(ws, buffered, MAX_WS_BUFFER > 0 && buffered > MAX_WS_BUFFER);
      if (shouldShed(buffered)) {
        recordDroppedFrame(undefined, undefined, buffered, "transcript");
        // A shed registry frame is a debt, not a loss (D2).
        if (dirty !== undefined) recordStatusDebt(ws, dirty.id, dirty.kind, dirty.spawnRequestId);
        continue;
      }
      ws.send(serialized);
      // A delivered lifecycle frame is this socket's current truth for the id,
      // so it satisfies any older debt for that id (D2).
      if (dirty !== undefined) clearDebtOnDelivered(ws, dirty);
    }
  }

  /**
   * Build the `openspec_update` envelope by concatenating the (small) header
   * with the (large) pre-stringified `data` from the worker. Equivalent to
   * `JSON.stringify({ type:"openspec_update", cwd, data })` but skips the
   * `data` re-stringify entirely. See change: offload-openspec-poll-to-worker.
   */
  function broadcastOpenSpecUpdateImpl(cwd: string, dataSerialized: string) {
    const header = `{"type":"openspec_update","cwd":${JSON.stringify(cwd)},"data":`;
    const serialized = header + dataSerialized + "}";
    // Pre-serialized state frame: hand fanout the D1 delivery key directly.
    fanout(serialized, `openspec_update:${cwd}`, undefined);
  }

  wss.on("connection", (ws, req) => {
    const remoteAddr = req?.socket?.remoteAddress ?? 'unknown';
    const origin = req?.headers?.origin ?? 'no-origin';
    const ua = req?.headers?.['user-agent'] ?? 'no-ua';
    console.error(`[browser-gw] browser client connected from ${remoteAddr} origin=${origin} ua=${ua.slice(0, 80)} (total: ${subscriptions.size + 1})`);
    const subs = new Set<string>();
    subscriptions.set(ws, subs);
    const diag: SocketDiag = { connectedAt: Date.now(), frames: 0, missedPongs: 0, lastBuffered: 0, cause: "peer" };
    socketDiag.set(ws, diag);
    ws.on("pong", () => {
      diag.missedPongs = 0;
    });
    if (wss.clients.has(ws)) startKeepalive();

    // Send pinned directories on connect
    if (preferencesStore) {
      // Collapsed folders go FIRST in the burst, UNCONDITIONALLY (incl. empty).
      // Not merely "before `sessions_snapshot`": `pinned_dirs_updated` and
      // `workspaces_updated` each materialize folder GROUPS on their own (a
      // pinned dir with zero sessions is a rendered card), so a collapsed
      // folder sent after either of them mounts expanded and is corrected one
      // message later — the expanded-then-corrected frame this change exists to
      // remove (measured: body mounted at 533ms, echo at 534ms). It is also the
      // "initial state has arrived" signal the one-shot migration waits on.
      // Classified `cls: "state"` by `frameClassOf` so buffer pressure
      // coalesces it rather than shedding it as a transcript frame.
      // See changes: persist-folder-collapse-server-side,
      //              fix-connect-snapshot-frame-loss.
      if (typeof preferencesStore.getCollapsedFolders === "function") {
        sendTo(ws, {
          type: "collapsed_folders_updated",
          collapsedFolders: preferencesStore.getCollapsedFolders(),
        });
      }
      sendTo(ws, { type: "pinned_dirs_updated", paths: preferencesStore.getPinnedDirectories() });
      // Send favorite models snapshot on connect. Guarded with `typeof` so
      // old PreferencesStore stubs in tests don't crash.
      // See change: enrich-model-selector-capabilities-favorites.
      if (typeof preferencesStore.getFavoriteModels === "function") {
        sendTo(ws, { type: "favorite_models_updated", labels: preferencesStore.getFavoriteModels() });
      }
      // Send current workspaces snapshot. See change: folder-workspaces.
      // Guarded with `typeof` so old PreferencesStore stubs in tests that
      // predate workspaces still work — they simply get no workspace snapshot.
      if (typeof preferencesStore.getWorkspaces === "function") {
        sendTo(ws, { type: "workspaces_updated", workspaces: preferencesStore.getWorkspaces() });
      }
      // Send display-prefs snapshot on connect so a client that missed a live
      // `display_prefs_updated` broadcast (socket not OPEN at broadcast time)
      // recovers on reconnect without a page reload — parity with the sibling
      // prefs above. Guarded with `typeof` for old stubs; sent ONLY when prefs
      // are defined so a genuinely seedless install still opens the first-launch
      // modal exactly once. See change: fix-first-launch-display-modal-stuck-on-mobile.
      if (typeof preferencesStore.getDisplayPrefs === "function") {
        const displayPrefs = preferencesStore.getDisplayPrefs();
        if (displayPrefs !== undefined) {
          sendTo(ws, { type: "display_prefs_updated", prefs: displayPrefs });
        }
      }
    }

    // Replay the current bind-vs-trust reachability so a browser that was
    // disconnected while `pendingBindHost` changed converges on connect rather
    // than showing a stale advisory until the next reload (#X6).
    // See change: warn-unreachable-trusted-networks.
    {
      const reachability = getLastBindReachability();
      if (reachability) sendTo(ws, { type: "reachability_updated", reachability });
    }

    // Send OpenSpec data for every known directory — exactly one
    // `openspec_update` per cwd, never silently omit.
    // See change: fix-cold-boot-openspec-protocol.
    if (directoryService) {
      for (const msg of buildOpenSpecConnectSnapshot(directoryService, hasOpenSpecDir, hasOpenSpecRoot)) {
        sendTo(ws, msg);
      }
      // Replay the cached folder-HEAD map to THIS socket only. `git_head_update`
      // is broadcast on first-seen-or-change, so a browser connecting after the
      // server cached a folder would otherwise never learn its HEAD. Unicast
      // replay of already-computed state — no git read, no diff, no fan-out.
      // `typeof` guard: hand-built `DirectoryService` fakes lack the accessor
      // (precedent: `preferencesStore.getDisplayPrefs` above).
      // See change: fix-folder-header-worktree-branch-leak.
      if (typeof directoryService.folderHeadSnapshot === "function") {
        for (const { cwd, branch } of directoryService.folderHeadSnapshot()) {
          sendTo(ws, { type: "git_head_update", cwd, branch });
        }
      }
    }

    // Send active terminals on connect
    if (terminalManager) {
      for (const terminal of terminalManager.list()) {
        sendTo(ws, { type: "terminal_added", terminal });
      }
    }

    // Notify server of new connection (for mDNS peer list etc.)
    if (gateway.onConnect) {
      gateway.onConnect(ws);
    }

    // Atomic windowed snapshot of the session registry + per-group orders,
    // sent LAST in the bootstrap (D3): every small idempotent state frame
    // above is already on the wire, so the one large frame never queues ahead
    // of them on a slow socket. Still the first session-registry send. Client
    // REPLACES (not merges) its `sessions` Map and `sessionOrderMap` on
    // receipt. `endedTotals` counts ended per group regardless of window.
    // See changes: fix-stale-sessions-on-reconnect,
    //              fix-connect-snapshot-frame-loss (D3/D4).
    {
      const pinnedDirs = preferencesStore?.getPinnedDirectories?.() ?? [];
      // `typeof` guard: hand-rolled fakes may predate the window API
      // (folderHeadSnapshot precedent); they fall back to the full list.
      const snapshot = typeof sessionManager.buildSnapshot === "function"
        ? sessionManager.buildSnapshot(pinnedDirs)
        : { sessions: sessionManager.listAll(), orders: {} as Record<string, string[]>, endedTotals: {} as Record<string, number> };
      sendTo(ws, {
        type: "sessions_snapshot",
        ...snapshot,
        // Archived counts come from the index, not the (non-resident) sessions.
        // See change: archive-sessions-lazy-load.
        archivedCountByCwd: sessionArchive?.countsByKey() ?? {},
      });
    }


    ws.on("message", async (raw) => {
      diag.frames++;
      // Malformed (non-JSON) frames are silently dropped. Only frame-parse
      // errors are swallowed here — handler exceptions are logged below so
      // real bugs (e.g. node-pty spawn failures) are not silently hidden.
      let msg: BrowserToServerMessage;
      try {
        msg = JSON.parse(raw.toString()) as BrowserToServerMessage;
      } catch {
        return;
      }
      try {
        const ctx: BrowserHandlerContext = {
          ws, sessionManager, eventStore, piGateway,
          pendingForkRegistry, sessionOrderManager, preferencesStore,
          metaPersistence,
          fitWorkerPool,
          maxReplayEvents,
          replayWindowMode,
          directoryService, terminalManager,
          headlessPidRegistry, pendingResumeRegistry, pendingDashboardSpawns,
          pendingAttachRegistry,
          pendingInitialPromptRegistry,
          pendingResumeIntents,
          pendingClientCorrelations,
          pendingWorktreeBaseRegistry,
          sessionArchive,
          pendingArchiveIntents,
          remoteTranscriptStore,
          isRecoveryLivenessPending: gateway.isRecoveryLivenessPending,
          recordResyncRequester: (requestId, requesterWs) =>
            resyncRequesters.record(requestId, requesterWs),
          sendTo, broadcast, getSubscribers, replayPendingUiRequests, replayNotifyLog,
          broadcastEvent: gateway.broadcastEvent,
          trackUiRequest: trackUiRequest,
          markReplaying(targetWs, sessionId) {
            let set = replayingSessions.get(targetWs);
            if (!set) { set = new Set(); replayingSessions.set(targetWs, set); }
            set.add(sessionId);
          },
          clearReplaying(targetWs, sessionId, lastReplayedSeq) {
            const set = replayingSessions.get(targetWs);
            if (set) {
              set.delete(sessionId);
              if (set.size === 0) replayingSessions.delete(targetWs);
            }
            // Send catch-up: any events after lastReplayedSeq
            if (lastReplayedSeq > 0) {
              const catchUp = eventStore.getEvents(sessionId, lastReplayedSeq + 1);
              if (catchUp.length > 0) {
                sendTo(targetWs, {
                  type: "event_replay",
                  sessionId,
                  events: catchUp.map((e) => ({ seq: e.seq, event: e.event })),
                  isLast: true,
                });
              }
            }
          },
        };

        switch (msg.type) {
          case "subscribe":
            handleSubscribe(msg, subs, ctx);
            break;
          // Backfill for the gap left by a windowed replay. Serves the
          // in-memory store only; `clearReplaying` catch-up is untouched.
          // See change: lazy-load-session-history.
          case "history_backfill":
            await handleHistoryBackfill(msg, subs, ctx);
            break;
          case "unsubscribe":
            subs.delete(msg.sessionId);
            clearGapState(ws, msg.sessionId);
            // Cancel an in-flight hydration once the last subscriber leaves,
            // so clicking session A then B doesn't waste A's parse+replay and
            // deliver an event_replay to a now-unsubscribed ws. Guarded by the
            // subscriber count so co-subscribers' loads aren't dropped.
            // See change: offload-session-events-load-to-worker.
            if (directoryService && getSubscribers(msg.sessionId).length === 0) {
              directoryService.cancelLoad(msg.sessionId);
            }
            break;
          case "send_prompt":
            await handleSendPrompt(msg, ctx);
            break;
          case "abort":
            handleAbort(msg, ctx);
            break;
          // First-class settled-error retry. MUST be an explicit case: the
          // default forwarder drops unknown types, so a bare union addition
          // would let the server silently swallow the message. See change:
          // replace-dashboard-retry-command-with-protocol-message.
          case "retry_session":
            // Validate the wire input before dispatch (JSON.parse does not check
            // the discriminated union at runtime), mirroring the adjacent
            // stop_after_turn guard. A malformed payload is ignored rather than
            // driving a negative-ack with a bogus sessionId.
            if (typeof msg.sessionId === "string" && msg.sessionId.length > 0) {
              handleRetrySession(msg, ctx);
            }
            break;
          case "stop_after_turn":
            if (typeof msg.sessionId === "string" && msg.sessionId.length > 0) {
              handleStopAfterTurn(msg, ctx);
            }
            break;
          // ── Follow-up queue mutation (bridge-owned buffer) ─────────────────
          //
          // The bridge mutates `bridgeFollowUp` locally; nothing touches
          // pi. The OLD pi-mutation message types (clear_steering_queue,
          // clear_followup_slot, edit_followup_slot) STAY DELETED.
          // See change: rework-mid-turn-prompt-queue.
          case "clear_followup_entries":
            handleClearFollowupEntries(msg, ctx);
            break;
          case "edit_followup_entry":
            handleEditFollowupEntry(msg, ctx);
            break;
          case "remove_followup_entry":
            handleRemoveFollowupEntry(msg, ctx);
            break;
          case "promote_followup_entry":
            handlePromoteFollowupEntry(msg, ctx);
            break;
          case "force_kill":
            await handleForceKill(msg, ctx);
            break;
          case "flow_control":
            handleFlowControl(msg, ctx);
            break;
          case "kill_process":
            handleKillProcess(msg, ctx);
            break;
          case "subagent_resync_request":
            handleSubagentResyncRequest(msg, ctx);
            break;
          case "prompt_resync_request":
            handlePromptResyncRequest(msg, ctx);
            break;
          case "shutdown":
            // Awaited like every other async case in this switch, so a rejection
            // reaches the dispatch-level catch below instead of floating.
            // See change: cleanup-async-semantics-server-extension (design D1).
            await handleShutdown(msg, ctx);
            break;
          case "rename_session":
            handleRenameSession(msg, ctx);
            break;
          case "archive_session":
            // Async: an idle-alive archive terminates the process first.
            await handleArchiveSession(msg, ctx);
            break;
          case "unarchive_session":
            handleUnarchiveSession(msg, ctx);
            break;
          case "attach_proposal":
            handleAttachProposal(msg, ctx);
            break;
          case "detach_proposal":
            handleDetachProposal(msg, ctx);
            break;
          case "accept_replace_proposal":
            handleAcceptReplaceProposal(msg, ctx);
            break;
          case "dismiss_replace_proposal":
            handleDismissReplaceProposal(msg, ctx);
            break;
          case "setSessionDisplayPrefs":
            handleSetSessionDisplayPrefs(msg, ctx);
            break;
          case "set_session_process_drawer":
            handleSetSessionProcessDrawer(msg, ctx);
            break;
          case "set_session_tags":
            handleSetSessionTags(msg, ctx);
            break;
          case "remove_tag_globally":
            handleRemoveTagGlobally(msg, ctx);
            break;
          case "fetch_content":
            handleFetchContent(msg, ctx);
            break;
          case "list_sessions":
            handleListSessions(msg, ctx);
            break;
          // Explicit case (D5): the default arm would misroute `sessions_page`
          // to the bridge forwarder. Unicast reply via `sendTo` → `sendState`.
          // See change: fix-connect-snapshot-frame-loss.
          case "sessions_page":
            handleSessionsPage(msg, ctx);
            break;
          case "resume_session":
            // Reopen resolves a pending recovery offer (null it so onConnect
            // stops replaying it) — but NOT when the resume will be refused
            // because a candidate's liveness is still unresolved (grace window).
            // Clearing it there would drop the offer for a genuinely-lost
            // session the user can legitimately reopen once the window closes.
            // See changes: fix-recovery-offer-dismiss-and-phantom-reopen,
            //              fix-recovery-offer-bridge-liveness-gate.
            if (!gateway.isRecoveryLivenessPending?.(msg.sessionId)) {
              gateway.onRecoveryResolve?.();
            }
            await handleResumeSession(msg, ctx);
            break;
          case "spawn_session":
            await handleSpawnSession(msg, ctx);
            break;
          case "reorder_sessions":
            handleReorderSessions(msg, ctx);
            break;
          case "pin_directory":
            handlePinDirectory(msg, ctx);
            break;
          case "unpin_directory":
            handleUnpinDirectory(msg, ctx);
            break;
          case "reorder_pinned_dirs":
            handleReorderPinnedDirs(msg, ctx);
            break;
          case "favorite_model":
            handleFavoriteModel(msg, ctx);
            break;
          case "unfavorite_model":
            handleUnfavoriteModel(msg, ctx);
            break;
          case "create_workspace":
            handleCreateWorkspace(msg, ctx);
            break;
          case "rename_workspace":
            handleRenameWorkspace(msg, ctx);
            break;
          case "delete_workspace":
            handleDeleteWorkspace(msg, ctx);
            break;
          case "set_workspace_collapsed":
            handleSetWorkspaceCollapsed(msg, ctx);
            break;
          case "set_folder_collapsed":
            handleSetFolderCollapsed(msg, ctx);
            break;
          case "add_folder_to_workspace":
            handleAddFolderToWorkspace(msg, ctx);
            break;
          case "remove_folder_from_workspace":
            handleRemoveFolderFromWorkspace(msg, ctx);
            break;
          case "reorder_workspace_folders":
            handleReorderWorkspaceFolders(msg, ctx);
            break;
          case "reorder_workspaces":
            handleReorderWorkspaces(msg, ctx);
            break;
          case "move_folder_to_workspace":
            handleMoveFolderToWorkspace(msg, ctx);
            break;
          // Explicit case (D6): the default arm would misroute `openspec_get`
          // to the bridge forwarder. Unicast replies via `sendTo` → `sendState`.
          // See change: fix-connect-snapshot-frame-loss.
          case "openspec_get":
            handleOpenSpecGet(msg, ctx);
            break;
          case "openspec_refresh":
            handleOpenSpecRefresh(msg, ctx);
            break;
          case "openspec_bulk_archive":
            handleOpenSpecBulkArchive(msg, ctx);
            break;
          case "recovery_dismiss": {
            // Durable dismissal of a cold-start recovery offer. Consume the
            // on-disk liveness marker for each offered session so it is never
            // re-classified as a recovery candidate (mirrors Chrome consuming
            // its crash sentinel), then flush so the change hits disk before
            // any restart. The server's onRecoveryDismiss callback nulls its
            // held pendingRecoveryOffer so onConnect replay stops.
            // See change: fix-recovery-offer-dismiss-and-phantom-reopen.
            for (const id of msg.sessionIds) {
              const session = sessionManager.get(id);
              if (session?.sessionFile) {
                metaPersistence?.setLiveness(session.sessionFile, { live: false });
              }
            }
            metaPersistence?.flushAll();
            gateway.onRecoveryDismiss?.(msg.sessionIds);
            break;
          }
          case "extension_ui_response": {
            // Clear pending UI request tracking, then forward on the shared
            // path the REST twin uses too (D3).
            clearUiRequestImpl(msg.sessionId, msg.requestId);
            handleExtensionUiResponse(msg, ctx);
            break;
          }

          case "prompt_response": {
            // Route PromptBus response from browser to extension
            ctx.piGateway.sendToSession((msg as any).sessionId, msg as any);
            break;
          }

          case "flow_management": {
            ctx.piGateway.sendToSession(msg.sessionId, {
              type: "flow_management",
              sessionId: msg.sessionId,
              action: msg.action,
              flowName: msg.flowName,
              task: msg.task,
              description: msg.description,
              enabled: msg.enabled,
            });
            break;
          }
          case "architect_prompt_response": {
            // Legacy: now handled by prompt_response via PromptBus.
            // Keep case to avoid "unhandled message" warnings from old clients.
            break;
          }
          case "role_set": {
            ctx.piGateway.sendToSession(msg.sessionId, {
              type: "role_set",
              sessionId: msg.sessionId,
              role: (msg as any).role,
              modelId: (msg as any).modelId,
            });
            break;
          }
          case "role_preset_load": {
            ctx.piGateway.sendToSession(msg.sessionId, {
              type: "role_preset_load",
              sessionId: msg.sessionId,
              presetName: (msg as any).presetName,
            });
            break;
          }
          case "role_preset_save": {
            ctx.piGateway.sendToSession(msg.sessionId, {
              type: "role_preset_save",
              sessionId: msg.sessionId,
              presetName: (msg as any).presetName,
            });
            break;
          }
          case "role_preset_delete": {
            ctx.piGateway.sendToSession(msg.sessionId, {
              type: "role_preset_delete",
              sessionId: msg.sessionId,
              presetName: (msg as any).presetName,
            });
            break;
          }
          case "role_remove": {
            ctx.piGateway.sendToSession(msg.sessionId, {
              type: "role_remove",
              sessionId: msg.sessionId,
              role: (msg as any).role,
            });
            break;
          }
          case "request_roles": {
            ctx.piGateway.sendToSession(msg.sessionId, {
              type: "request_roles",
              sessionId: msg.sessionId,
            });
            break;
          }
          case "ui_management": {
            // Extension UI System (Phase 1): forward browser action / data
            // request to the bridge unchanged. The bridge re-emits on
            // pi.events; the extension replies via ui_data_list (round-trip
            // handled in event-wiring).
            // See change: add-extension-ui-modal.
            ctx.piGateway.sendToSession(msg.sessionId, {
              type: "ui_management",
              sessionId: msg.sessionId,
              action: msg.action,
              event: msg.event,
              params: msg.params,
            });
            break;
          }
          case "create_terminal":
            handleCreateTerminal(msg, ctx);
            break;
          case "open_inline_terminal":
            handleOpenInlineTerminal(msg, ctx);
            break;
          case "close_inline_terminal":
            handleCloseInlineTerminal(msg, ctx);
            break;
          case "kill_terminal":
            handleKillTerminal(msg, ctx);
            break;
          case "rename_terminal":
            handleRenameTerminal(msg, ctx);
            break;
          case "session_view": {
            // Browser declares it is currently displaying this session.
            // Track the (sessionId, ws) pair AND clear `unread` if set.
            // See change: session-card-unread-stripes.
            viewedSessionTracker.view(msg.sessionId, ws);
            const session = sessionManager.get(msg.sessionId);
            if (session?.unread) {
              sessionManager.update(msg.sessionId, { unread: false });
              broadcast({
                type: "session_updated",
                sessionId: msg.sessionId,
                updates: { unread: false },
              });
            }
            break;
          }
          case "session_unview": {
            viewedSessionTracker.unview(msg.sessionId, ws);
            break;
          }
          default: {
            const type = (msg as { type?: string } | undefined)?.type;
            // plugin_action fans out by pluginId to the owning plugin's handler.
            // Unknown pluginId → structured error to the sender, never a silent
            // drop. See change: fix-plugin-action-fanout-and-handlers.
            if (type === "plugin_action") {
              const pa = msg as { pluginId?: string; action?: string };
              const handler = pa.pluginId ? pluginActionHandlers.get(pa.pluginId) : undefined;
              if (handler) {
                handler(msg, ws);
              } else {
                sendTo(ws, {
                  type: "plugin_action_error",
                  pluginId: pa.pluginId ?? "",
                  ...(pa.action ? { action: pa.action } : {}),
                  error: `no plugin_action handler for pluginId "${pa.pluginId ?? ""}"`,
                });
                console.error(
                  `[browser-gw] plugin_action dropped: no handler for pluginId=${pa.pluginId ?? "(none)"} action=${pa.action ?? "(none)"}`,
                );
              }
            } else if (type && customHandlers.has(type)) {
              // Plugin-registered custom handler takes precedence over pi-gateway forward.
              customHandlers.get(type)!(msg, ws);
            } else {
              // Forward simple pi-gateway commands
              handlePiGatewayForward(msg, ctx);
            }
            break;
          }
        }
      } catch (err) {
        const type = (msg as { type?: string } | undefined)?.type ?? "unknown";
        console.error(
          `[browser-gw] handler error type=${type}:`,
          err,
        );
        // Connection intentionally remains open so subsequent messages are still processed.
      }
    });

    ws.on("close", (code?: number, reason?: Buffer) => {
      console.error(
        `[browser-gw] browser client disconnected (remaining: ${subscriptions.size - 1})` +
          ` code=${code ?? "none"} reason=${JSON.stringify(reason ? reason.toString("utf8") : "")}` +
          ` lifetime=${((Date.now() - diag.connectedAt) / 1000).toFixed(1)}s frames=${diag.frames} cause=${diag.cause}`,
      );
      if (wss.clients.size === 0) stopKeepalive();
      subscriptions.delete(ws);
      replayingSessions.delete(ws);
      // A closed socket can never flush; discard its pending state (D2).
      dropPendingState(ws);
      // …nor its owed status reconciles; release the set AND its timer.
      dropStatusDebt(ws);
      closeOccupancySpan(ws);
      // A disconnected requester can never receive its reply; drop its tokens
      // so the map cannot accumulate them. See change: reduce-subagent-details-payload.
      resyncRequesters.forget(ws);
      // Drop this ws from every viewed-session entry so disconnected browsers
      // don't hold sessions in the viewed state. See change: session-card-unread-stripes.
      viewedSessionTracker.unviewAll(ws);
      // Tear down per-connection resources (open-files watch, …).
      // See change: split-editor-workspace.
      for (const fn of disconnectHandlers) {
        try {
          fn(ws);
        } catch (err) {
          console.error("[browser-gw] disconnect handler error:", err);
        }
      }
    });

    // An errored socket will close, but clear the pending state immediately —
    // its timer must not outlive the socket (D2).
    ws.on("error", () => {
      dropPendingState(ws);
      dropStatusDebt(ws);
      closeOccupancySpan(ws);
    });
  });

  const gateway: BrowserGateway = {
    wss,

    sendToClient(ws: WebSocket, msg: ServerToBrowserMessage) {
      sendTo(ws, msg);
    },

    broadcast(msg: ServerToBrowserMessage) {
      broadcast(msg);
    },

    registerHandler(type, handler) {
      customHandlers.set(type, handler);
    },

    registerPluginActionHandler(pluginId, handler) {
      if (pluginActionHandlers.has(pluginId)) {
        console.warn(
          `[browser-gw] duplicate plugin_action handler for pluginId=${pluginId}; replacing (manifest ids should be unique)`,
        );
      }
      pluginActionHandlers.set(pluginId, handler);
    },

    registerDisconnectHandler(handler) {
      disconnectHandlers.push(handler);
    },

    broadcastEvent(sessionId: string, seq: number, event: any) {
      const subscribers = getSubscribers(sessionId);
      const msg: ServerToBrowserMessage = {
        type: "event",
        sessionId,
        seq,
        event,
      };
      // In-process subscribers always get the frame — the requester-scoped
      // resync narrowing below is a WebSocket concern only.
      // See change: add-chat-gateway.
      deliverInProcess(sessionId, msg);
      // Requester-scoped resync delivery (C5): a reply carrying a known
      // correlation token goes to the ONE connection that asked, so a cadence
      // of fat replies is not multiplied by the number of viewers. An unknown
      // or expired token falls through to the ordinary fan-out below.
      // See change: reduce-subagent-details-payload.
      const requestId = resyncRequestIdOf(event?.data as Record<string, unknown> | undefined);
      if (requestId) {
        const requester = resyncRequesters.take(requestId);
        if (requester && subscribers.includes(requester)) {
          if (!replayingSessions.get(requester)?.has(sessionId)) {
            sendTo(requester, msg, { sessionId, seq });
          }
          return;
        }
      }
      for (const ws of subscribers) {
        // Skip WebSockets that are mid-replay for this session
        const replaying = replayingSessions.get(ws);
        if (replaying?.has(sessionId)) continue;
        // Carry sessionId+seq so a back-pressure drop of a live event (the
        // stuck-tool-card cause) is attributable in the warning + counter.
        // See change: fix-stuck-tool-card-on-dropped-event.
        sendTo(ws, msg, { sessionId, seq });
      }
    },

    broadcastSessionAdded(session: any, opts?: { spawnRequestId?: string }) {
      // Carry the originating client `requestId` (when known) so the
      // browser can auto-select / dismiss its placeholder by exact
      // correlation. See change: spawn-correlation-token.
      broadcast({
        type: "session_added",
        session,
        ...(opts?.spawnRequestId ? { spawnRequestId: opts.spawnRequestId } : {}),
      });
    },

    broadcastSessionUpdated(sessionId: string, updates: any) {
      broadcast({ type: "session_updated", sessionId, updates });
    },

    broadcastSessionRemoved(sessionId: string) {
      broadcast({ type: "session_removed", sessionId });
    },

    shutdownSession(sessionId: string) {
      return shutdownSessionImpl(sessionId, {
        sessionManager,
        piGateway,
        headlessPidRegistry,
        broadcast,
        metaPersistence,
      });
    },

    broadcastSessionStateReset(sessionId: string) {
      const subscribers = getSubscribers(sessionId);
      const msg: ServerToBrowserMessage = { type: "session_state_reset", sessionId };
      for (const ws of subscribers) {
        sendTo(ws, msg);
      }
      deliverInProcess(sessionId, msg);
    },

    sendToSubscribers(sessionId: string, msg: ServerToBrowserMessage) {
      const subscribers = getSubscribers(sessionId);
      for (const ws of subscribers) {
        sendTo(ws, msg);
      }
      deliverInProcess(sessionId, msg);
    },

    addInProcessSubscriber(sessionId: string, handler: (msg: ServerToBrowserMessage) => void) {
      let handlers = inProcessSubscribers.get(sessionId);
      if (!handlers) {
        handlers = new Set();
        inProcessSubscribers.set(sessionId, handlers);
      }
      handlers.add(handler);
      let active = true;
      return () => {
        // Idempotent: a second call must not evict a sibling unsubscribe.
        if (!active) return;
        active = false;
        const current = inProcessSubscribers.get(sessionId);
        if (!current) return;
        current.delete(handler);
        if (current.size === 0) inProcessSubscribers.delete(sessionId);
      };
    },

    replayPendingPromptsTo(sessionId: string, handler: (msg: ServerToBrowserMessage) => void) {
      const sessionPrompts = pendingPromptRequests.get(sessionId);
      if (!sessionPrompts) return;
      for (const msg of sessionPrompts.values()) {
        invokeSubscriber(handler, msg as unknown as ServerToBrowserMessage, "prompt replay", sessionId);
      }
    },

    broadcastToAll(msg: ServerToBrowserMessage) {
      broadcast(msg);
    },

    broadcastOpenSpecUpdate(cwd: string, dataSerialized: string) {
      broadcastOpenSpecUpdateImpl(cwd, dataSerialized);
    },

    getSubscriberCount(sessionId: string): number {
      return getSubscribers(sessionId).length;
    },

    hasPendingUiRequest(sessionId: string): boolean {
      const sessionMap = pendingUiRequests.get(sessionId);
      return sessionMap !== undefined && sessionMap.size > 0;
    },

    hasPendingPromptRequests(sessionId: string): boolean {
      const sessionMap = pendingPromptRequests.get(sessionId);
      return sessionMap !== undefined && sessionMap.size > 0;
    },

    getDroppedFrameStats(): DroppedFrameStats {
      return {
        total: droppedFramesTotal,
        bySession: Object.fromEntries(droppedFramesBySession),
        blocking: {
          total: droppedBlockingTotal,
          bySession: Object.fromEntries(droppedBlockingBySession),
        },
        coalescedState,
        stalledSocketsTerminated,
        statusReconcileQueued,
        statusReconcileSent,
      };
    },

    getPendingStateInfo(ws: WebSocket): { entries: number; bytes: number } | undefined {
      const pending = pendingState.get(ws);
      if (!pending) return undefined;
      return { entries: pending.map.size, bytes: pending.bytes };
    },

    getStatusReconcileInfo(ws: WebSocket): {
      owed: string[];
      timerActive: boolean;
      entries: StatusDebtEntryInfo[];
    } | undefined {
      const debt = statusDebt.get(ws);
      if (!debt) return undefined;
      return {
        owed: [...debt.entries.keys()],
        timerActive: debt.timer !== undefined,
        entries: [...debt.entries].map(([id, e]) => ({
          id,
          kind: e.kind,
          sawAdd: e.sawAdd,
          ...(e.spawnRequestId !== undefined ? { spawnRequestId: e.spawnRequestId } : {}),
        })),
      };
    },

    setTestForceShed(enabled: boolean): boolean {
      if (!FORCE_SHED_AVAILABLE) return false;
      forceShedTranscript = enabled;
      // Releasing the injected saturation must not wait for the next 250 ms
      // tick to START — the timer is already running; this just makes the
      // observed convergence window the spec's 1 s rather than 1 s + jitter.
      if (!enabled) for (const [ws] of subscriptions) flushStatusDebt(ws);
      return enabled;
    },

    getSocketBufferOccupancy(): SocketBufferOccupancy {
      // Accrual otherwise happens only on the above→below transition, so during
      // an active stall — the exact case this metric exists to size — every
      // sample is above and the reported duration would stay 0 for the whole
      // incident. So open spans are added here too.
      //
      // First SETTLE spans whose socket has since drained (or closed) without
      // another sampled send. Sampling is event-driven, so such a span would
      // otherwise stay open forever and grow on EVERY health read — an
      // unbounded over-report. Settling is idempotent: the entry is deleted, so
      // a later exit cannot accrue it twice.
      const now = Date.now();
      for (const [ws, since] of [...occupancyAboveSince]) {
        const stillAbove =
          ws.readyState === WebSocket.OPEN && MAX_WS_BUFFER > 0 && ws.bufferedAmount > MAX_WS_BUFFER;
        if (stillAbove) continue;
        occupancyMsAboveThreshold += now - since;
        occupancyAboveSince.delete(ws);
      }
      let msAboveThreshold = occupancyMsAboveThreshold;
      for (const since of occupancyAboveSince.values()) msAboveThreshold += now - since;
      if (occupancySamples.length === 0) return { max: occupancyMax, p95: 0, msAboveThreshold };
      const sorted = [...occupancySamples].sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
      return { max: occupancyMax, p95: sorted[Math.max(0, idx)], msAboveThreshold };
    },

    deliverPromptResyncReply(msg: ServerToBrowserMessage, sessionId: string): boolean {
      const requestId = resyncRequestIdOf(msg as unknown as Record<string, unknown>);
      if (!requestId) return false;
      const requester = resyncRequesters.peek(requestId);
      if (!requester || requester.readyState !== WebSocket.OPEN) return false;
      if (!getSubscribers(sessionId).includes(requester)) return false;
      sendTo(requester, msg, {
        sessionId,
        critical: true,
        criticalBudget: { remaining: CRITICAL_FRAMES_PER_DELIVERY },
      });
      return true;
    },

    trackUiRequest,

    clearUiRequest(sessionId: string, requestId: string) {
      clearUiRequestImpl(sessionId, requestId);
    },

    appendNotify,

    getNotifyLogStats: () => notifyLog.getStats(),

    trackPromptRequest,
    clearPromptRequest,
    reconcilePromptRequests,

    clearPendingRequestsForSession(sessionId: string) {
      pendingUiRequests.delete(sessionId);
      pendingPromptRequests.delete(sessionId);
      // The notify log is deliberately NOT cleared here: an ended session keeps
      // the rows it displayed while alive (Contract 2). Reapability is protected
      // by exclusion — no reaper signal reads this log — not by deletion.
      // See change: split-notify-from-prompt-request.
    },

    shutdownHeadlessProcesses() {
      headlessPidRegistry.killAll();
    },

    headlessPidRegistry,

    pendingResumeRegistry,

    viewedSessionTracker,
  };

  return gateway;
}
