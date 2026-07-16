/**
 * Hook that handles ServerToBrowserMessage dispatch.
 * Extracted from App.tsx — maps each message type to the correct state setter.
 */

import type {
  PreflightReason,
  ServerToBrowserMessage,
  SpawnFailureCode,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DisplayPrefs } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import type { CommandInfo, DashboardSession, FileEntry, ModelInfo, OpenSpecData, OpenSpecGroup, RoleInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useCallback, useEffect, useRef } from "react";
import type { DiscoveredServerInfo } from "../components/ServerSelector.js";
import { EMPTY_CANVAS_STATE, reduceCanvasChip, reduceCanvasIntent } from "../lib/canvas-gate.js";
import { foldLiveEvents, type QueuedLiveEvent } from "../lib/coalesce-live-events.js";
import { isVisibleCwd } from "../lib/cwd-visibility.js";
import { addInteractiveRequest, applyPromptReceived, createInitialState, dismissInteractiveRequest, reduceEvent, type SessionState } from "../lib/event-reducer.js";
import { encodeFolderPath } from "../lib/folder-encoding.js";
import { t } from "../lib/i18n";
import { clearLoadingHistory, HYDRATE_CEILING_MS, rearmLoadingHistory } from "../lib/loading-history.js";
import { clearRecoveryOffer, setRecoveryOffer } from "../lib/recovery-offer-bus.js";
import type { ReplayPersister } from "../lib/replay-persist.js";
import { inferPlatform, pathKey } from "../lib/session-grouping.js";
import { pushSpawnErrorToast } from "../lib/spawn-error-toast-bus.js";
import { dispatchInitEvent } from "../lib/worktree-init-bus.js";

/**
 * Rich spawn error detail stored per cwd.
 * `kind: "error"` is a normal spawn failure; `kind: "timeout"` is a
 * spawn_register_timeout (pi started but never connected).
 * See change: spawn-failure-diagnostics.
 */
export interface SpawnErrorDetail {
  kind: "error" | "timeout";
  message: string;
  code?: SpawnFailureCode;
  reasons?: PreflightReason[];
  stderr?: string;
  strategy?: string;
  pid?: number;
  /** Effective watchdog timeout in ms, for rendering "30s" in the timeout banner. */
  timeoutMs?: number;
}

import {
  clearSessionEvents,
  intentStore,
  publishSessionData,
  publishSessionEvent,
  publishSessionEvents,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { applyPluginConfigUpdate, getPluginConfig } from "@blackbelt-technology/dashboard-plugin-runtime/context";

export interface MessageHandlerSetters {
  setSessions: React.Dispatch<React.SetStateAction<Map<string, DashboardSession>>>;
  setSessionStates: React.Dispatch<React.SetStateAction<Map<string, SessionState>>>;
  setSessionCommands: React.Dispatch<React.SetStateAction<Map<string, CommandInfo[]>>>;
  // Note: setSessionFlows removed. flows-plugin reads `flowsList` from
  // the per-session-data store directly. See change:
  // pluginize-flows-via-registry.
  setFileResults: React.Dispatch<React.SetStateAction<{ query: string; files: FileEntry[] } | null>>;
  /** Per-session set of rel-paths that changed on disk (editor-pane banner). See change: split-editor-workspace. */
  setChangedOnDisk: React.Dispatch<React.SetStateAction<Map<string, Set<string>>>>;
  setOpenspecMap: React.Dispatch<React.SetStateAction<Map<string, OpenSpecData>>>;
  /**
   * Folder-HEAD branch map (`cwd → branch | null`), fed by `git_head_update`.
   * `null` = folder confirmed non-git. Outranks child-session branches in
   * `GroupGitInfo`. See change: refresh-folder-header-branch.
   */
  setFolderGitMap: React.Dispatch<React.SetStateAction<Map<string, string | null>>>;
  setOpenspecGroupsMap: React.Dispatch<React.SetStateAction<Map<string, { groups: OpenSpecGroup[]; assignments: Record<string, string>; changeOrder?: Record<string, string[]> }>>>;
  setModelsMap: React.Dispatch<React.SetStateAction<Map<string, ModelInfo[]>>>;
  setRolesMap: React.Dispatch<React.SetStateAction<Map<string, RoleInfo>>>;
  setSpawnResult: React.Dispatch<React.SetStateAction<{ success: boolean; message: string } | null>>;
  setSessionOrderMap: React.Dispatch<React.SetStateAction<Map<string, string[]>>>;
  setPinnedDirectories: React.Dispatch<React.SetStateAction<string[]>>;
  /** Flipped true on the first `pinned_dirs_updated` (sent on connect). Gates
   *  the DirectoryHomeView cold-load guard. See change: add-directory-home-page. */
  setPinnedDirsLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  /** Favorite model labels, synced via `favorite_models_updated`. See change: enrich-model-selector-capabilities-favorites. */
  setFavoriteModels: React.Dispatch<React.SetStateAction<string[]>>;
  /** folder-workspaces: full workspace list, kept in sync via `workspaces_updated`. */
  setWorkspaces: React.Dispatch<React.SetStateAction<import("@blackbelt-technology/pi-dashboard-shared/browser-protocol.js").Workspace[]>>;
  setTerminals: React.Dispatch<React.SetStateAction<Map<string, TerminalSession>>>;
  setDiscoveredServers: React.Dispatch<React.SetStateAction<DiscoveredServerInfo[]>>;
  setSpawnErrors: React.Dispatch<React.SetStateAction<Map<string, SpawnErrorDetail>>>;
  setResumeErrors: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  /** Global chat-display prefs (configurable-chat-display). */
  setDisplayPrefs: React.Dispatch<React.SetStateAction<DisplayPrefs | undefined>>;
  /**
   * Per-session dashboard-local `/view` preview rows. Stored separately from
   * the event-reducer state so the reducer never sees them. Merged into the
   * rendered chat by timestamp at the App level.
   * See change: render-file-previews.
   */
  setViewMessagesMap: React.Dispatch<React.SetStateAction<Map<string, import("../lib/event-reducer.js").ChatMessage[]>>>;
  /**
   * Per-session "history loading" flag. Cleared on the first content batch,
   * the terminal `event_replay{isLast:true}`, or `session_updated{dataUnavailable:true}`.
   * See change: show-chat-history-loading-indicator.
   */
  setLoadingHistory: React.Dispatch<React.SetStateAction<Map<string, boolean>>>;
  /**
   * Per-session auto-canvas state, folded from `canvas_intent` /
   * `canvas_server_chip` broadcasts. Coexists with the URL-driven preview
   * routes. See change: auto-canvas (Section 6).
   */
  setCanvasMap: React.Dispatch<React.SetStateAction<Map<string, import("../lib/canvas-gate.js").CanvasState>>>;
}

export interface MessageHandlerDeps {
  send: (msg: any) => void;
  navigate: (to: string) => void;
  clearSpawningCwd: (cwd: string) => void;
  spawningCwdsRef: React.MutableRefObject<Set<string>>;
  subscribedRef: React.MutableRefObject<Set<string>>;
  pendingTerminalCwdRef: React.MutableRefObject<string | null>;
  lastCreatedTerminalIdRef: React.MutableRefObject<string | null>;
  maxSeqMapRef: React.MutableRefObject<Map<string, number>>;
  selectedSessionIdRef: React.MutableRefObject<string | undefined>;
  /**
   * Maps client-minted requestId → originating click metadata. Consumed in
   * `case "session_added"` (when `msg.spawnRequestId` matches an entry,
   * navigate to the new session) and in `case "spawn_result"` failure (when
   * `msg.requestId` matches, drop the entry). See change: spawn-correlation-token.
   */
  pendingSpawnsRef: React.MutableRefObject<Map<string, { cwd: string; kind: "spawn" | "resume"; placeholderCwd?: string }>>;
  /**
   * Safety-net timers for the per-session loading flag, owned by App.
   * `clearLoadingHistory` tears the matching timer down on every exit edge.
   * See change: show-chat-history-loading-indicator.
   */
  loadingHistoryTimersRef: React.MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>;
  /**
   * Live snapshot of pinned dirs + workspaces + sessions for the
   * `isVisibleCwd` check that gates the off-screen spawn_error toast.
   * Optional for back-compat. See change: harden-worktree-spawn.
   */
  cwdVisibilityInputsRef?: React.MutableRefObject<{
    pinnedDirectories: ReadonlyArray<string>;
    workspaces: ReadonlyArray<{ folders: ReadonlyArray<string> }>;
    sessions: ReadonlyArray<{ cwd: string }>;
  }>;
  /**
   * Strategy A durable replay-cache writer. Accumulates raw events from
   * `event` / `event_replay` and persists (debounced) so a reload can
   * delta-subscribe. `session_state_reset` drops the entry.
   * See change: reduce-session-replay-traffic.
   */
  replayPersister?: ReplayPersister;
  /**
   * Show a global toast. Used for `auto_name_error` (bridge could not
   * auto-name a session). Optional for back-compat / lean test contexts.
   * See change: add-auto-session-naming.
   */
  showToast?: (text: string, variant?: "error" | "success" | "info") => void;
}

export function useMessageHandler(
  setters: MessageHandlerSetters,
  deps: MessageHandlerDeps,
): (msg: ServerToBrowserMessage) => void {
  const {
    setSessions, setSessionStates, setSessionCommands,
    setFileResults, setChangedOnDisk, setOpenspecMap, setFolderGitMap, setOpenspecGroupsMap, setModelsMap, setRolesMap, setSpawnResult,
    setSessionOrderMap, setPinnedDirectories, setPinnedDirsLoaded, setFavoriteModels, setWorkspaces, setTerminals,
    setDiscoveredServers, setSpawnErrors, setResumeErrors,
    setDisplayPrefs, setViewMessagesMap, setLoadingHistory, setCanvasMap,
  } = setters;
  const { send, navigate, clearSpawningCwd, spawningCwdsRef, subscribedRef, pendingTerminalCwdRef, lastCreatedTerminalIdRef, maxSeqMapRef, selectedSessionIdRef, pendingSpawnsRef, loadingHistoryTimersRef, replayPersister, showToast } = deps;
  // One-shot per session: suppress a repeat auto-name toast for the same
  // session id. See change: add-auto-session-naming.
  const autoNameToastedRef = useRef<Set<string>>(new Set());

  // Phase 3 (change: reduce-chat-render-cpu-umbrella): live `event` bursts
  // arrive one-per-WS-frame in separate macrotasks, so React 18 automatic
  // batching does NOT merge their setSessionStates calls — N events cost N
  // ChatView renders. We queue the (cheap) per-event side effects aside and
  // coalesce the (expensive) state application into one fold per animation
  // frame. Per-event side effects (seq tracking, durable replay buffer, plugin
  // mirror) stay synchronous in `case "event"`, so their timing is unchanged.
  const liveQueueRef = useRef<Map<string, QueuedLiveEvent[]>>(new Map());
  const flushRafRef = useRef<number | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushLiveEvents = useCallback(() => {
    if (flushRafRef.current != null) {
      cancelAnimationFrame(flushRafRef.current);
      flushRafRef.current = null;
    }
    if (flushTimerRef.current != null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const queues = liveQueueRef.current;
    if (queues.size === 0) return;
    // Snapshot + clear so events arriving during the flush go to the next frame.
    const drained = new Map(queues);
    queues.clear();
    setSessionStates((prev) => {
      let next: Map<string, SessionState> | null = null;
      for (const [sessionId, events] of drained) {
        if (events.length === 0) continue;
        const base = next ?? prev;
        const current = base.get(sessionId) ?? createInitialState();
        const { state } = foldLiveEvents(current, events);
        if (!next) next = new Map(prev);
        next.set(sessionId, state);
      }
      return next ?? prev;
    });
  }, [setSessionStates]);

  const scheduleLiveFlush = useCallback(() => {
    if (flushRafRef.current != null || flushTimerRef.current != null) return;
    // rAF is throttled/suspended on a backgrounded tab — fall back to a
    // macrotask so events still apply and none is delayed indefinitely.
    if (typeof document !== "undefined" && document.hidden) {
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        flushLiveEvents();
      }, 0);
    } else if (typeof requestAnimationFrame === "function") {
      flushRafRef.current = requestAnimationFrame(() => {
        flushRafRef.current = null;
        flushLiveEvents();
      });
    } else {
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        flushLiveEvents();
      }, 0);
    }
  }, [flushLiveEvents]);

  useEffect(
    () => () => {
      if (flushRafRef.current != null) cancelAnimationFrame(flushRafRef.current);
      if (flushTimerRef.current != null) clearTimeout(flushTimerRef.current);
    },
    [],
  );

  return useCallback((msg: ServerToBrowserMessage) => {
    // Preserve strict ordering: any queued live events must apply before a
    // non-`event` message can mutate the same session's state (reset, replay,
    // interactive request, removal). Draining here keeps coalescing on the hot
    // path (consecutive `event` bursts) while guaranteeing correctness.
    if (msg.type !== "event" && liveQueueRef.current.size > 0) flushLiveEvents();
    switch (msg.type) {
      case "session_added":
        setSessions((prev) => {
          const next = new Map(prev);
          next.set(msg.session.id, msg.session);
          if (msg.session.status !== "ended") {
            for (const [id, s] of next) {
              if (id !== msg.session.id && s.cwd === msg.session.cwd && s.resuming) {
                next.set(id, { ...s, resuming: false });
              }
            }
          }
          return next;
        });
        // A hidden session is an auto-hidden headless worker (subagent,
        // `memory` tool, nested `pi -p`) that shares its parent's cwd. It must
        // never steal focus OR consume the correlation token minted for the
        // real visible spawn, so the whole cascade is gated.
        // See change: suppress-hidden-session-auto-navigation.
        if (!msg.session.hidden) {
          // Tier 1: exact correlation by spawnRequestId. Works for both
          // spawn-from-folder and fork-from-card (closes the no-auto-select-
          // after-fork UX gap). See change: spawn-correlation-token.
          if (msg.spawnRequestId && pendingSpawnsRef.current.has(msg.spawnRequestId)) {
            const entry = pendingSpawnsRef.current.get(msg.spawnRequestId)!;
            pendingSpawnsRef.current.delete(msg.spawnRequestId);
            // Clear the placeholder keyed on the group cwd. For a worktree
            // spawn `placeholderCwd` is the PARENT repo path (where the
            // session groups), NOT `entry.cwd` (the worktree path).
            // See change: add-worktree-spawn-placeholder-card.
            if (entry.kind === "spawn" && entry.cwd) clearSpawningCwd(entry.placeholderCwd ?? entry.cwd);
            navigate(`/session/${msg.session.id}`);
          } else if (spawningCwdsRef.current.has(msg.session.cwd)) {
            // Tier 2 (legacy fallback): cwd-based heuristic for older servers
            // that don't echo spawnRequestId. Only fires for spawn (not fork)
            // because fork dispatches don't add to spawningCwds today.
            clearSpawningCwd(msg.session.cwd);
            navigate(`/session/${msg.session.id}`);
          } else {
            // Tier 2.5 (worktree-aware fallback): no spawnRequestId matched and
            // the session's own cwd is not in spawningCwds — true for worktree
            // spawns, whose placeholder is keyed by the PARENT cwd, so Tier 2
            // can never match. Scan pending spawns for a `kind: "spawn"` entry
            // whose tracked cwd equals this session's cwd and clear its
            // `placeholderCwd`. First-match-wins. See change:
            // fix-worktree-spawn-placeholder-and-ordering.
            const platform = inferPlatform([msg.session.cwd]);
            const sessionKey = pathKey(msg.session.cwd, platform);
            for (const [requestId, entry] of pendingSpawnsRef.current) {
              if (entry.kind === "spawn" && entry.cwd && pathKey(entry.cwd, platform) === sessionKey) {
                pendingSpawnsRef.current.delete(requestId);
                clearSpawningCwd(entry.placeholderCwd ?? entry.cwd);
                navigate(`/session/${msg.session.id}`);
                break;
              }
            }
          }
        }
        // Commands/models/roles metadata is now requested server-side on subscribe
        // (see subscription-handler.ts) so it arrives while the browser is subscribed.
        break;

      case "session_updated":
        setSessions((prev) => {
          const next = new Map(prev);
          const existing = next.get(msg.sessionId);
          if (existing) {
            next.set(msg.sessionId, { ...existing, ...msg.updates });
          }
          return next;
        });
        // Exit LOADING on load failure: the cold branch's `.catch` /
        // unsuccessful result marks the session `dataUnavailable`.
        // See change: show-chat-history-loading-indicator.
        if ((msg.updates as Partial<DashboardSession>).dataUnavailable === true) {
          clearLoadingHistory(setLoadingHistory, loadingHistoryTimersRef, msg.sessionId);
        }
        // Mirror model/thinkingLevel into sessionStates so the bottom StatusBar
        // (which reads selectedState.thinkingLevel ?? selectedSession.thinkingLevel)
        // stays in sync with the session card. model_update events from the bridge
        // go through session_updated — there's no dedicated browser-side
        // model_update handler, so we propagate here.
        // See change: enrich-custom-provider-model-metadata.
        {
          const updates = msg.updates as Partial<DashboardSession>;
          if (updates.thinkingLevel !== undefined || updates.model !== undefined) {
            setSessionStates((prev) => {
              const next = new Map(prev);
              const existing = next.get(msg.sessionId) ?? createInitialState();
              const patched: SessionState = { ...existing };
              if (updates.thinkingLevel !== undefined) patched.thinkingLevel = updates.thinkingLevel;
              if (updates.model !== undefined) patched.model = updates.model;
              next.set(msg.sessionId, patched);
              return next;
            });
          }
        }
        break;

      case "session_removed":
        setSessions((prev) => {
          const next = new Map(prev);
          const existing = next.get(msg.sessionId);
          if (existing) {
            next.set(msg.sessionId, { ...existing, status: "ended" });
          }
          return next;
        });
        break;

      case "session_state_reset":
        setSessionStates((prev) => {
          const next = new Map(prev);
          // Carry `pendingPrompt` across reset: it's optimistic UI state
          // representing user intent that hasn't round-tripped yet. Reducer
          // user `message_start` / `agent_start`, the 30s safety timeout, or
          // explicit cancel are the right paths to clear it. Auto-resume's
          // bridge re-register triggers this reset, and dropping the bubble
          // makes the user feel their message vanished.
          // See change: preserve-pending-prompt-across-replay.
          const carry = next.get(msg.sessionId)?.pendingPrompt;
          const fresh = createInitialState();
          if (carry) fresh.pendingPrompt = carry;
          next.set(msg.sessionId, fresh);
          return next;
        });
        maxSeqMapRef.current.set(msg.sessionId, 0);
        // Strategy A invalidation: purge the durable cache so stale history is
        // never stitched onto reset sequence numbers; full replay rebuilds it.
        // See change: reduce-session-replay-traffic.
        void replayPersister?.drop(msg.sessionId);
        // Mirror the reset into the plugin-runtime per-session event
        // store so plugin reducers (e.g. flows-plugin) re-derive from
        // a clean stream after a replay. See change:
        // pluginize-flows-via-registry.
        clearSessionEvents(msg.sessionId);
        break;

      case "event": {
        // Per-event side effects stay synchronous — timing identical to the
        // old per-event path (verified against the replay-cache test):
        if (msg.seq > (maxSeqMapRef.current.get(msg.sessionId) ?? 0)) {
          maxSeqMapRef.current.set(msg.sessionId, msg.seq);
        }
        // Strategy A: accumulate the live event into the durable replay buffer.
        replayPersister?.record(msg.sessionId, [{ seq: msg.seq, event: msg.event }]);
        // Publish to the plugin-runtime per-session event store so
        // plugin slot consumers calling `useSessionEvents(sessionId)`
        // re-render with the extended event list. The shell's reducer
        // and the plugin store consume the same `msg.event`. See
        // change: pluginize-flows-via-registry.
        publishSessionEvent(msg.sessionId, msg.event);
        // Coalesce the expensive part — the ChatView re-render via
        // setSessionStates — into one fold per frame. See change:
        // reduce-chat-render-cpu-umbrella (Phase 3).
        const queued = liveQueueRef.current.get(msg.sessionId);
        if (queued) queued.push({ seq: msg.seq, event: msg.event });
        else liveQueueRef.current.set(msg.sessionId, [{ seq: msg.seq, event: msg.event }]);
        scheduleLiveFlush();
        break;
      }

      // Bridge ack for an idle-scoped optimistic send. fresh:true promotes the
      // pendingPrompt bubble to "sent"; fresh:false drops it (the send raced
      // into a mid-turn queue entry). See change: optimistic-prompt-progress.
      case "prompt_received":
        setSessionStates((prev) => {
          const current = prev.get(msg.sessionId);
          if (!current?.pendingPrompt) return prev;
          const next = new Map(prev);
          next.set(msg.sessionId, applyPromptReceived(current, msg.fresh));
          return next;
        });
        break;

      // chat-markdown-local-images-and-math: bridge-emitted local-image asset.
      // Stored on `DashboardSession.assets` so `MarkdownContent`'s
      // `pi-asset:` resolver (via `SessionAssetsContext`) can render
      // `data:` URLs without re-fetching. Idempotent on duplicate hashes.
      case "asset_register":
        setSessions((prev) => {
          const next = new Map(prev);
          const existing = next.get(msg.sessionId);
          if (!existing) return prev;
          const assets = { ...(existing.assets ?? {}) };
          assets[msg.hash] = { data: msg.data, mimeType: msg.mimeType };
          next.set(msg.sessionId, { ...existing, assets });
          return next;
        });
        break;

      // Plugin-emitted intent broadcast — update the IntentStore so slot
      // consumers re-render via useSlotIntents. Server caches the latest
      // intent per (pluginId, sessionId, slot) for replay on subscribe.
      // See change: adopt-server-driven-intent-rendering.
      case "plugin_intents":
        intentStore.set(
          {
            pluginId: msg.pluginId,
            sessionId: msg.sessionId,
            slot: msg.slot,
          },
          msg.intent,
        );
        break;

      // Generic plugin-emitted dashboard event. Routed into the plugin
      // per-session event store so `useSessionEvents(sessionId)` consumers
      // (e.g. goal-plugin GoalChip) re-derive. See change:
      // add-goal-continuation-plugin.
      case "plugin_event":
        publishSessionEvent(msg.sessionId, msg.event);
        break;

      case "commands_list":
        setSessionCommands((prev) => {
          const next = new Map(prev);
          next.set(msg.sessionId, msg.commands);
          return next;
        });
        // Mirror into the plugin-runtime per-session-data store so
        // plugins (e.g. flows-plugin's SessionFlowActions claim) can
        // read the commands list without coupling to shell state.
        // See change: pluginize-flows-via-registry.
        publishSessionData(msg.sessionId, "commandsList", msg.commands);
        break;

      case "flows_list":
        // Mirrored to the plugin-runtime per-session-data store so
        // flows-plugin's SessionFlowActionsClaim and FlowsCommandRoutes
        // can read the flows list. The shell does not retain it.
        publishSessionData(msg.sessionId, "flowsList", msg.flows);
        break;

      case "files_list":
        setFileResults({ query: msg.query, files: msg.files });
        break;

      case "file_changed":
        // An open editor-pane file changed on disk. Record it per-session; the
        // pane surfaces a per-tab banner (no auto-reload).
        // See change: split-editor-workspace.
        if (typeof msg.path !== "string" || typeof msg.sessionId !== "string") break;
        setChangedOnDisk((prev) => {
          const next = new Map(prev);
          const set = new Set(next.get(msg.sessionId) ?? []);
          set.add(msg.path);
          next.set(msg.sessionId, set);
          return next;
        });
        break;

      case "canvas_intent": {
        // Auto-canvas driver: fold the two-phase intent (eager/settle) into the
        // session's canvas slot. The CanvasDriver component reacts to the
        // resulting state (viewport-gated open / chip). See change: auto-canvas.
        if (typeof msg.sessionId !== "string") break;
        setCanvasMap((prev) => {
          const next = new Map(prev);
          next.set(msg.sessionId, reduceCanvasIntent(prev.get(msg.sessionId) ?? EMPTY_CANVAS_STATE, msg));
          return next;
        });
        break;
      }

      case "canvas_server_chip": {
        // Declared-server confirm chip (Decision 4). A normal broadcast surfaces
        // the chip (no probe here — the probe happens on tap through
        // LiveServerViewer); an `expire:true` broadcast drops it at the turn
        // boundary / server-exit so it becomes non-actionable (S32). Both cases
        // fold through `reduceCanvasChip`.
        if (typeof msg.sessionId !== "string") break;
        setCanvasMap((prev) => {
          const next = new Map(prev);
          next.set(msg.sessionId, reduceCanvasChip(prev.get(msg.sessionId) ?? EMPTY_CANVAS_STATE, msg));
          return next;
        });
        break;
      }

      case "models_list": {
        // Models are GLOBAL in pi-coding-agent (single ModelRegistry per pi
        // process). The bridge emits this on session_start using the same
        // shared registry; the WS `sessionId` is just the initiator. Mirror
        // the global semantics by routing through the built-ins plugin
        // config (merged with any existing roles already there).
        //
        // See change: fix-pi-flows-end-to-end (Group 5 — global roles+models).
        setModelsMap((prev) => {
          const next = new Map(prev);
          next.set(msg.sessionId, msg.models);
          return next;
        });
        const prevCfg = getPluginConfig("roles") as Record<string, unknown>;
        applyPluginConfigUpdate({
          type: "plugin_config_update",
          id: "roles",
          config: { ...prevCfg, models: msg.models },
        });
        break;
      }

      case "roles_list": {
        // Roles are GLOBAL in pi-flows (single `~/.pi/agent/providers.json`).
        // The `sessionId` on this WS message only identifies the session that
        // *initiated* the change — the data itself has no session dimension.
        // We mirror the global storage by routing the payload through the
        // built-ins plugin's config (`usePluginConfig<BuiltinsConfig>` in
        // BuiltInRolesSettings reads it). This piggybacks on the existing
        // plugin-config plumbing used by every other plugin’s settings UI.
        //
        // See change: fix-pi-flows-end-to-end (Group 5 — global roles+models).
        const roleInfo = {
          roles: msg.roles,
          presets: msg.presets,
          activePreset: msg.activePreset,
          // Carry the built-in role-name set into the roles plugin config so
          // BuiltInRolesSettings renders the Built-in/Custom split and the
          // "＋ Add custom role" control. Dropping it here (the original defect)
          // forced the flat back-compat layout.
          // See change: fix-builtin-role-names-relay.
          builtinRoleNames: msg.builtinRoleNames,
        };
        setRolesMap((prev) => {
          const next = new Map(prev);
          next.set(msg.sessionId, roleInfo);
          return next;
        });
        const prevCfg = getPluginConfig("roles") as Record<string, unknown>;
        applyPluginConfigUpdate({
          type: "plugin_config_update",
          id: "roles",
          config: { ...prevCfg, ...roleInfo },
        });
        break;
      }

      case "process_list_update":
        setSessions((prev) => {
          const next = new Map(prev);
          const existing = next.get(msg.sessionId);
          if (existing) {
            next.set(msg.sessionId, { ...existing, processes: msg.processes });
          }
          return next;
        });
        break;

      case "openspec_update":
        setOpenspecMap((prev) => {
          const next = new Map(prev);
          next.set(msg.cwd, msg.data);
          return next;
        });
        break;

      case "git_head_update":
        // Folder's own HEAD (or `null` for non-git). Authoritative for the
        // GROUP header, outranks any child-session branch. See change:
        // refresh-folder-header-branch.
        setFolderGitMap((prev) => {
          const next = new Map(prev);
          next.set(msg.cwd, msg.branch);
          return next;
        });
        break;

      case "openspec_groups_update":
        setOpenspecGroupsMap((prev) => {
          const next = new Map(prev);
          next.set(msg.cwd, { groups: msg.groups, assignments: msg.assignments, changeOrder: msg.changeOrder });
          return next;
        });
        break;

      case "event_replay": {
        const firstSeq = msg.events.length > 0 ? msg.events[0].seq : null;
        // Reset on every full replay sweep: firstSeq===1 (cold start) OR
        // firstSeq <= maxSeq for this session (server is re-replaying events
        // the client has already accounted for, e.g. paginated reconnect
        // re-replay where the first batch may not start at seq=1).
        // See change: fix-replay-duplicates-tool-and-flushed-rows.
        const maxSeq = maxSeqMapRef.current.get(msg.sessionId) ?? 0;
        const shouldReset = firstSeq != null && (firstSeq === 1 || firstSeq <= maxSeq);
        setSessionStates((prev) => {
          const next = new Map(prev);
          // Same rationale as session_state_reset: preserve optimistic
          // pendingPrompt across the full-replay reset branch.
          // See change: preserve-pending-prompt-across-replay.
          const carry = shouldReset ? next.get(msg.sessionId)?.pendingPrompt : undefined;
          let current = shouldReset ? createInitialState() : (next.get(msg.sessionId) ?? createInitialState());
          if (carry) current.pendingPrompt = carry;
          for (const { event } of msg.events) {
            current = reduceEvent(current, event);
          }
          next.set(msg.sessionId, current);
          return next;
        });
        // Mirror the replayed batch into the plugin-runtime per-session event
        // store so plugin slot consumers (flows card, goal chip) reading
        // `useSessionEvents` rehydrate on cold load — the live `event` path
        // publishes per event, so the replay path must too. Reuse `shouldReset`
        // (full-sweep) to clear before republishing so a re-replay does not
        // duplicate; continuation batches append.
        // See change: replay-persisted-flow-runs.
        if (shouldReset) clearSessionEvents(msg.sessionId);
        publishSessionEvents(msg.sessionId, msg.events.map((e) => e.event));
        // If we reset, also reset maxSeq tracking so a subsequent batch isn't
        // misclassified. We rebuild it below from this batch's events.
        if (shouldReset) {
          maxSeqMapRef.current.set(msg.sessionId, 0);
        }
        // Track highest seq from replay batch
        if (msg.events.length > 0) {
          const lastEvt = msg.events[msg.events.length - 1];
          if (lastEvt.seq > (maxSeqMapRef.current.get(msg.sessionId) ?? 0)) {
            maxSeqMapRef.current.set(msg.sessionId, lastEvt.seq);
          }
        }
        // Strategy A: mirror the reducer into the durable replay buffer. A
        // full-sweep reset (shouldReset) replaces the buffer; a delta appends.
        // This is also the reconciliation path: an offline-drift replay whose
        // firstSeq <= maxSeq resets and rebuilds the persisted tail too.
        // See change: reduce-session-replay-traffic.
        if (msg.events.length > 0) {
          if (shouldReset) replayPersister?.seed(msg.sessionId, msg.events);
          else replayPersister?.record(msg.sessionId, msg.events);
        }
        // Exit LOADING: first content (clear immediately so partial history
        // paints) OR terminal marker for a genuinely-empty session
        // (`events:[], isLast:true` → falls through to "No messages yet").
        // Else — the empty non-terminal marker (`events:[], isLast:false`) is the
        // cold-hydration start marker AND every server heartbeat: re-arm the
        // short subscribe window to the longer hydration ceiling so a slow disk
        // parse never flashes "No messages yet". `rearmLoadingHistory` no-ops
        // unless a timer is armed (flag set), so warm/painted sessions are
        // unaffected. See change: show-chat-history-loading-indicator,
        // fix-history-loading-false-empty-flash.
        if (msg.events.length > 0 || msg.isLast === true) {
          clearLoadingHistory(setLoadingHistory, loadingHistoryTimersRef, msg.sessionId);
        } else {
          rearmLoadingHistory(setLoadingHistory, loadingHistoryTimersRef, msg.sessionId, HYDRATE_CEILING_MS);
        }
        break;
      }

      case "auto_name_error": {
        // Bridge could not auto-name a session (e.g. @fast unconfigured).
        // One-shot per session so a hard-config error toasts only once.
        // See change: add-auto-session-naming.
        if (!autoNameToastedRef.current.has(msg.sessionId)) {
          autoNameToastedRef.current.add(msg.sessionId);
          showToast?.(
            t("session.autoNameError", { reason: msg.reason }, `Couldn't auto-name session: ${msg.reason}`),
            "error",
          );
        }
        break;
      }

      case "recovery_offer":
        // Cold-start interrupted-session offer. Sticky top-right notification
        // (no auto-timeout). See change: reopen-sessions-after-shutdown.
        setRecoveryOffer(msg.candidates);
        break;

      case "resume_result":
        // Resuming any session retires the recovery offer (no nag).
        if (msg.success) clearRecoveryOffer();
        if (!msg.success) {
          console.warn("[dashboard] Resume/fork failed:", msg.message);
          setSessions((prev) => {
            const next = new Map(prev);
            const existing = next.get(msg.sessionId);
            if (existing) {
              next.set(msg.sessionId, { ...existing, resuming: false });
            }
            return next;
          });
          setResumeErrors((prev) => {
            const next = new Map(prev);
            next.set(msg.sessionId, msg.message ?? t("session.resumeFailed", undefined, "Resume failed"));
            return next;
          });
          // Drop the pending-spawn entry on failure so a stale entry can't
          // mis-route a later session_added. See change: spawn-correlation-token.
          if (msg.requestId) pendingSpawnsRef.current.delete(msg.requestId);
        } else {
          setResumeErrors((prev) => {
            const next = new Map(prev);
            next.delete(msg.sessionId);
            return next;
          });
          // FORK_DEGRADED_TO_NEW: source session had no persisted history,
          // so the server silently spawned a fresh session in the same cwd
          // instead of forking. Surface the substitution as a non-blocking
          // toast via the existing spawn-result slot.
          // See change: fix-fork-empty-session-silent-timeout.
          if (msg.code === "FORK_DEGRADED_TO_NEW") {
            setSpawnResult({ success: true, message: msg.message ?? t("session.startedFresh", undefined, "Started a fresh session.") });
          }
          // For continue mode, the same sessionId is reused — navigate now
          // since session_added might not fire (status update only).
          // For fork mode, leave the entry alive: session_added will arrive
          // for the new fork sessionId and trigger auto-navigate.
          // See change: spawn-correlation-token.
        }
        break;

      case "spawn_result":
        setSpawnResult({ success: msg.success, message: msg.message });
        if (!msg.success) {
          // Clear the placeholder on the group cwd. For a worktree spawn the
          // matching pending entry carries `placeholderCwd` (parent repo),
          // distinct from `msg.cwd` (the worktree path).
          // See change: add-worktree-spawn-placeholder-card.
          const failedEntry = msg.requestId ? pendingSpawnsRef.current.get(msg.requestId) : undefined;
          clearSpawningCwd(failedEntry?.placeholderCwd ?? msg.cwd);
          // Leave the spawn_error message to fill the rich detail; set a placeholder if not yet present.
          setSpawnErrors((prev) => {
            const next = new Map(prev);
            if (!next.has(msg.cwd)) {
              next.set(msg.cwd, { kind: "error", message: msg.message ?? t("session.spawnFailed", undefined, "+Session failed") });
            }
            return next;
          });
          // Drop the pending-spawn entry on failure (matched by requestId
          // when echoed; otherwise leave to be cleaned up by the 30s timeout).
          // See change: spawn-correlation-token.
          if (msg.requestId) pendingSpawnsRef.current.delete(msg.requestId);
        } else {
          // Successful spawn clears error AND timeout banners for this cwd.
          setSpawnErrors((prev) => {
            const next = new Map(prev);
            next.delete(msg.cwd);
            return next;
          });
        }
        break;

      case "spawn_error": {
        // Enriches the spawn_result error with strategy + optional stderr tail.
        // Carried as its own message so esbuild preserves this switch case in
        // production builds (per AGENTS.md ServerToBrowserMessage invariant).
        // See change: spawn-failure-diagnostics for new code/reasons/stderr fields.
        clearSpawningCwd(msg.cwd);
        setSpawnErrors((prev) => {
          const next = new Map(prev);
          next.set(msg.cwd, {
            kind: "error",
            message: msg.message,
            code: msg.code,
            reasons: msg.reasons,
            stderr: msg.stderr,
            strategy: msg.strategy,
          });
          return next;
        });
        // Off-screen fallback (change: harden-worktree-spawn): when the
        // cwd has no visible folder banner, push a global toast so the
        // failure isn't silently dropped. The per-folder banner takes
        // precedence when the cwd IS visible.
        const visibilityInputs = deps.cwdVisibilityInputsRef?.current;
        if (visibilityInputs && !isVisibleCwd(msg.cwd, visibilityInputs)) {
          pushSpawnErrorToast({
            cwd: msg.cwd,
            code: msg.code ?? "SPAWN_ERROR",
            message: msg.message,
            requestId: undefined,
          });
        }
        break;
      }

      case "spawn_register_timeout": {
        // Pi started but never called session_register within timeout window.
        // See change: spawn-failure-diagnostics.
        setSpawnErrors((prev) => {
          const next = new Map(prev);
          next.set(msg.cwd, {
            kind: "timeout",
            message: "",
            pid: msg.pid,
            stderr: msg.stderrTail,
            timeoutMs: msg.timeoutMs,
          });
          return next;
        });
        break;
      }

      case "spawn_register_recovered": {
        // Pi finally registered after the watchdog fired — auto-clear the timeout banner.
        // See change: spawn-failure-diagnostics.
        setSpawnErrors((prev) => {
          const next = new Map(prev);
          const existing = next.get(msg.cwd);
          if (existing?.kind === "timeout") next.delete(msg.cwd);
          return next;
        });
        break;
      }

      case "sessions_list":
        break;

      case "sessions_reordered":
        setSessionOrderMap((prev) => {
          const next = new Map(prev);
          next.set(msg.cwd, msg.sessionIds);
          return next;
        });
        break;

      case "sessions_snapshot":
        // Atomic REPLACE — not merge. Drops stale ids from previous server
        // lifetime so an actually-running session never lingers below the
        // “Show N ended” divider after a reconnect.
        // See change: fix-stale-sessions-on-reconnect.
        setSessions(new Map(msg.sessions.map((s) => [s.id, s])));
        setSessionOrderMap(new Map(Object.entries(msg.orders)));
        break;

      case "pinned_dirs_updated":
        setPinnedDirectories(msg.paths);
        setPinnedDirsLoaded(true);
        break;

      case "favorite_models_updated":
        setFavoriteModels(msg.labels);
        break;

      case "workspaces_updated":
        // folder-workspaces: server sends full snapshot on subscribe and
        // after every mutation. Replace, do not merge.
        setWorkspaces(msg.workspaces);
        break;

      case "extension_ui_request":
        setSessionStates((prev) => {
          const next = new Map(prev);
          const current = next.get(msg.sessionId) ?? createInitialState();
          const updated = addInteractiveRequest(current, msg.requestId, msg.method, msg.params);
          if (updated === current) return prev;
          next.set(msg.sessionId, updated);
          return next;
        });
        break;

      case "view_messages_update":
        // Full snapshot of `/view` preview rows for a session. Replace,
        // not append. Merged into the rendered chat at the App level.
        // See change: render-file-previews.
        setViewMessagesMap((prev) => {
          const next = new Map(prev);
          next.set(msg.sessionId, msg.viewMessages.slice());
          return next;
        });
        break;

      case "ui_dismiss":
        setSessionStates((prev) => {
          const next = new Map(prev);
          const current = next.get(msg.sessionId);
          if (!current) return prev;
          const updated = dismissInteractiveRequest(current, msg.requestId);
          if (updated === current) return prev;
          next.set(msg.sessionId, updated);
          return next;
        });
        break;

      // ── PromptBus protocol messages ──
      case "prompt_request":
        setSessionStates((prev) => {
          const next = new Map(prev);
          const current = next.get(msg.sessionId) ?? createInitialState();
          // Extract the originating toolCallId so the reducer can pair
          // the interactiveUi row with its parent toolResult row during
          // assistant message_end reorder. Free-floating prompts (no
          // tool context) leave the field undefined.
          // See change: fix-interactive-ui-reorder.
          const toolCallId =
            typeof msg.prompt?.metadata?.toolCallId === "string"
              ? (msg.prompt.metadata.toolCallId as string)
              : undefined;
          const updated = addInteractiveRequest(
            current,
            msg.promptId,
            msg.prompt?.type ?? "select",
            {
              title: msg.prompt?.question,
              message: msg.prompt?.metadata?.message as string | undefined,
              options: msg.prompt?.options,
              defaultValue: msg.prompt?.defaultValue,
              // For method "batch": sub-questions travel in metadata.questions.
              // See change: redesign-ask-user-question-cards.
              questions: msg.prompt?.metadata?.questions,
              _promptBusComponent: msg.component,
              _promptBusPlacement: msg.placement,
            },
            toolCallId,
          );
          if (updated === current) return prev;
          next.set(msg.sessionId, updated);
          return next;
        });
        break;

      case "prompt_dismiss":
        setSessionStates((prev) => {
          const next = new Map(prev);
          const current = next.get(msg.sessionId);
          if (!current) return prev;
          const updated = dismissInteractiveRequest(current, msg.promptId);
          if (updated === current) return prev;
          next.set(msg.sessionId, updated);
          return next;
        });
        break;

      case "prompt_cancel":
        setSessionStates((prev) => {
          const next = new Map(prev);
          const current = next.get(msg.sessionId);
          if (!current) return prev;
          const updated = dismissInteractiveRequest(current, msg.promptId);
          if (updated === current) return prev;
          next.set(msg.sessionId, updated);
          return next;
        });
        break;

      case "terminal_added":
        setTerminals((prev) => {
          const next = new Map(prev);
          next.set(msg.terminal.id, msg.terminal);
          return next;
        });
        if (pendingTerminalCwdRef.current === msg.terminal.cwd) {
          pendingTerminalCwdRef.current = null;
          lastCreatedTerminalIdRef.current = msg.terminal.id;
          navigate(`/folder/${encodeFolderPath(msg.terminal.cwd)}/terminals`);
        }
        break;

      case "terminal_removed":
        setTerminals((prev) => {
          const next = new Map(prev);
          next.delete(msg.terminalId);
          return next;
        });
        break;

      case "terminal_updated":
        setTerminals((prev) => {
          const next = new Map(prev);
          const existing = next.get(msg.terminalId);
          if (existing) {
            next.set(msg.terminalId, { ...existing, ...msg.updates });
          }
          return next;
        });
        break;

      case "package_progress":
      case "package_operation_complete":
        // Dispatch to component-level hooks via custom DOM event
        window.dispatchEvent(new CustomEvent("pi-package-event", { detail: msg }));
        break;

      case "pi_core_update_progress":
      case "pi_core_update_complete":
        // Dispatch to PiCore hooks via custom DOM event
        window.dispatchEvent(new CustomEvent("pi-core-event", { detail: msg }));
        break;

      case "display_prefs_updated":
        // Global chat-display prefs were updated (by THIS or another tab).
        // See change: configurable-chat-display.
        setDisplayPrefs(msg.prefs);
        break;

      case "plugin_config_update":
        // Update the plugin config store and re-render any usePluginConfig consumers.
        applyPluginConfigUpdate(msg);
        // Notify usePluginEnabledSet (and any other listener) so they can
        // refetch /api/health and propagate the new enabled set into the
        // slot registry. See change: add-plugin-activation-ui.
        window.dispatchEvent(new CustomEvent("plugin-config-update", { detail: msg }));
        break;

      // bootstrap_status_update + bootstrap_ticket_complete WS messages
      // removed under change: eliminate-electron-runtime-install (task 3.1).
      // pi-core update progress still flows via the surviving pi_core_event
      // dispatch below.

      // Forward worktree-init streaming events to the process-singleton bus
      // so the requestId-scoped WorktreeInitButton tail updates live.
      // See change: generalize-worktree-init-hook.
      case "worktree_init_progress":
      case "worktree_init_done":
      case "worktree_init_failed":
        dispatchInitEvent(msg);
        break;

      case "servers_discovered":
      case "servers_updated":
        setDiscoveredServers(msg.servers as DiscoveredServerInfo[]);
        break;

      // `models_refreshed` was a global signal that wiped modelsMap and
      // re-requested only for the selected session, leaving previously-
      // visited sessions in `subscribedRef` with empty model lists. The
      // signal is gone (see change: simplify-model-selection-channels):
      // each bridge pushes its own `models_list` per-session on credential
      // changes, so modelsMap is updated incrementally without a wipe.
      // The case is preserved as a no-op for protocol-compatibility with
      // older bridges that may still emit it; deleting the case would
      // throw on receipt under strict-union message handlers.
      case "models_refreshed":
        break;

      // ── Extension UI System (Phase 1) ──
      // Cache the module list directly on the DashboardSession record so the
      // existing `sessions.get(id)?.uiModules` access pattern works. See
      // change: add-extension-ui-modal.
      case "ui_modules_list":
        setSessions((prev) => {
          const next = new Map(prev);
          const existing = next.get(msg.sessionId);
          if (existing) {
            next.set(msg.sessionId, { ...existing, uiModules: msg.modules });
          }
          return next;
        });
        break;

      case "ui_data_list":
        setSessions((prev) => {
          const next = new Map(prev);
          const existing = next.get(msg.sessionId);
          if (existing) {
            const dataMap = { ...(existing.uiDataMap ?? {}), [msg.event]: msg.items };
            next.set(msg.sessionId, { ...existing, uiDataMap: dataMap });
          }
          return next;
        });
        break;

      // ── Extension UI System (Phase 2): live decorator updates ──
      // Cache descriptors on the DashboardSession record under composite key
      // `${kind}:${namespace}:${id}`. `removed: true` deletes the entry without
      // affecting siblings. See change: add-extension-ui-decorations.
      case "ext_ui_decorator": {
        const descriptor = msg.descriptor;
        if (!descriptor || typeof descriptor.kind !== "string") break;
        const key = `${descriptor.kind}:${descriptor.namespace}:${descriptor.id}`;
        setSessions((prev) => {
          const next = new Map(prev);
          const existing = next.get(msg.sessionId);
          if (!existing) return prev;
          const decorators = { ...(existing.uiDecorators ?? {}) };
          if (msg.removed === true) delete decorators[key];
          else decorators[key] = descriptor;
          next.set(msg.sessionId, { ...existing, uiDecorators: decorators });
          return next;
        });
        break;
      }
    }
  }, [send, clearSpawningCwd, navigate, setSessions, setSessionStates, setSessionCommands, setFileResults, setChangedOnDisk, setOpenspecMap, setModelsMap, setRolesMap, setSpawnResult, setSessionOrderMap, setPinnedDirectories, setPinnedDirsLoaded, setFavoriteModels, setWorkspaces, setTerminals, setDiscoveredServers, setLoadingHistory, setCanvasMap, spawningCwdsRef, subscribedRef, pendingTerminalCwdRef, maxSeqMapRef, selectedSessionIdRef, loadingHistoryTimersRef, replayPersister, flushLiveEvents, scheduleLiveFlush]);
}
