/**
 * Server ↔ Browser WebSocket protocol messages.
 */
import type {
  DashboardSession,
  DashboardEvent,
  CommandInfo,
  FlowInfo,
  ImageContent,
  FileEntry,
  OpenSpecData,
  ModelInfo,
  PiSessionInfo,
} from "./types.js";
import type { TerminalSession } from "./terminal-types.js";
import type { EditorInstanceStatus } from "./editor-types.js";

// ── Server → Browser ────────────────────────────────────────────────

export interface SessionAddedMessage {
  type: "session_added";
  session: DashboardSession;
}

export interface SessionUpdatedMessage {
  type: "session_updated";
  sessionId: string;
  updates: Partial<DashboardSession>;
}

export interface SessionRemovedMessage {
  type: "session_removed";
  sessionId: string;
}

export interface EventMessage {
  type: "event";
  sessionId: string;
  seq: number;
  event: DashboardEvent;
}

export interface EventReplayMessage {
  type: "event_replay";
  sessionId: string;
  events: Array<{ seq: number; event: DashboardEvent }>;
  isLast: boolean;
}

export interface BrowserCommandsListMessage {
  type: "commands_list";
  sessionId: string;
  commands: CommandInfo[];
}

export interface BrowserFlowsListMessage {
  type: "flows_list";
  sessionId: string;
  flows: FlowInfo[];
}

export interface BrowserExtensionUiRequestMessage {
  type: "extension_ui_request";
  sessionId: string;
  requestId: string;
  method: string;
  params: Record<string, unknown>;
}

export interface BrowserUiDismissMessage {
  type: "ui_dismiss";
  sessionId: string;
  requestId: string;
}

export interface BrowserFilesListMessage {
  type: "files_list";
  sessionId: string;
  query: string;
  files: FileEntry[];
}

export interface BrowserOpenSpecUpdateMessage {
  type: "openspec_update";
  cwd: string;
  data: OpenSpecData;
}

export interface BrowserModelsListMessage {
  type: "models_list";
  sessionId: string;
  models: ModelInfo[];
}

export interface ModelsRefreshedMessage {
  type: "models_refreshed";
}

export interface BrowserRolesListMessage {
  type: "roles_list";
  sessionId: string;
  roles: Record<string, string>;
  presets: Array<{ name: string; roles: Record<string, string> }>;
  activePreset: string | null;
}

export interface SessionsListBrowserMessage {
  type: "sessions_list";
  sessionId: string;
  cwd: string;
  sessions: PiSessionInfo[];
}

export interface ResumeResultBrowserMessage {
  type: "resume_result";
  sessionId: string;
  success: boolean;
  message: string;
}

export interface SpawnResultBrowserMessage {
  type: "spawn_result";
  cwd: string;
  success: boolean;
  message: string;
}

/**
 * Emitted when a session spawn fails — either because `spawnPiSession` threw,
 * returned `{ success: false }`, or the spawned child crashed immediately.
 * Carries enough context for the UI to render a retryable error banner
 * instead of leaving the user staring at a silent empty state.
 */
export interface SpawnErrorMessage {
  type: "spawn_error";
  cwd: string;
  strategy: string;
  message: string;
  /** Up to ~2 KB tail of stderr captured from the failed child, if any. */
  stderr?: string;
}

export interface SessionsReorderedMessage {
  type: "sessions_reordered";
  cwd: string;
  sessionIds: string[];
}

export interface PinnedDirsUpdatedMessage {
  type: "pinned_dirs_updated";
  paths: string[];
}

export interface TerminalAddedMessage {
  type: "terminal_added";
  terminal: TerminalSession;
}

export interface TerminalRemovedMessage {
  type: "terminal_removed";
  terminalId: string;
}

export interface TerminalUpdatedMessage {
  type: "terminal_updated";
  terminalId: string;
  updates: Partial<TerminalSession>;
}

/** Tells the browser to reset accumulated state for a session (bridge reconnected). */
export interface SessionStateResetMessage {
  type: "session_state_reset";
  sessionId: string;
}

/** Notifies browsers of editor instance status changes. */
export interface EditorStatusMessage {
  type: "editor_status";
  cwd: string;
  id: string;
  status: EditorInstanceStatus;
}

// ── PromptBus protocol (Server → Browser) ───────────────────────────

export interface BrowserPromptRequestMessage {
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

export interface BrowserPromptDismissMessage {
  type: "prompt_dismiss";
  sessionId: string;
  promptId: string;
}

export interface BrowserPromptCancelMessage {
  type: "prompt_cancel";
  sessionId: string;
  promptId: string;
}

/** Progress event streamed during a package install/remove/update operation. */
export interface PackageProgressMessage {
  type: "package_progress";
  operationId: string;
  event: {
    type: "start" | "progress" | "complete" | "error";
    action: "install" | "remove" | "update" | "clone" | "pull";
    source: string;
    message?: string;
  };
}

/** Progress event streamed during a pi core package update. */
export interface PiCoreUpdateProgressMessage {
  type: "pi_core_update_progress";
  name: string;
  phase: "start" | "output" | "complete" | "error";
  message?: string;
}

/** Sent when a full pi core update batch finishes. */
export interface PiCoreUpdateCompleteMessage {
  type: "pi_core_update_complete";
  results: Array<{ name: string; success: boolean; error?: string }>;
  sessionsReloaded: number;
}

/** Sent when a package operation finishes (success or failure). */
export interface PackageOperationCompleteMessage {
  type: "package_operation_complete";
  operationId: string;
  action: "install" | "remove" | "update";
  source: string;
  scope: "global" | "local";
  success: boolean;
  error?: string;
  /** Number of sessions reloaded (only on success). */
  sessionsReloaded?: number;
}

export type ServerToBrowserMessage =
  | SessionAddedMessage
  | SessionUpdatedMessage
  | SessionRemovedMessage
  | EventMessage
  | EventReplayMessage
  | BrowserCommandsListMessage
  | BrowserFlowsListMessage
  | BrowserExtensionUiRequestMessage
  | BrowserUiDismissMessage
  | BrowserFilesListMessage
  | BrowserOpenSpecUpdateMessage
  | BrowserModelsListMessage
  | SessionsListBrowserMessage
  | ResumeResultBrowserMessage
  | SpawnResultBrowserMessage
  | SpawnErrorMessage
  | SessionsReorderedMessage
  | PinnedDirsUpdatedMessage
  | TerminalAddedMessage
  | TerminalRemovedMessage
  | TerminalUpdatedMessage
  | SessionStateResetMessage
  | PackageProgressMessage
  | PackageOperationCompleteMessage
  | PiCoreUpdateProgressMessage
  | PiCoreUpdateCompleteMessage
  | EditorStatusMessage
  | ForceKillResultMessage
  | BrowserRolesListMessage
  | ProcessListUpdateMessage
  | ServersDiscoveredMessage
  | ServersUpdatedMessage
  | BrowserPromptRequestMessage
  | BrowserPromptDismissMessage
  | BrowserPromptCancelMessage
  | ModelsRefreshedMessage;

// ── Browser → Server ────────────────────────────────────────────────

export interface SubscribeMessage {
  type: "subscribe";
  sessionId: string;
  lastSeq?: number;
}

export interface UnsubscribeMessage {
  type: "unsubscribe";
  sessionId: string;
}

export interface SendPromptToBrowserMessage {
  type: "send_prompt";
  sessionId: string;
  text: string;
  images?: ImageContent[];
}

export interface AbortToBrowserMessage {
  type: "abort";
  sessionId: string;
}

export interface RequestCommandsToBrowserMessage {
  type: "request_commands";
  sessionId: string;
}

export interface FetchContentMessage {
  type: "fetch_content";
  sessionId: string;
  seq: number;
}

export interface ListFilesToBrowserMessage {
  type: "list_files";
  sessionId: string;
  query: string;
}

export interface OpenSpecRefreshBrowserMessage {
  type: "openspec_refresh";
  cwd: string;
}

export interface RenameSessionBrowserMessage {
  type: "rename_session";
  sessionId: string;
  name: string;
}

export interface RequestModelsBrowserMessage {
  type: "request_models";
  sessionId: string;
}

export interface SetThinkingLevelBrowserMessage {
  type: "set_thinking_level";
  sessionId: string;
  level: string;
}

export interface SetModelBrowserMessage {
  type: "set_model";
  sessionId: string;
  provider: string;
  modelId: string;
}

export interface ShutdownBrowserMessage {
  type: "shutdown";
  sessionId: string;
}

export interface ForceKillBrowserMessage {
  type: "force_kill";
  sessionId: string;
}

export interface ForceKillResultMessage {
  type: "force_kill_result";
  sessionId: string;
  success: boolean;
  message?: string;
}

export interface ProcessListUpdateMessage {
  type: "process_list_update";
  sessionId: string;
  processes: Array<{ pid: number; pgid: number; command: string; elapsedMs: number }>;
}

export interface ServersDiscoveredMessage {
  type: "servers_discovered";
  servers: Array<{
    host: string;
    port: number;
    piPort: number;
    version: string;
    pid: number;
    isLocal: boolean;
    source: "mdns" | "fallback";
  }>;
}

export interface ServersUpdatedMessage {
  type: "servers_updated";
  servers: Array<{
    host: string;
    port: number;
    piPort: number;
    version: string;
    pid: number;
    isLocal: boolean;
    source: "mdns" | "fallback";
  }>;
}

export interface KillProcessBrowserMessage {
  type: "kill_process";
  sessionId: string;
  pgid: number;
}

export interface ListSessionsBrowserMessage {
  type: "list_sessions";
  cwd: string;
}

export interface ResumeSessionBrowserMessage {
  type: "resume_session";
  sessionId: string;
  mode: "continue" | "fork";
  /** When forking, optionally fork from a specific session entry instead of the latest */
  entryId?: string;
}

export interface HideSessionBrowserMessage {
  type: "hide_session";
  sessionId: string;
}

export interface UnhideSessionBrowserMessage {
  type: "unhide_session";
  sessionId: string;
}

export interface SpawnSessionBrowserMessage {
  type: "spawn_session";
  cwd: string;
}

export interface AttachProposalBrowserMessage {
  type: "attach_proposal";
  sessionId: string;
  changeName: string;
}

export interface DetachProposalBrowserMessage {
  type: "detach_proposal";
  sessionId: string;
}

export interface ReorderSessionsBrowserMessage {
  type: "reorder_sessions";
  cwd: string;
  sessionIds: string[];
}

export interface PinDirectoryMessage {
  type: "pin_directory";
  path: string;
}

export interface UnpinDirectoryMessage {
  type: "unpin_directory";
  path: string;
}

export interface ReorderPinnedDirsMessage {
  type: "reorder_pinned_dirs";
  paths: string[];
}

export interface OpenSpecBulkArchiveBrowserMessage {
  type: "openspec_bulk_archive";
  cwd: string;
}

export interface CreateTerminalBrowserMessage {
  type: "create_terminal";
  cwd: string;
}

export interface KillTerminalBrowserMessage {
  type: "kill_terminal";
  terminalId: string;
}

export interface RenameTerminalBrowserMessage {
  type: "rename_terminal";
  terminalId: string;
  title: string;
}

export interface BrowserExtensionUiResponseMessage {
  type: "extension_ui_response";
  sessionId: string;
  requestId: string;
  result?: unknown;
  cancelled?: boolean;
}

export interface FlowControlBrowserMessage {
  type: "flow_control";
  sessionId: string;
  action: "abort" | "toggle_autonomous" | "dismiss_summary";
}

export interface RequestInstalledPackagesBrowserMessage {
  type: "request_installed_packages";
  scope: "global" | "local";
  cwd?: string;
}

export interface FlowManagementBrowserMessage {
  type: "flow_management";
  sessionId: string;
  action: "run" | "new" | "edit" | "delete";
  flowName?: string;
  task?: string;
  description?: string;
}

export interface ArchitectPromptResponseBrowserMessage {
  type: "architect_prompt_response";
  sessionId: string;
  promptId: string;
  answer?: string;
  cancelled?: boolean;
}

export interface PromptResponseBrowserMessage {
  type: "prompt_response";
  sessionId: string;
  promptId: string;
  answer?: string;
  cancelled?: boolean;
  source: string;
}

export interface RoleSetBrowserMessage {
  type: "role_set";
  sessionId: string;
  role: string;
  modelId: string;
}

export interface RolePresetLoadBrowserMessage {
  type: "role_preset_load";
  sessionId: string;
  presetName: string;
}

export interface RolePresetSaveBrowserMessage {
  type: "role_preset_save";
  sessionId: string;
  presetName: string;
}

export interface RolePresetDeleteBrowserMessage {
  type: "role_preset_delete";
  sessionId: string;
  presetName: string;
}

export interface RequestRolesBrowserMessage {
  type: "request_roles";
  sessionId: string;
}

export type BrowserToServerMessage =
  | SubscribeMessage
  | UnsubscribeMessage
  | BrowserExtensionUiResponseMessage
  | SendPromptToBrowserMessage
  | AbortToBrowserMessage
  | RequestCommandsToBrowserMessage
  | FetchContentMessage
  | ListFilesToBrowserMessage
  | OpenSpecRefreshBrowserMessage
  | RenameSessionBrowserMessage
  | RequestModelsBrowserMessage
  | SetThinkingLevelBrowserMessage
  | SetModelBrowserMessage
  | ShutdownBrowserMessage
  | ListSessionsBrowserMessage
  | ResumeSessionBrowserMessage
  | HideSessionBrowserMessage
  | UnhideSessionBrowserMessage
  | SpawnSessionBrowserMessage
  | AttachProposalBrowserMessage
  | DetachProposalBrowserMessage
  | ReorderSessionsBrowserMessage
  | PinDirectoryMessage
  | UnpinDirectoryMessage
  | ReorderPinnedDirsMessage
  | OpenSpecBulkArchiveBrowserMessage
  | CreateTerminalBrowserMessage
  | KillTerminalBrowserMessage
  | RenameTerminalBrowserMessage
  | FlowControlBrowserMessage
  | ForceKillBrowserMessage
  | FlowManagementBrowserMessage
  | ArchitectPromptResponseBrowserMessage
  | PromptResponseBrowserMessage
  | RoleSetBrowserMessage
  | RolePresetLoadBrowserMessage
  | RolePresetSaveBrowserMessage
  | RolePresetDeleteBrowserMessage
  | RequestRolesBrowserMessage
  | KillProcessBrowserMessage;
