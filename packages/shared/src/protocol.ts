/**
 * Extension ↔ Server WebSocket protocol messages.
 */
import type { DashboardEvent, CommandInfo, FlowInfo, SessionSource, ImageContent, FileEntry, TurnUsage, ContextUsage, ModelInfo, ProviderInfo, PiSessionInfo, OpenSpecPhase, RoleInfo, ExtensionUiModule, DecoratorDescriptor } from "./types.js";

/**
 * Bridge -> server: mirror of pi's native steering + follow-up queues, forwarded
 * from pi's `queue_update` event. Server caches the latest snapshot per session
 * in `SessionUiState.pendingQueues` and broadcasts via `session_updated`.
 * See change: add-followup-edit-and-steer-cancel.
 */
export interface QueueUpdateToServerMessage {
  type: "queue_update";
  sessionId: string;
  steering: string[];
  followUp: string[];
}

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
   * Server-minted spawn correlation token. Bridge populates this from
   * `process.env.PI_DASHBOARD_SPAWN_TOKEN` IFF this is the first register
   * for the bridge process (`bc.hasRegisteredOnce === false`). Subsequent
   * registers (reattach, in-process new/fork/resume) omit it.
   *
   * SINGLE-USE: the token is scrubbed from `process.env` after its first
   * read at BOTH boundaries — the rpc keeper (`keeper.cjs` injects it into
   * the first pi launch only, deletes it on respawn) and the bridge (deletes
   * `PI_DASHBOARD_SPAWN_TOKEN` after the first register). Descendants
   * (subagents, nested `pi`, reload) therefore never inherit or re-report it.
   * See changes: spawn-correlation-token, fix-spawn-token-env-leak.
   */
  spawnToken?: string;
  /**
   * Strong, restart-survival flag: true when the bridge process was
   * dashboard-spawned. Derived from a capture-once boolean (captured from
   * `PI_DASHBOARD_SPAWN_TOKEN` at bridge startup BEFORE the single-use token
   * is scrubbed), NOT a live env read — so it stays correct after the token
   * is removed. Unlike `spawnToken`,
   * this is sent on EVERY register (initial + every reattach), so the
   * server can re-stamp `source: "dashboard"` after its in-memory
   * `pendingDashboardSpawns` counter and `headlessPidRegistry` have
   * been wiped by a restart. Optional for forward-compat with older
   * bridges; absence is interpreted as "unknown" and the server falls
   * back to its legacy FIFO heuristic.
   * See changes: fix-dashboard-source-mislabelling, fix-spawn-token-env-leak.
   */
  dashboardSpawned?: boolean;
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
  /**
   * Whether a TUI is attached to the pi process. `true` for interactive
   * TUI sessions, `false` for headless/print-mode (`pi -p`). The bridge
   * populates it from its cached UI state. Fact-forwarding only — the
   * server decides what to do with it (auto-hide heuristic). Optional and
   * back-compatible: when absent (legacy bridge), the server SHALL NOT
   * apply the auto-hide heuristic.
   * See change: auto-hide-headless-worker-sessions.
   */
  hasUI?: boolean;
  /**
   * Explicit visibility override derived from the bridge's environment
   * (`PI_DASHBOARD_VISIBLE` ⇒ `"visible"`, `PI_DASHBOARD_HIDDEN` ⇒
   * `"hidden"`; visible wins if both set). When present, it overrides the
   * server's auto-hide heuristic at first register. Optional/back-compatible.
   * See change: auto-hide-headless-worker-sessions.
   */
  visibilityIntent?: "hidden" | "visible";
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
  /**
   * Set when the session's cwd is a git worktree. `null` clears any
   * previously-stored worktree state on the server (e.g. cwd switched
   * to a non-worktree). Absent on older bridges — server treats as
   * "no change". See change: add-worktree-spawn-dialog.
   */
  gitWorktree?: import("./types.js").GitWorktreeInfo | null;
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

/**
 * Bridge -> server: pi's live provider catalogue derived from
 * `modelRegistry.authStorage` + `modelRegistry.getProviderDisplayName`.
 * Sent alongside ModelsListMessage. See change: replace-hardcoded-provider-lists.
 */
export interface ProvidersListMessage {
  type: "providers_list";
  sessionId: string;
  providers: ProviderInfo[];
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

/**
 * Interactive `ask_user` methods carried by `prompt.type`. The wire field
 * stays `string` (adapters/plugins emit custom types) but this union is the
 * authoritative set the built-in renderers handle. `"batch"` dispatches all
 * sub-questions as ONE request answered together.
 * See change: redesign-ask-user-question-cards.
 */
export type InteractiveMethod =
  | "confirm"
  | "select"
  | "multiselect"
  | "input"
  | "editor"
  | "batch";

/** One sub-question inside a `batch` prompt (no nesting — cannot be `batch`). */
export interface BatchQuestion {
  method: "confirm" | "select" | "multiselect" | "input";
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
}

/**
 * One answer in a `batch` response, index-aligned with `BatchQuestion[]`.
 * `confirm` → `{confirmed}`, `select`/`input` → `{value}`,
 * `multiselect` → `{values}`.
 *
 * The `input` variant MAY carry pasted `images` (multiline-paste). They
 * ride inside the JSON-encoded `{answers}` payload; the bridge persists
 * them and rewrites the answer to `{value, attachments}` before the tool
 * sees it. See change: add-ask-user-input-multiline-paste.
 */
export type BatchAnswer =
  | { confirmed: boolean }
  | { value: string; images?: ImageContent[] }
  | { values: string[] };

/** Result payload returned by a resolved `batch` prompt. */
export interface BatchResult {
  answers: BatchAnswer[];
}

export interface PromptRequestMessage {
  type: "prompt_request";
  sessionId: string;
  promptId: string;
  prompt: {
    question: string;
    /** Interactive method. See {@link InteractiveMethod}. */
    type: string;
    options?: string[];
    defaultValue?: string;
    pipeline?: string;
    /** For `type: "batch"`, carries `questions: BatchQuestion[]`. */
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
  // Optional server-supplied classification. The bridge is not required to
  // populate these; the server enriches each entry before forwarding.
  // See change: classify-process-list-entries.
  kind?: ProcessKind;
  label?: string;
  sessionRef?: string;
}

/**
 * Classification of a scanned background process.
 *  - `task`        generic user background task (label = command)
 *  - `sub-session` nested `pi` whose pid matches a connected session
 *  - `pi-worker`   headless `pi` not in the session registry
 *  - `plugin`      pi-agent plugin/MCP sidecar (label = plugin name)
 * See change: classify-process-list-entries.
 */
export type ProcessKind = "task" | "sub-session" | "pi-worker" | "plugin";

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

/**
 * Bridge → server: the bridge's 30 s VCS tick discovered
 * `existsSync(ctx.cwd) === false` for the first time on a session whose
 * cwd previously existed. Server responds by stamping `cwdMissing: true`
 * on the matching `DashboardSession` and broadcasting `session_updated`.
 * Idempotent on the server side — re-emitting is harmless.
 * See change: add-worktree-lifecycle-actions.
 */
export interface CwdMissingMessage {
  type: "cwd_missing";
  sessionId: string;
}

// ── RPC keeper: bridge → server slash dispatch ──
// See change: add-rpc-stdin-dispatch-with-keeper-sidecar.
//
// Emitted by `slash-dispatch.ts::tryDispatchExtensionCommand` when the
// active pi build does NOT expose `pi.dispatchCommand` AND the bridge
// detects a headless RPC pi (per `isHeadlessRpcSession()`). The server's
// dispatch-router writes `{type:"prompt", message: command, id: requestId}`
// to the session's keeper UDS / named pipe and emits the optimistic
// `command_feedback {status:"completed"}` (or error) to browser subscribers.
export interface DispatchExtensionCommandMessage {
  type: "dispatch_extension_command";
  sessionId: string;
  command: string;
  /** UUID minted by the bridge so pi's RPC response can be correlated. */
  requestId: string;
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

// ── Markdown asset inlining (chat-markdown-local-images-and-math) ──
//
// Bridge → server: register a base64-encoded image asset under a content
// hash. Emitted by the bridge BEFORE the `message_update` / `message_end`
// event whose text references `pi-asset:<hash>`. Bytes ride exactly once
// per (session, hash) pair — subsequent references in later events emit
// no further `asset_register`. Persisted in `events.jsonl` alongside the
// referencing message events so reconnect/replay rebuilds the per-session
// asset registry deterministically. See change:
// chat-markdown-local-images-and-math.
export interface AssetRegisterMessage {
  type: "asset_register";
  sessionId: string;
  /** Content hash (sha256 truncated to 16 hex chars). */
  hash: string;
  /** MIME type (one of the bridge's image allowlist). */
  mimeType: string;
  /** Base64-encoded file bytes. */
  data: string;
}

/**
 * Generic plugin-originated message forwarded from a plugin bridge entry to
 * its plugin server entry. The bridge emits `pi.events.emit("dashboard:plugin-message",
 * { pluginId, messageType, payload })`; the main bridge wraps it in this
 * envelope and the server dispatches it to handlers registered via
 * `ServerPluginContext.registerPiHandler(messageType, handler)`.
 *
 * Keeps plugin-specific payloads out of the typed core protocol: the
 * envelope is generic, `payload` is opaque. See change: add-goal-continuation-plugin.
 */
export interface PluginPiMessage {
  type: "plugin_pi_message";
  sessionId: string;
  /** Manifest id of the originating plugin (e.g. "goal"). */
  pluginId: string;
  /** Handler key the plugin server registered via registerPiHandler. */
  messageType: string;
  /** Opaque plugin-defined payload. */
  payload: unknown;
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
  | ProvidersListMessage
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
  | ExtUiDecoratorMessage
  | AssetRegisterMessage
  | DispatchExtensionCommandMessage
  | CwdMissingMessage
  | PluginPiMessage
  | QueueUpdateToServerMessage;

// ── Server → Extension ──────────────────────────────────────────────

export interface SendPromptToExtensionMessage {
  type: "send_prompt";
  sessionId: string;
  text: string;
  images?: ImageContent[];
  /** Delivery mode: "steer" (after current turn) or "followUp" (after agent finishes). Defaults to "followUp" when absent. See change: add-steering-message. */
  delivery?: "steer" | "followUp";
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

/**
 * Server -> bridge: ask the bridge to push a fresh providers_list.
 * See change: replace-hardcoded-provider-lists.
 */
export interface RequestProvidersMessage {
  type: "request_providers";
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

// ── Follow-up queue mutation forwarded server → bridge ────────────────────
//
// Pi's ExtensionAPI exposes no queue-mutation primitives. The bridge owns
// `bridgeFollowUp: string[]` and handles these messages locally. None of
// them call pi.* methods. See change: rework-mid-turn-prompt-queue.
//
// The old pi-mutation types from Phase 3 (clear_steering_queue,
// clear_followup_slot, edit_followup_slot) STAY DELETED. The names
// edit/remove/promote_followup_entry are REUSED with new
// bridge-buffer-only semantics.

export interface ClearFollowupEntriesToExtensionMessage {
  type: "clear_followup_entries";
  sessionId: string;
  indices: number[] | "all";
}

export interface EditFollowupEntryToExtensionMessage {
  type: "edit_followup_entry";
  sessionId: string;
  index: number;
  text: string;
  images?: ImageContent[];
}

export interface RemoveFollowupEntryToExtensionMessage {
  type: "remove_followup_entry";
  sessionId: string;
  index: number;
}

export interface PromoteFollowupEntryToExtensionMessage {
  type: "promote_followup_entry";
  sessionId: string;
  index: number;
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
  | RequestProvidersMessage
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
  | ServerRestartingExtensionMessage
  | ClearFollowupEntriesToExtensionMessage
  | EditFollowupEntryToExtensionMessage
  | RemoveFollowupEntryToExtensionMessage
  | PromoteFollowupEntryToExtensionMessage;
