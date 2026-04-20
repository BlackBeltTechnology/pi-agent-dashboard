/**
 * Extension ↔ Server WebSocket protocol messages.
 */
import type { DashboardEvent, CommandInfo, FlowInfo, SessionSource, ImageContent, FileEntry, TurnUsage, ContextUsage, ModelInfo, PiSessionInfo, OpenSpecPhase, RoleInfo } from "./types.js";

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

export interface CommandsListMessage {
  type: "commands_list";
  sessionId: string;
  commands: CommandInfo[];
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

export interface UiModulesListMessage {
  type: "ui_modules_list";
  sessionId: string;
  modules: any[];
}

export interface UiDataListMessage {
  type: "ui_data_list";
  sessionId: string;
  event: string;
  items: any[];
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
  | UiDataListMessage;

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

export interface UiManagementExtensionMessage {
  type: "ui_management";
  sessionId: string;
  action: string;
  event: string;
  params?: Record<string, any>;
}

export interface ExtensionUiResponseMessage {
  type: "extension_ui_response";
  sessionId: string;
  requestId: string;
  result?: unknown;
  cancelled?: boolean;
}

export interface PromptResponseServerMessage {
  type: "prompt_response";
  sessionId: string;
  promptId: string;
  answer?: string;
  cancelled?: boolean;
  source: string;
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
  | KillProcessMessage
  | UiManagementExtensionMessage;
