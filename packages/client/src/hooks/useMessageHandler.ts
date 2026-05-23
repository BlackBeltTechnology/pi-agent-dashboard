/**
 * Hook that handles ServerToBrowserMessage dispatch.
 * Extracted from App.tsx — maps each message type to the correct state setter.
 */
import { useCallback } from "react";
import { createInitialState, reduceEvent, addInteractiveRequest, resolveInteractiveRequest, dismissInteractiveRequest, type SessionState } from "../lib/event-reducer.js";
import type { DashboardSession, CommandInfo, FileEntry, OpenSpecData, OpenSpecGroup, ModelInfo, RoleInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { encodeFolderPath } from "../lib/folder-encoding.js";
import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import type { EditorInstanceStatus } from "@blackbelt-technology/pi-dashboard-shared/editor-types.js";
import type { DiscoveredServerInfo } from "../components/ServerSelector.js";
import type {
  ServerToBrowserMessage,
  SpawnFailureCode,
  PreflightReason,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

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
import { applyPluginConfigUpdate, getPluginConfig } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import {
  publishSessionEvent,
  clearSessionEvents,
  publishSessionData,
  intentStore,
} from "@blackbelt-technology/dashboard-plugin-runtime";

export interface MessageHandlerSetters {
  setSessions: React.Dispatch<React.SetStateAction<Map<string, DashboardSession>>>;
  setSessionStates: React.Dispatch<React.SetStateAction<Map<string, SessionState>>>;
  setSessionCommands: React.Dispatch<React.SetStateAction<Map<string, CommandInfo[]>>>;
  // Note: setSessionFlows removed. flows-plugin reads `flowsList` from
  // the per-session-data store directly. See change:
  // pluginize-flows-via-registry.
  setFileResults: React.Dispatch<React.SetStateAction<{ query: string; files: FileEntry[] } | null>>;
  setOpenspecMap: React.Dispatch<React.SetStateAction<Map<string, OpenSpecData>>>;
  setOpenspecGroupsMap: React.Dispatch<React.SetStateAction<Map<string, { groups: OpenSpecGroup[]; assignments: Record<string, string> }>>>;
  setModelsMap: React.Dispatch<React.SetStateAction<Map<string, ModelInfo[]>>>;
  setRolesMap: React.Dispatch<React.SetStateAction<Map<string, RoleInfo>>>;
  setSpawnResult: React.Dispatch<React.SetStateAction<{ success: boolean; message: string } | null>>;
  setSessionOrderMap: React.Dispatch<React.SetStateAction<Map<string, string[]>>>;
  setPinnedDirectories: React.Dispatch<React.SetStateAction<string[]>>;
  /** folder-workspaces: full workspace list, kept in sync via `workspaces_updated`. */
  setWorkspaces: React.Dispatch<React.SetStateAction<import("@blackbelt-technology/pi-dashboard-shared/browser-protocol.js").Workspace[]>>;
  setTerminals: React.Dispatch<React.SetStateAction<Map<string, TerminalSession>>>;
  setEditorStatuses: React.Dispatch<React.SetStateAction<Map<string, { id: string; status: EditorInstanceStatus }>>>;
  setDiscoveredServers: React.Dispatch<React.SetStateAction<DiscoveredServerInfo[]>>;
  setSpawnErrors: React.Dispatch<React.SetStateAction<Map<string, SpawnErrorDetail>>>;
  setResumeErrors: React.Dispatch<React.SetStateAction<Map<string, string>>>;
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
  pendingSpawnsRef: React.MutableRefObject<Map<string, { cwd: string; kind: "spawn" | "resume" }>>;
}

export function useMessageHandler(
  setters: MessageHandlerSetters,
  deps: MessageHandlerDeps,
): (msg: ServerToBrowserMessage) => void {
  const {
    setSessions, setSessionStates, setSessionCommands,
    setFileResults, setOpenspecMap, setOpenspecGroupsMap, setModelsMap, setRolesMap, setSpawnResult,
    setSessionOrderMap, setPinnedDirectories, setWorkspaces, setTerminals, setEditorStatuses,
    setDiscoveredServers, setSpawnErrors, setResumeErrors,
  } = setters;
  const { send, navigate, clearSpawningCwd, spawningCwdsRef, subscribedRef, pendingTerminalCwdRef, lastCreatedTerminalIdRef, maxSeqMapRef, selectedSessionIdRef, pendingSpawnsRef } = deps;

  return useCallback((msg: ServerToBrowserMessage) => {
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
        // Tier 1: exact correlation by spawnRequestId. Works for both
        // spawn-from-folder and fork-from-card (closes the no-auto-select-
        // after-fork UX gap). See change: spawn-correlation-token.
        if (msg.spawnRequestId && pendingSpawnsRef.current.has(msg.spawnRequestId)) {
          const entry = pendingSpawnsRef.current.get(msg.spawnRequestId)!;
          pendingSpawnsRef.current.delete(msg.spawnRequestId);
          if (entry.kind === "spawn" && entry.cwd) clearSpawningCwd(entry.cwd);
          navigate(`/session/${msg.session.id}`);
        } else if (spawningCwdsRef.current.has(msg.session.cwd)) {
          // Tier 2 (legacy fallback): cwd-based heuristic for older servers
          // that don't echo spawnRequestId. Only fires for spawn (not fork)
          // because fork dispatches don't add to spawningCwds today.
          clearSpawningCwd(msg.session.cwd);
          navigate(`/session/${msg.session.id}`);
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
        // Mirror the reset into the plugin-runtime per-session event
        // store so plugin reducers (e.g. flows-plugin) re-derive from
        // a clean stream after a replay. See change:
        // pluginize-flows-via-registry.
        clearSessionEvents(msg.sessionId);
        break;

      case "event":
        setSessionStates((prev) => {
          const next = new Map(prev);
          const current = next.get(msg.sessionId) ?? createInitialState();
          next.set(msg.sessionId, reduceEvent(current, msg.event));
          return next;
        });
        if (msg.seq > (maxSeqMapRef.current.get(msg.sessionId) ?? 0)) {
          maxSeqMapRef.current.set(msg.sessionId, msg.seq);
        }
        // Publish to the plugin-runtime per-session event store so
        // plugin slot consumers calling `useSessionEvents(sessionId)`
        // re-render with the extended event list. The shell's reducer
        // and the plugin store consume the same `msg.event`. See
        // change: pluginize-flows-via-registry.
        publishSessionEvent(msg.sessionId, msg.event);
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

      case "openspec_groups_update":
        setOpenspecGroupsMap((prev) => {
          const next = new Map(prev);
          next.set(msg.cwd, { groups: msg.groups, assignments: msg.assignments });
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
        break;
      }

      case "resume_result":
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
            next.set(msg.sessionId, msg.message ?? "Resume failed");
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
            setSpawnResult({ success: true, message: msg.message ?? "Started a fresh session." });
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
          clearSpawningCwd(msg.cwd);
          // Leave the spawn_error message to fill the rich detail; set a placeholder if not yet present.
          setSpawnErrors((prev) => {
            const next = new Map(prev);
            if (!next.has(msg.cwd)) {
              next.set(msg.cwd, { kind: "error", message: msg.message ?? "Spawn failed" });
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

      case "editor_status":
        setEditorStatuses((prev) => {
          const next = new Map(prev);
          if (msg.status === "stopped") {
            next.delete(msg.cwd);
          } else {
            next.set(msg.cwd, { id: msg.id, status: msg.status });
          }
          return next;
        });
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
  }, [send, clearSpawningCwd, navigate, setSessions, setSessionStates, setSessionCommands, setFileResults, setOpenspecMap, setModelsMap, setRolesMap, setSpawnResult, setSessionOrderMap, setPinnedDirectories, setWorkspaces, setTerminals, setEditorStatuses, setDiscoveredServers, spawningCwdsRef, subscribedRef, pendingTerminalCwdRef, maxSeqMapRef, selectedSessionIdRef]);
}
