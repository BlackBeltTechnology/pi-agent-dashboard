/**
 * Extension ↔ Server WebSocket protocol messages.
 */
import type { DashboardEvent, CommandInfo, FlowInfo, SessionSource, ImageContent, FileEntry, TurnUsage, ContextUsage, ModelInfo, PiSessionInfo, OpenSpecPhase, RoleInfo, ExtensionUiModule, DecoratorDescriptor } from "./types.js";

// ── Extension → Server ──────────────────────────────────────────────

export interface SessionRegisterMessage {
  type: "session_register";
  sessionId: string;
  cwd: string;
  name?: string;
  source: SessionSource;
  model?: string;
  thinkingLevel?: string;
  sessionFile?: string;
  sessionDir?: string;
  firstMessage?: string;
  /** True when this is a fresh session start (not a reconnection) */
  isNew?: boolean;
  /** Number of conversation entries — used by server to skip event wipe on reconnect */
  eventCount?: number;
  /** OS process ID of the pi agent — used for force-kill escalation */
  pid?: number;
  /**
   * Why the bridge is registering this session. The bridge sets this to
   * `"spawn"` for the very first `session_register` after process boot
   * and for every register emitted by the new/fork/resume path
   * (`handleSessionChange`), and `"reattach"` for any subsequent
   * `sendStateSync` triggered by a WebSocket reconnect to the dashboard
   * server (i.e. the dashboard restarted while the bridge stayed alive).
   * When omitted (legacy bridges), the server treats the message as if
   * `"spawn"` was specified.
   * See change: reattach-move-to-front.
   */
  registerReason?: "spawn" | "reattach";
}

export interface SessionUnregisterMessage {
  type: "session_unregister";
  sessionId: string;
}

export interface ProcessMetrics {
  /** RSS in bytes */
  rss: number;
  /** Heap used in bytes */
  heapUsed: number;
  /** Heap total in bytes */
  heapTotal: number;
  /** CPU usage percent since last heartbeat (0-100+) */
  cpuPercent: number;
  /** Event loop max delay in ms since last heartbeat */
  eventLoopMaxMs?: number;
  /** System load average (1 min) */
  loadAvg1m: number;
}

export interface SessionHeartbeatMessage {
  type: "session_heartbeat";
  sessionId: string;
  /** Process metrics from the pi agent process */
  metrics?: ProcessMetrics;
}

export interface EventForwardMessage {
  type: "event_forward";
  sessionId: string;
  event: DashboardEvent;
}

/**
 * Conventions on `event_forward` payloads relevant to per-message fork:
 *
 * - `message_start` and `message_end` events MAY carry an optional
 *   `data.nonce: string` stamped by the bridge. The reducer carries it
 *   onto the resulting ChatMessage so a later `entry_persisted` event
 *   can back-fill the entry id.
 * - `entry_persisted` events have shape:
 *     {
 *       eventType: "entry_persisted",
 *       timestamp,
 *       data: { type: "entry_persisted", entryId: string, nonce: string }
 *     }
 *   They are emitted by the bridge after pi calls
 *   `sessionManager.appendMessage` and the entry id has been generated.
 *   See change: fix-per-message-fork.
 */
export interface EntryPersistedEventData {
  type: "entry_persisted";
  entryId: string;
  nonce: string;
}

export interface CommandsListMessage {
  type: "commands_list";
  sessionId: string;
  commands: CommandInfo[];
}

export interface FlowsListMessage {
  type: "flows_list";
  sessionId: string;
  flows: FlowInfo[];
}

export interface ExtensionUiRequestMessage {
  type: "extension_ui_request";
  sessionId: string;
  requestId: string;
  method: string;
  params: Record<string, unknown>;
}

// StatsUpdateMessage removed — server extracts stats directly from forwarded turn_end events

export interface FilesListMessage {
  type: "files_list";
  sessionId: string;
  query: string;
  files: FileEntry[];
}

export interface GitInfoUpdateMessage {
  type: "git_info_update";
  sessionId: string;
  gitBranch: string;
  gitBranchUrl?: string;
  gitPrNumber?: number;
  gitPrUrl?: string;
}

/**
 * Bridge → server: jj workspace state for the session's cwd.
 * Sent only when the bridge's VCS probe finds `.jj/` AND `jj` resolves
 * via the tool registry. Cleared (sent with `jjState: null`) when the
 * session leaves a jj repo (e.g. cwd switch). See change: add-jj-workspace-plugin.
 */
export interface JjStateUpdateMessage {
  type: "jj_state_update";
  sessionId: string;
  /** `null` clears the session's `jjState` field on the server. */
  jjState: import("./types.js").JjState | null;
}

// OpenSpecUpdateMessage removed — server polls directly via DirectoryService

export interface ModelsListMessage {
  type: "models_list";
  sessionId: string;
  models: ModelInfo[];
}

export interface SessionNameUpdateMessage {
  type: "session_name_update";
  sessionId: string;
  name: string;
}

export interface SessionsListExtensionMessage {
  type: "sessions_list";
  sessionId: string;
  cwd: string;
  sessions: PiSessionInfo[];
}

// SessionHistorySyncMessage removed — server reads history directly via DirectoryService
// OpenSpecActivityUpdateMessage removed — server detects OpenSpec activity from forwarded events

export interface ModelUpdateMessage {
  type: "model_update";
  sessionId: string;
  model: string;
  thinkingLevel?: string;
}

export interface ReplayCompleteMessage {
  type: "replay_complete";
  sessionId: string;
}

export interface FirstMessageUpdateMessage {
  type: "first_message_update";
  sessionId: string;
  firstMessage: string;
}

export interface RolesListMessage {
  type: "roles_list";
  sessionId: string;
  roles: Record<string, string>;
  presets: Array<{ name: string; roles: Record<string, string> }>;
  activePreset: string | null;
}

export interface ExtensionUiDismissMessage {
  type: "extension_ui_dismiss";
  sessionId: string;
  requestId: string;
}

export interface SpawnNewSessionMessage {
  type: "spawn_new_session";
  sessionId: string;
  cwd: string;
}

// ── PromptBus protocol messages ─────────────────────────────────────

export interface PromptRequestMessage {
  type: "prompt_request";
  sessionId: string;
  promptId: string;
  prompt: {
    question: string;
    type: string;
    options?: string[];
    defaultValue?: string;
    pipeline?: string;
    metadata?: Record<string, unknown>;
  };
  component: {
    type: string;
    props: Record<string, unknown>;
  };
  placement: string;
}

export interface PromptDismissMessage {
  type: "prompt_dismiss";
  sessionId: string;
  promptId: string;
}

export interface PromptCancelMessage {
  type: "prompt_cancel";
  sessionId: string;
  promptId: string;
}

export interface ProcessInfo {
  pid: number;
  pgid: number;
  command: string;
  elapsedMs: number;
}

export interface ProcessListMessage {
  type: "process_list";
  sessionId: string;
  processes: ProcessInfo[];
}

// LoadSessionEventsResultMessage and LoadSessionEventsErrorMessage removed — server loads directly

// ── Extension UI System (Phase 1) ──
// Pull-discovered, schema-driven UI modules. See change: add-extension-ui-modal.

export interface UiModulesListMessage {
  type: "ui_modules_list";
  sessionId: string;
  modules: ExtensionUiModule[];
}

export interface UiDataListMessage {
  type: "ui_data_list";
  sessionId: string;
  /** Matches some `module.view.dataEvent`. */
  event: string;
  items: unknown[];
}

// ── Extension UI System (Phase 2: live in-page decorations) ──
// See change: add-extension-ui-decorations.

/**
 * Extension → server: a single live decorator descriptor. Cache key
 * `${kind}:${namespace}:${id}` MUST be unique within a session; `removed: true`
 * deletes the cache entry instead of upserting.
 */
export interface ExtUiDecoratorMessage {
  type: "ext_ui_decorator";
  sessionId: string;
  descriptor: DecoratorDescriptor;
  /** When true, server deletes the cached descriptor under the matching key. */
  removed?: boolean;
}

export type ExtensionToServerMessage =
  | SessionRegisterMessage
  | SessionUnregisterMessage
  | SessionHeartbeatMessage
  | EventForwardMessage
  | CommandsListMessage
  | FlowsListMessage
  | ExtensionUiRequestMessage
  | FilesListMessage
  | GitInfoUpdateMessage
  | JjStateUpdateMessage
  | SessionNameUpdateMessage
  | ModelsListMessage
  | ModelUpdateMessage
  | SessionsListExtensionMessage
  | ExtensionUiDismissMessage
  | PromptRequestMessage
  | PromptDismissMessage
  | PromptCancelMessage
  | ReplayCompleteMessage
  | FirstMessageUpdateMessage
  | RolesListMessage
  | SpawnNewSessionMessage
  | ProcessListMessage
  | UiModulesListMessage
  | UiDataListMessage
  | ExtUiDecoratorMessage;

// ── Server → Extension ──────────────────────────────────────────────

export interface SendPromptToExtensionMessage {
  type: "send_prompt";
  sessionId: string;
  text: string;
  images?: ImageContent[];
}

export interface AbortToExtensionMessage {
  type: "abort";
  sessionId: string;
}

export interface RequestCommandsMessage {
  type: "request_commands";
  sessionId: string;
}

export interface RequestStateSyncMessage {
  type: "request_state_sync";
  sessionId: string;
}

export interface ListFilesMessage {
  type: "list_files";
  sessionId: string;
  query: string;
}

// OpenSpecRefreshMessage removed — server refreshes directly via DirectoryService

export interface RenameSessionExtensionMessage {
  type: "rename_session";
  sessionId: string;
  name: string;
}

export interface RequestModelsMessage {
  type: "request_models";
  sessionId: string;
}

export interface SetThinkingLevelMessage {
  type: "set_thinking_level";
  sessionId: string;
  level: string;
}

export interface ListSessionsExtensionMessage {
  type: "list_sessions";
  sessionId: string;
  cwd: string;
}

export interface SetModelMessage {
  type: "set_model";
  sessionId: string;
  provider: string;
  modelId: string;
}

export interface ShutdownExtensionMessage {
  type: "shutdown";
  sessionId: string;
}

export interface FlowControlExtensionMessage {
  type: "flow_control";
  sessionId: string;
  action: "abort" | "toggle_autonomous" | "dismiss_summary";
}

// LoadSessionEventsMessage removed — server loads directly via DirectoryService

export interface HeartbeatAckMessage {
  type: "heartbeat_ack";
}

export interface RequestFlowsRefreshMessage {
  type: "request_flows_refresh";
  sessionId: string;
}

export interface CredentialsUpdatedMessage {
  type: "credentials_updated";
}

export interface FlowManagementExtensionMessage {
  type: "flow_management";
  sessionId: string;
  action: "run" | "new" | "edit" | "delete";
  flowName?: string;
  task?: string;
  description?: string;
}

export interface ArchitectPromptResponseExtensionMessage {
  type: "architect_prompt_response";
  sessionId: string;
  promptId: string;
  answer?: string;
  cancelled?: boolean;
}

export interface RoleSetExtensionMessage {
  type: "role_set";
  sessionId: string;
  role: string;
  modelId: string;
}

export interface RolePresetLoadExtensionMessage {
  type: "role_preset_load";
  sessionId: string;
  presetName: string;
}

export interface RolePresetSaveExtensionMessage {
  type: "role_preset_save";
  sessionId: string;
  presetName: string;
}

export interface RolePresetDeleteExtensionMessage {
  type: "role_preset_delete";
  sessionId: string;
  presetName: string;
}

export interface RequestRolesMessage {
  type: "request_roles";
  sessionId: string;
}

export interface KillProcessMessage {
  type: "kill_process";
  sessionId: string;
  pgid: number;
}

export interface ExtensionUiResponseMessage {
  type: "extension_ui_response";
  sessionId: string;
  requestId: string;
  result?: unknown;
  cancelled?: boolean;
}

/**
 * Server → extension: a browser invoked an action / requested data on a
 * Phase-1 management-modal module. The bridge re-emits this on `pi.events`
 * as `pi.events.emit(msg.event, { ...msg.params, action: msg.action, _reply })`.
 * Extensions either populate `data.items` synchronously (for `action: "list"`
 * data fetches) or perform side-effects and emit `ui:invalidate` to refresh.
 */
export interface UiManagementMessage {
  type: "ui_management";
  sessionId: string;
  /** Action id (matches some `UiAction.id`) or `"list"` for data fetch. */
  action: string;
  /** Event name to emit (matches `view.dataEvent` or `UiAction.event`). */
  event: string;
  params?: Record<string, unknown>;
}

export interface PromptResponseServerMessage {
  type: "prompt_response";
  sessionId: string;
  promptId: string;
  answer?: string;
  cancelled?: boolean;
  source: string;
}

/**
 * Server → extension: the dashboard server is about to exit as part of a
 * deliberate restart or shutdown. Bridges that receive this MUST suppress
 * the spawn step in `server-auto-start.ts` for `quiesceMs` ms; mDNS
 * discovery + health-check probes still run, so reconnection to the
 * orchestrator-spawned replacement is unaffected.
 *
 * See change: fix-restart-bridge-auto-start-race.
 */
export interface ServerRestartingExtensionMessage {
  type: "server_restarting";
  reason: "restart" | "shutdown";
  /** Suppression window in ms. Default 5000 for restart, 60000 for shutdown. */
  quiesceMs: number;
}

export type ServerToExtensionMessage =
  | SendPromptToExtensionMessage
  | AbortToExtensionMessage
  | ExtensionUiResponseMessage
  | RequestCommandsMessage
  | RequestStateSyncMessage
  | ListFilesMessage
  | RenameSessionExtensionMessage
  | RequestModelsMessage
  | SetThinkingLevelMessage
  | ListSessionsExtensionMessage
  | SetModelMessage
  | ShutdownExtensionMessage
  | FlowControlExtensionMessage
  | HeartbeatAckMessage
  | RequestFlowsRefreshMessage
  | CredentialsUpdatedMessage
  | FlowManagementExtensionMessage
  | ArchitectPromptResponseExtensionMessage
  | PromptResponseServerMessage
  | RoleSetExtensionMessage
  | RolePresetLoadExtensionMessage
  | RolePresetSaveExtensionMessage
  | RolePresetDeleteExtensionMessage
  | RequestRolesMessage
  | UiManagementMessage
  | KillProcessMessage
  | ServerRestartingExtensionMessage;
