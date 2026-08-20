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
import type { ProviderRefreshError } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import type { CommandInfo, DashboardSession, FileEntry, ModelInfo, OpenSpecData, OpenSpecGroup, RoleInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useCallback, useEffect, useRef } from "react";
import type { DiscoveredServerInfo } from "../components/connectivity/ServerSelector.js";
import type { ToastVariant } from "../components/primitives/Toast.js";
import { EMPTY_CANVAS_STATE, reduceCanvasChip, reduceCanvasIntent } from "../lib/canvas/canvas-gate.js";
import { foldLiveEvents, type QueuedLiveEvent } from "../lib/chat/coalesce-live-events.js";
import { addInteractiveRequest, addNotify, applyPromptReceived, carryPendingPrompt, createInitialState, dismissInteractiveRequest, reduceEvent, type SessionState } from "../lib/chat/event-reducer.js";
import {
  createHistoryGapRow,
  createHistoryGapState,
  HISTORY_GAP_ROW_ID,
  type HistoryGapState,
} from "../lib/chat/history-gap.js";
import { dispatchInitEvent } from "../lib/git/worktree-init-bus.js";
import { t } from "../lib/i18n/i18n.js";
import { clearLoadingHistory, HYDRATE_CEILING_MS, rearmLoadingHistory } from "../lib/replay/loading-history.js";
import type { ReplayPersister } from "../lib/replay/replay-persist.js";
import { inferPlatform, pathKey } from "../lib/session/session-grouping.js";
import { clearRecoveryOffer, setRecoveryOffer } from "../lib/state/recovery-offer-bus.js";
import { pushSpawnErrorToast } from "../lib/state/spawn-error-toast-bus.js";
import { isVisibleCwd } from "../lib/util/cwd-visibility.js";

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
  /**
   * Per-session provider refresh failures from the latest `models_list`.
   * A later clean push clears the session's entry.
   * See change: upgrade-model-selector-primitives.
   */
  setModelRefreshErrorsMap: React.Dispatch<React.SetStateAction<Map<string, ProviderRefreshError[]>>>;
  setRolesMap: React.Dispatch<React.SetStateAction<Map<string, RoleInfo>>>;
  setSpawnResult: React.Dispatch<React.SetStateAction<{ success: boolean; message: string } | null>>;
  setSessionOrderMap: React.Dispatch<React.SetStateAction<Map<string, string[]>>>;
  setPinnedDirectories: React.Dispatch<React.SetStateAction<string[]>>;
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

  /**
   * Per-session "history loading" flag. Cleared on the first content batch,
   * the terminal `event_replay{isLast:true}`, or `session_updated{dataUnavailable:true}`.
   * See change: show-chat-history-loading-indicator.
   */
  setLoadingHistory: React.Dispatch<React.SetStateAction<Map<string, boolean>>>;
  /**
   * Second per-session replay flag. Diverges from `loadingHistory`: it clears
   * only on the TERMINAL batch, the failure edge, or a safety-net timeout.
   * See change: show-replay-in-flight-indicator.
   */
  setReplayInFlight: React.Dispatch<React.SetStateAction<Map<string, boolean>>>;
  /**
   * Per-session auto-canvas state, folded from `canvas_intent` /
   * `canvas_server_chip` broadcasts. Coexists with the URL-driven preview
   * routes. See change: auto-canvas (Section 6).
   */
  setCanvasMap: React.Dispatch<React.SetStateAction<Map<string, import("../lib/canvas/canvas-gate.js").CanvasState>>>;
  /**
   * Per-session windowed-replay gap state, folded from `history_window` /
   * `history_backfill_result`. Drives the interstitial gap divider.
   * Optional for back-compat / lean test contexts.
   * See change: lazy-load-session-history.
   */
  setHistoryGaps?: React.Dispatch<React.SetStateAction<Map<string, HistoryGapState>>>;
  /**
   * Monotonic counter bumped once per SUCCESSFUL backfill splice. The chat view
   * keys its scroll-anchor restore on this rather than on `messages.length`:
   * a live event also changes the length (and would consume the anchor for an
   * unrelated row), and the FINAL splice inserts rows while removing the
   * divider, so the net length can be unchanged and the restore would never
   * run at all. A revision fires exactly once per splice, in both cases.
   * See change: lazy-load-session-history (task 7.3).
   */
  setHistorySpliceRev?: React.Dispatch<React.SetStateAction<number>>;
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
  /** Safety-net timers for `replayInFlight`. See change: show-replay-in-flight-indicator. */
  replayInFlightTimersRef: React.MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>;
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
  showToast?: (text: string, variant?: ToastVariant) => void;
}

export function useMessageHandler(
  setters: MessageHandlerSetters,
  deps: MessageHandlerDeps,
): (msg: ServerToBrowserMessage) => void {
  const {
    setSessions, setSessionStates, setSessionCommands,
    setFileResults, setChangedOnDisk, setOpenspecMap, setFolderGitMap, setOpenspecGroupsMap, setModelsMap, setModelRefreshErrorsMap, setRolesMap, setSpawnResult,
    setSessionOrderMap, setPinnedDirectories, setFavoriteModels, setWorkspaces, setTerminals,
    setDiscoveredServers, setSpawnErrors, setResumeErrors,
    setDisplayPrefs, setLoadingHistory, setReplayInFlight, setCanvasMap, setHistoryGaps, setHistorySpliceRev,
  } = setters;
  const { send, navigate, clearSpawningCwd, spawningCwdsRef, subscribedRef, pendingTerminalCwdRef, lastCreatedTerminalIdRef, maxSeqMapRef, selectedSessionIdRef, pendingSpawnsRef, loadingHistoryTimersRef, replayInFlightTimersRef, replayPersister, showToast } = deps;
  // One-shot per session: suppress a repeat auto-name toast for the same
  // session id. See change: add-auto-session-naming.
  const autoNameToastedRef = useRef<Set<string>>(new Set());
  /**
   * Authoritative gap bookkeeping, read SYNCHRONOUSLY inside the `event_replay`
   * reduce loop to decide where the divider row lands. The React state mirror
   * (`setHistoryGaps`) is for rendering only — it lags by a commit, which is
   * one commit too many for a placement decision.
   * See change: lazy-load-session-history.
   */
  const historyGapsRef = useRef<Map<string, HistoryGapState>>(new Map());
  const publishGap = useCallback((sessionId: string, gap: HistoryGapState | undefined) => {
    if (gap) historyGapsRef.current.set(sessionId, gap);
    else historyGapsRef.current.delete(sessionId);
    setHistoryGaps?.((prev) => {
      const next = new Map(prev);
      if (gap) next.set(sessionId, { ...gap });
      else next.delete(sessionId);
      return next;
    });
  }, [setHistoryGaps]);

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
          // Same failure edge for the in-flight flag: no terminal batch is
          // coming, so the pill must not hang.
          // See change: show-replay-in-flight-indicator.
          clearLoadingHistory(setReplayInFlight, replayInFlightTimersRef, msg.sessionId);
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

      case "session_orphaned":
        // The session's process outlived SIGTERM → SIGKILL. `session_removed`
        // follows immediately (the record is released so the session cannot
        // wedge the UI), so without this the user would see an ordinary,
        // successful-looking close while a ~127 MB `pi` stayed resident — the
        // exact indistinguishability that hid #452 for weeks.
        // See change: fix-tmux-session-shutdown-leak.
        showToast?.(
          t(
            "session.orphanedProcess",
            { pid: msg.pid },
            `Session closed, but its process (pid ${msg.pid}) survived and is still running.`,
          ),
          "error",
        );
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
        // `session_removed` is the confirmed clean-shutdown / force-kill
        // boundary. Preserve transcript/statistics, but no retry or provider
        // error can remain actionable after the process is gone.
        setSessionStates((prev) => {
          const existing = prev.get(msg.sessionId);
          if (!existing) return prev;
          const next = new Map(prev);
          next.set(msg.sessionId, {
            ...existing,
            status: "ended",
            isStreaming: false,
            currentTool: undefined,
            retryState: undefined,
            lastError: undefined,
            retryCancelled: undefined,
          });
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
          // …but a `sending` bubble is NOT carried: nothing in the rebuilt
          // state can settle it. See change: fix-optimistic-prompt-stuck-sending.
          const carry = carryPendingPrompt(next.get(msg.sessionId)?.pendingPrompt);
          const fresh = createInitialState();
          if (carry) fresh.pendingPrompt = carry;
          next.set(msg.sessionId, fresh);
          return next;
        });
        maxSeqMapRef.current.set(msg.sessionId, 0);
        // Drop gap bookkeeping and any pending backfill: the transcript this
        // gap described no longer exists. The server's own generation counter
        // is the other half of this — belt and braces, not co-dependent.
        // See change: lazy-load-session-history (D9, 6.5).
        publishGap(msg.sessionId, undefined);
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
        // Origin `live`: broadcast fan-out reaches sessions this tab never
        // subscribed to, so it establishes no provenance on its own.
        replayPersister?.record(msg.sessionId, [{ seq: msg.seq, event: msg.event }], "live");
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
        // Refresh failures are per-message, not sticky: a later clean push for
        // the same session clears the footer notice.
        // See change: upgrade-model-selector-primitives.
        setModelRefreshErrorsMap((prev) => {
          // Trust boundary: `msg` is bridge-supplied runtime data. Keep only
          // well-formed entries so a malformed payload cannot reach the footer
          // (React throws when handed an object as a text child).
          const errs = Array.isArray(msg.refreshErrors)
            ? msg.refreshErrors.filter(
                (e): e is ProviderRefreshError =>
                  !!e && typeof e.provider === "string" && typeof e.message === "string",
              )
            : undefined;
          if (!errs || errs.length === 0) {
            if (!prev.has(msg.sessionId)) return prev;
            const next = new Map(prev);
            next.delete(msg.sessionId);
            return next;
          }
          const next = new Map(prev);
          next.set(msg.sessionId, errs);
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

      /**
       * A windowed replay is about to arrive. Emitted on full-stream paths
       * ONLY, so a delta reconnect can never reset an in-progress exploration.
       * See change: lazy-load-session-history (D5).
       */
      case "history_window": {
        if (msg.gapCount > 0) publishGap(msg.sessionId, createHistoryGapState(msg));
        else publishGap(msg.sessionId, undefined);
        break;
      }

      /**
       * Splice a backfilled segment into the gap. Touches `messages[]` and
       * NOTHING ELSE (D10): it does not move `maxSeqMapRef` (backfilled seqs
       * are below the live high-water mark by construction), does not
       * `publishSessionEvents` (a live-event fan-out — replaying history into
       * it would double-count plugin state), and does not write to
       * `replayPersister` (which would cache a sparse array as contiguous).
       */
      case "history_backfill_result": {
        const gap = historyGapsRef.current.get(msg.sessionId);
        if (!gap) break;
        if (msg.error) {
          publishGap(msg.sessionId, { ...gap, pending: false, failed: true });
          break;
        }
        if (msg.events.length > 0) {
          setHistorySpliceRev?.((n) => n + 1);
          setSessionStates((prev) => {
            const current = prev.get(msg.sessionId);
            if (!current) return prev;
            const at = current.messages.findIndex((m) => m.id === HISTORY_GAP_ROW_ID);
            if (at < 0) return prev;
            // Reduce the segment from a FRESH state. It begins mid-conversation,
            // so an orphan `message_end` / `tool_execution_end` at its leading
            // edge is expected — the reducer tolerating that is the correctness
            // guarantee behind the server's best-effort edge snapping (D4).
            let seg = createInitialState();
            for (const { event } of msg.events) seg = reduceEvent(seg, event);
            const messages = [
              ...current.messages.slice(0, at),
              ...seg.messages,
              ...current.messages.slice(at),
            ];
            const next = new Map(prev);
            next.set(msg.sessionId, { ...current, messages });
            return next;
          });
        }
        // Stop offering the affordance when the response returns nothing or
        // reports nothing left — keyed on the RESPONSE, not on arithmetic, so
        // it terminates correctly over a holey store.
        const exhausted = msg.events.length === 0 || msg.remainingGapCount === 0;
        if (exhausted && msg.remainingGapCount === 0 && msg.events.length > 0) {
          // A6 — fully filled: remove the divider entirely, nothing left to disclose.
          setSessionStates((prev) => {
            const current = prev.get(msg.sessionId);
            if (!current) return prev;
            const next = new Map(prev);
            next.set(msg.sessionId, {
              ...current,
              messages: current.messages.filter((m) => m.id !== HISTORY_GAP_ROW_ID),
            });
            return next;
          });
          publishGap(msg.sessionId, undefined);
          break;
        }
        publishGap(msg.sessionId, {
          ...gap,
          headMaxSeq: msg.servedTo > 0 ? msg.servedTo : gap.headMaxSeq,
          gapCount: msg.remainingGapCount,
          pending: false,
          failed: false,
          // A5 — the gap existed but the store cannot serve it. Not an error.
          unservable: exhausted,
        });
        break;
      }

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
          const carry = shouldReset ? carryPendingPrompt(next.get(msg.sessionId)?.pendingPrompt) : undefined;
          let current = shouldReset ? createInitialState() : (next.get(msg.sessionId) ?? createInitialState());
          if (carry) current.pendingPrompt = carry;
          // Place the gap divider at the head→tail boundary: immediately before
          // the first event whose seq belongs to the tail segment. Placement
          // must happen DURING the fold — after it, the rows carry no seq and
          // the boundary is unrecoverable.
          const gap = historyGapsRef.current.get(msg.sessionId);
          for (const { seq, event } of msg.events) {
            if (gap && !gap.dividerPlaced && gap.gapCount > 0 && seq >= gap.tailMinSeq) {
              current = { ...current, messages: [...current.messages, createHistoryGapRow()] };
              gap.dividerPlaced = true;
            }
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
        //
        // EXCEPT when this replay is windowed. Windowed events arrive over the
        // ordinary `event_replay` stream, which would otherwise cache a SPARSE
        // array as if it were contiguous. The next reload would then HIT the
        // cache, re-reduce head+tail as silently adjacent, and delta-subscribe
        // — and a delta never emits `history_window`, so the gap would become
        // permanently invisible and unrecoverable. Skipping the write makes the
        // next reload a MISS → full stream → windowed again → affordance
        // restored. Self-healing.
        // See change: lazy-load-session-history (D12).
        const windowed = (historyGapsRef.current.get(msg.sessionId)?.gapCount ?? 0) > 0;
        if (msg.events.length > 0 && !windowed) {
          if (shouldReset) replayPersister?.seed(msg.sessionId, msg.events);
          // Origin `replay`: this envelope answers THIS tab's subscribe, so it
          // establishes provenance even when a compacted/capped cold replay
          // starts past seq 1 (i.e. does not reset).
          else replayPersister?.record(msg.sessionId, msg.events, "replay");
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
        // `replayInFlight` deliberately diverges from `loadingHistory` above:
        // first content clears the skeleton but the transcript is still
        // filling, so only the TERMINAL batch clears the in-flight flag. Every
        // NON-terminal batch — content batches included, not just the empty
        // heartbeat — is a liveness signal that re-arms the ceiling; without
        // that the ceiling would expire mid-transfer and drop the pill while
        // the tail is still missing. `rearmLoadingHistory` touches only the
        // timers ref (never the setter), so a multi-batch replay does not
        // re-render the transcript once per batch.
        // See change: show-replay-in-flight-indicator.
        if (msg.isLast === true) {
          clearLoadingHistory(setReplayInFlight, replayInFlightTimersRef, msg.sessionId);
          // ARM backfill only now (D11). Before the terminal batch an evicted
          // cold session's store is still empty, so a request would report the
          // gap unservable and then hydration would make it servable again.
          const armGap = historyGapsRef.current.get(msg.sessionId);
          if (armGap && !armGap.armed) publishGap(msg.sessionId, { ...armGap, armed: true });
        } else {
          rearmLoadingHistory(setReplayInFlight, replayInFlightTimersRef, msg.sessionId, HYDRATE_CEILING_MS);
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
        // (no auto-timeout). `graceUntil` gates Reopen actionability while
        // Class-2 liveness resolves. See changes: reopen-sessions-after-shutdown,
        // fix-recovery-offer-bridge-liveness-gate.
        setRecoveryOffer(msg.candidates, msg.graceUntil);
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

      // Notify: a render-only chat row. NEVER `addInteractiveRequest` — that
      // would recreate the phantom "user is blocked" state.
      // See change: split-notify-from-prompt-request.
      case "notify":
        setSessionStates((prev) => {
          const next = new Map(prev);
          const current = next.get(msg.sessionId) ?? createInitialState();
          const updated = addNotify(current, msg.notifyId, msg.message, msg.level);
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
        // A newly-created terminal now surfaces as a `term:<id>` tab inside the
        // pane that requested it (the pane's terminal slice watches the
        // terminal set and opens the tab in-place). The standalone
        // /folder/:cwd/terminals route was removed, so DO NOT navigate here —
        // doing so deselected the session and landed on the empty state.
        // We still clear the pending marker + record the id for parity.
        // See change: terminals-in-tabbed-panes.
        if (pendingTerminalCwdRef.current === msg.terminal.cwd) {
          pendingTerminalCwdRef.current = null;
          lastCreatedTerminalIdRef.current = msg.terminal.id;
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
  }, [send, clearSpawningCwd, navigate, setSessions, setSessionStates, setSessionCommands, setFileResults, setChangedOnDisk, setOpenspecMap, setModelsMap, setModelRefreshErrorsMap, setRolesMap, setSpawnResult, setSessionOrderMap, setPinnedDirectories, setFavoriteModels, setWorkspaces, setTerminals, setDiscoveredServers, setLoadingHistory, setReplayInFlight, setCanvasMap, spawningCwdsRef, subscribedRef, pendingTerminalCwdRef, maxSeqMapRef, selectedSessionIdRef, loadingHistoryTimersRef, replayInFlightTimersRef, replayPersister, flushLiveEvents, scheduleLiveFlush, publishGap, setHistorySpliceRev]);
}
