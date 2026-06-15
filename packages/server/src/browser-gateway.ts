/**
 * Browser Gateway - WebSocket handler for browser client connections.
 * Runs on the HTTP server port via upgrade handling.
 */
import { WebSocketServer, WebSocket } from "ws";
import type {
  ServerToBrowserMessage,
  BrowserOpenSpecUpdateMessage,
  BrowserToServerMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { SessionManager } from "./memory-session-manager.js";
import type { EventStore } from "./memory-event-store.js";
import type { PiGateway } from "./pi-gateway.js";
// PendingLoadManager removed — server loads sessions directly via DirectoryService
import { createHeadlessPidRegistry, type HeadlessPidRegistry } from "./headless-pid-registry.js";
import type { PendingForkRegistry } from "./pending-fork-registry.js";
import type { SessionOrderManager } from "./session-order-manager.js";
import type { PreferencesStore } from "./preferences-store.js";
import { hasOpenSpecDir, hasOpenSpecRoot, type DirectoryService } from "./directory-service.js";

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
import { createPendingResumeRegistry, type PendingResumeRegistry } from "./pending-resume-registry.js";
import { createViewedSessionTracker, type ViewedSessionTracker } from "./viewed-session-tracker.js";
import type { TerminalManager } from "./terminal-manager.js";
import type { BrowserHandlerContext } from "./browser-handlers/handler-context.js";
import { handleSubscribe } from "./browser-handlers/subscription-handler.js";
import { ViewMessageStore } from "./view-message-store.js";
import { handleSendPrompt, handleResumeSession, handleSpawnSession, handleShutdown, handleAbort, handleFlowControl, handleForceKill, handleKillProcess, handleClearFollowupEntries, handleEditFollowupEntry, handleRemoveFollowupEntry, handlePromoteFollowupEntry } from "./browser-handlers/session-action-handler.js";
import { handleRenameSession, handleHideSession, handleUnhideSession, handleAttachProposal, handleDetachProposal, handleAcceptReplaceProposal, handleDismissReplaceProposal, handleFetchContent, handleListSessions, handleSetSessionDisplayPrefs, handleSetSessionProcessDrawer } from "./browser-handlers/session-meta-handler.js";
import { handleCreateTerminal, handleKillTerminal, handleRenameTerminal, handleOpenInlineTerminal, handleCloseInlineTerminal } from "./browser-handlers/terminal-handler.js";
import { handlePinDirectory, handleUnpinDirectory, handleReorderPinnedDirs, handleFavoriteModel, handleUnfavoriteModel, handleReorderSessions, handleOpenSpecRefresh, handleOpenSpecBulkArchive, handleExtensionUiResponse, handlePiGatewayForward, handleCreateWorkspace, handleRenameWorkspace, handleDeleteWorkspace, handleSetWorkspaceCollapsed, handleAddFolderToWorkspace, handleRemoveFolderFromWorkspace, handleReorderWorkspaceFolders, handleReorderWorkspaces } from "./browser-handlers/directory-handler.js";



export interface BrowserGateway {
  wss: WebSocketServer;
  broadcastEvent(sessionId: string, seq: number, event: any): void;
  broadcastSessionAdded(session: any, opts?: { spawnRequestId?: string }): void;
  broadcastSessionUpdated(sessionId: string, updates: any): void;
  broadcastSessionRemoved(sessionId: string): void;
  sendToSubscribers(sessionId: string, msg: ServerToBrowserMessage): void;
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
  /** Track a pending interactive UI request for replay on reconnect */
  trackUiRequest(sessionId: string, requestId: string, method: string, params: Record<string, unknown>): boolean | void;
  /** Clear a pending interactive UI request (resolved or cancelled) */
  clearUiRequest(sessionId: string, requestId: string): void;
  /** Track a pending PromptBus request for replay on browser refresh */
  trackPromptRequest(sessionId: string, msg: Record<string, unknown>): void;
  /** Clear a pending PromptBus request (dismissed or cancelled) */
  clearPromptRequest(sessionId: string, promptId: string): void;
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
  pendingAttachRegistry?: import("./pending-attach-registry.js").PendingAttachRegistry,
  pendingResumeIntents?: import("./pending-resume-intent-registry.js").PendingResumeIntentRegistry,
  pendingClientCorrelations?: import("./pending-client-correlations.js").PendingClientCorrelations,
  pendingWorktreeBaseRegistry?: import("./pending-worktree-base-registry.js").PendingWorktreeBaseRegistry,
  metaPersistence?: import("./meta-persistence.js").MetaPersistence,
  viewMessageStore: ViewMessageStore = new ViewMessageStore(),
): BrowserGateway {
  const wss = new WebSocketServer({ noServer: true });

  /**
   * Plugin-registered handlers for custom Browser→Server message types.
   * Lives outside subscriptions because handlers are global, not per-WS.
   * See change: adopt-server-driven-intent-rendering.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customHandlers = new Map<string, (msg: any, ws: WebSocket) => void>();

  // Track subscriptions: ws → Set<sessionId>
  const subscriptions = new Map<WebSocket, Set<string>>();
  // Track which sessions are mid-replay per WebSocket (suppress live events)
  const replayingSessions = new Map<WebSocket, Set<string>>();

  // Track headless child processes with sessionId linkage
  const headlessPidRegistry = createHeadlessPidRegistry();

  // Track which browser is viewing which session (for unread state machine).
  // See change: session-card-unread-stripes.
  const viewedSessionTracker = createViewedSessionTracker();

  // Track pending interactive UI requests per session for replay on reconnect
  const pendingUiRequests = new Map<string, Map<string, { requestId: string; method: string; params: Record<string, unknown> }>>();

  // Track pending PromptBus requests per session for replay on browser refresh
  const pendingPromptRequests = new Map<string, Map<string, Record<string, unknown>>>();

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
    // Also replay pending PromptBus requests
    const sessionPrompts = pendingPromptRequests.get(sessionId);
    if (sessionPrompts) {
      for (const msg of sessionPrompts.values()) {
        sendTo(ws, msg as any);
      }
    }
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

  function getSubscribers(sessionId: string): WebSocket[] {
    const result: WebSocket[] = [];
    for (const [ws, subs] of subscriptions) {
      if (subs.has(sessionId) && ws.readyState === WebSocket.OPEN) {
        result.push(ws);
      }
    }
    return result;
  }

  /** Max buffered bytes per browser WebSocket before dropping messages (0 = no limit) */
  const MAX_WS_BUFFER = maxWsBufferBytes ?? 4 * 1024 * 1024; // 4MB default

  function sendTo(ws: WebSocket, msg: ServerToBrowserMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      // Drop messages if the send buffer is full (browser not consuming)
      if (MAX_WS_BUFFER > 0 && ws.bufferedAmount > MAX_WS_BUFFER) return;
      ws.send(JSON.stringify(msg));
    }
  }

  function broadcast(msg: ServerToBrowserMessage) {
    // Serialize once per fan-out: O(payload) instead of O(payload ×
    // subscribers). Matters for large recurring frames such as
    // `openspec_update` on repos with many changes. Back-pressure and
    // liveness guards are preserved (mirrors `sendTo`).
    // See change: scope-openspec-poll-to-active-cwds.
    const serialized = JSON.stringify(msg);
    fanout(serialized);
  }

  function fanout(serialized: string) {
    for (const [ws] of subscriptions) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (MAX_WS_BUFFER > 0 && ws.bufferedAmount > MAX_WS_BUFFER) continue;
      ws.send(serialized);
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
    fanout(serialized);
  }

  wss.on("connection", (ws, req) => {
    const remoteAddr = req?.socket?.remoteAddress ?? 'unknown';
    const origin = req?.headers?.origin ?? 'no-origin';
    const ua = req?.headers?.['user-agent'] ?? 'no-ua';
    console.error(`[browser-gw] browser client connected from ${remoteAddr} origin=${origin} ua=${ua.slice(0, 80)} (total: ${subscriptions.size + 1})`);
    const subs = new Set<string>();
    subscriptions.set(ws, subs);

    // Atomic snapshot of the full session registry + per-cwd orders.
    // Replaces the legacy per-session `session_added` loop and per-cwd
    // `sessions_reordered` loop. Client REPLACES (not merges) its
    // `sessions` Map and `sessionOrderMap` on receipt so stale ids from a
    // previous server lifetime are dropped atomically.
    // See change: fix-stale-sessions-on-reconnect.
    {
      const sessionsSnapshot = sessionManager.listAll();
      const orders: Record<string, string[]> = {};
      if (sessionOrderManager) {
        for (const [cwd, sessionIds] of Object.entries(sessionOrderManager.getAllOrders())) {
          if (sessionIds.length > 0) orders[cwd] = sessionIds;
        }
      }
      sendTo(ws, { type: "sessions_snapshot", sessions: sessionsSnapshot, orders });
    }

    // Send pinned directories on connect
    if (preferencesStore) {
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
    }

    // Send OpenSpec data for every known directory — exactly one
    // `openspec_update` per cwd, never silently omit.
    // See change: fix-cold-boot-openspec-protocol.
    if (directoryService) {
      for (const msg of buildOpenSpecConnectSnapshot(directoryService, hasOpenSpecDir, hasOpenSpecRoot)) {
        sendTo(ws, msg);
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


    ws.on("message", async (raw) => {
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
          directoryService, terminalManager,
          headlessPidRegistry, pendingResumeRegistry, pendingDashboardSpawns,
          pendingAttachRegistry,
          pendingResumeIntents,
          pendingClientCorrelations,
          pendingWorktreeBaseRegistry,
          sendTo, broadcast, getSubscribers, replayPendingUiRequests,
          broadcastEvent: gateway.broadcastEvent,
          viewMessageStore,
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
          case "unsubscribe":
            subs.delete(msg.sessionId);
            break;
          case "send_prompt":
            await handleSendPrompt(msg, ctx);
            break;
          case "abort":
            handleAbort(msg, ctx);
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
          case "shutdown":
            handleShutdown(msg, ctx);
            break;
          case "rename_session":
            handleRenameSession(msg, ctx);
            break;
          case "hide_session":
            handleHideSession(msg, ctx);
            break;
          case "unhide_session":
            handleUnhideSession(msg, ctx);
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
          case "fetch_content":
            handleFetchContent(msg, ctx);
            break;
          case "list_sessions":
            handleListSessions(msg, ctx);
            break;
          case "resume_session":
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
          case "openspec_refresh":
            handleOpenSpecRefresh(msg, ctx);
            break;
          case "openspec_bulk_archive":
            handleOpenSpecBulkArchive(msg, ctx);
            break;
          case "inject_view_message": {
            // Append a new `/view` row and broadcast the full snapshot to
            // every subscriber of this session. The bridge never sees this
            // message — view rows live in a separate store, not pi's
            // events.jsonl. See change: render-file-previews.
            viewMessageStore.append(msg.sessionId, msg.target);
            const snapshot = viewMessageStore.get(msg.sessionId);
            for (const sub of getSubscribers(msg.sessionId)) {
              sendTo(sub, {
                type: "view_messages_update",
                sessionId: msg.sessionId,
                viewMessages: snapshot,
              });
            }
            break;
          }
          case "extension_ui_response": {
            // Clear pending UI request tracking
            const sessionMap = pendingUiRequests.get(msg.sessionId);
            if (sessionMap) {
              sessionMap.delete(msg.requestId);
              if (sessionMap.size === 0) pendingUiRequests.delete(msg.sessionId);
            }
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
            // Plugin-registered custom handler takes precedence over pi-gateway forward.
            const type = (msg as { type?: string } | undefined)?.type;
            if (type && customHandlers.has(type)) {
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

    ws.on("close", () => {
      console.error(`[browser-gw] browser client disconnected (remaining: ${subscriptions.size - 1})`);
      subscriptions.delete(ws);
      replayingSessions.delete(ws);
      // Drop this ws from every viewed-session entry so disconnected browsers
      // don't hold sessions in the viewed state. See change: session-card-unread-stripes.
      viewedSessionTracker.unviewAll(ws);
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

    broadcastEvent(sessionId: string, seq: number, event: any) {
      const subscribers = getSubscribers(sessionId);
      const msg: ServerToBrowserMessage = {
        type: "event",
        sessionId,
        seq,
        event,
      };
      for (const ws of subscribers) {
        // Skip WebSockets that are mid-replay for this session
        const replaying = replayingSessions.get(ws);
        if (replaying?.has(sessionId)) continue;
        sendTo(ws, msg);
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

    broadcastSessionStateReset(sessionId: string) {
      const subscribers = getSubscribers(sessionId);
      const msg: ServerToBrowserMessage = { type: "session_state_reset", sessionId };
      for (const ws of subscribers) {
        sendTo(ws, msg);
      }
    },

    sendToSubscribers(sessionId: string, msg: ServerToBrowserMessage) {
      const subscribers = getSubscribers(sessionId);
      for (const ws of subscribers) {
        sendTo(ws, msg);
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

    trackUiRequest,

    clearUiRequest(sessionId: string, requestId: string) {
      const sessionMap = pendingUiRequests.get(sessionId);
      if (sessionMap) {
        sessionMap.delete(requestId);
        if (sessionMap.size === 0) {
          pendingUiRequests.delete(sessionId);
        }
      }
    },

    trackPromptRequest,
    clearPromptRequest,

    shutdownHeadlessProcesses() {
      headlessPidRegistry.killAll();
    },

    headlessPidRegistry,

    pendingResumeRegistry,

    viewedSessionTracker,
  };

  return gateway;
}
