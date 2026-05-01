/**
 * Hook that handles ServerToBrowserMessage dispatch.
 * Extracted from App.tsx — maps each message type to the correct state setter.
 */
import { useCallback } from "react";
import { createInitialState, reduceEvent, addInteractiveRequest, resolveInteractiveRequest, dismissInteractiveRequest, type SessionState } from "../lib/event-reducer.js";
import type { DashboardSession, CommandInfo, FlowInfo, FileEntry, OpenSpecData, ModelInfo, RoleInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { encodeFolderPath } from "../lib/folder-encoding.js";
import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import type { EditorInstanceStatus } from "@blackbelt-technology/pi-dashboard-shared/editor-types.js";
import type { DiscoveredServerInfo } from "../components/ServerSelector.js";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { applyPluginConfigUpdate } from "@blackbelt-technology/dashboard-plugin-runtime/context";

export interface MessageHandlerSetters {
  setSessions: React.Dispatch<React.SetStateAction<Map<string, DashboardSession>>>;
  setSessionStates: React.Dispatch<React.SetStateAction<Map<string, SessionState>>>;
  setSessionCommands: React.Dispatch<React.SetStateAction<Map<string, CommandInfo[]>>>;
  setSessionFlows: React.Dispatch<React.SetStateAction<Map<string, FlowInfo[]>>>;
  setFileResults: React.Dispatch<React.SetStateAction<{ query: string; files: FileEntry[] } | null>>;
  setOpenspecMap: React.Dispatch<React.SetStateAction<Map<string, OpenSpecData>>>;
  setModelsMap: React.Dispatch<React.SetStateAction<Map<string, ModelInfo[]>>>;
  setRolesMap: React.Dispatch<React.SetStateAction<Map<string, RoleInfo>>>;
  setSpawnResult: React.Dispatch<React.SetStateAction<{ success: boolean; message: string } | null>>;
  setSessionOrderMap: React.Dispatch<React.SetStateAction<Map<string, string[]>>>;
  setPinnedDirectories: React.Dispatch<React.SetStateAction<string[]>>;
  setTerminals: React.Dispatch<React.SetStateAction<Map<string, TerminalSession>>>;
  setEditorStatuses: React.Dispatch<React.SetStateAction<Map<string, { id: string; status: EditorInstanceStatus }>>>;
  setDiscoveredServers: React.Dispatch<React.SetStateAction<DiscoveredServerInfo[]>>;
  setSpawnErrors: React.Dispatch<React.SetStateAction<Map<string, string>>>;
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
}

export function useMessageHandler(
  setters: MessageHandlerSetters,
  deps: MessageHandlerDeps,
): (msg: ServerToBrowserMessage) => void {
  const {
    setSessions, setSessionStates, setSessionCommands, setSessionFlows,
    setFileResults, setOpenspecMap, setModelsMap, setRolesMap, setSpawnResult,
    setSessionOrderMap, setPinnedDirectories, setTerminals, setEditorStatuses,
    setDiscoveredServers, setSpawnErrors, setResumeErrors,
  } = setters;
  const { send, navigate, clearSpawningCwd, spawningCwdsRef, subscribedRef, pendingTerminalCwdRef, lastCreatedTerminalIdRef, maxSeqMapRef, selectedSessionIdRef } = deps;

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
        if (spawningCwdsRef.current.has(msg.session.cwd)) {
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
          next.set(msg.sessionId, createInitialState());
          return next;
        });
        maxSeqMapRef.current.set(msg.sessionId, 0);
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
        break;

      case "commands_list":
        setSessionCommands((prev) => {
          const next = new Map(prev);
          next.set(msg.sessionId, msg.commands);
          return next;
        });
        break;

      case "flows_list":
        setSessionFlows((prev) => {
          const next = new Map(prev);
          next.set(msg.sessionId, msg.flows);
          return next;
        });
        break;

      case "files_list":
        setFileResults({ query: msg.query, files: msg.files });
        break;

      case "models_list":
        setModelsMap((prev) => {
          const next = new Map(prev);
          next.set(msg.sessionId, msg.models);
          return next;
        });
        break;

      case "roles_list":
        setRolesMap((prev) => {
          const next = new Map(prev);
          next.set(msg.sessionId, {
            roles: msg.roles,
            presets: msg.presets,
            activePreset: msg.activePreset,
          });
          return next;
        });
        break;

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

      case "event_replay": {
        const firstSeq = msg.events.length > 0 ? msg.events[0].seq : null;
        setSessionStates((prev) => {
          const next = new Map(prev);
          let current = (firstSeq === 1) ? createInitialState() : (next.get(msg.sessionId) ?? createInitialState());
          for (const { event } of msg.events) {
            current = reduceEvent(current, event);
          }
          next.set(msg.sessionId, current);
          return next;
        });
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
        } else {
          setResumeErrors((prev) => {
            const next = new Map(prev);
            next.delete(msg.sessionId);
            return next;
          });
        }
        break;

      case "spawn_result":
        setSpawnResult({ success: msg.success, message: msg.message });
        if (!msg.success) {
          clearSpawningCwd(msg.cwd);
          setSpawnErrors((prev) => {
            const next = new Map(prev);
            next.set(msg.cwd, msg.message ?? "Spawn failed");
            return next;
          });
        } else {
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
        clearSpawningCwd(msg.cwd);
        const detail = msg.stderr ? `${msg.message}\n\u2014 stderr \u2014\n${msg.stderr}` : msg.message;
        setSpawnErrors((prev) => {
          const next = new Map(prev);
          next.set(msg.cwd, `[${msg.strategy}] ${detail}`);
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

      case "pinned_dirs_updated":
        setPinnedDirectories(msg.paths);
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
        break;

      case "bootstrap_status_update":
        // Dispatch to BootstrapBanner + useBootstrapStatus via custom DOM event.
        // See change: unified-bootstrap-install §6.
        window.dispatchEvent(new CustomEvent("bootstrap-status", { detail: msg }));
        break;

      case "bootstrap_ticket_complete":
        // Dispatch ticket-completion to anyone holding a 202 ticketId from a
        // queued pi-dependent operation (session spawn, etc).
        // See change: unified-bootstrap-install (verification follow-up).
        window.dispatchEvent(new CustomEvent("bootstrap-ticket", { detail: msg }));
        break;

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

      case "models_refreshed":
        setModelsMap(new Map());
        if (selectedSessionIdRef.current) {
          send({ type: "request_models", sessionId: selectedSessionIdRef.current });
        }
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
  }, [send, clearSpawningCwd, navigate, setSessions, setSessionStates, setSessionCommands, setSessionFlows, setFileResults, setOpenspecMap, setModelsMap, setRolesMap, setSpawnResult, setSessionOrderMap, setPinnedDirectories, setTerminals, setEditorStatuses, setDiscoveredServers, spawningCwdsRef, subscribedRef, pendingTerminalCwdRef, maxSeqMapRef, selectedSessionIdRef]);
}
