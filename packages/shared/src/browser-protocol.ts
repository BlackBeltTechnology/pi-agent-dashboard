/**
 * Server ↔ Browser WebSocket protocol messages.
 */
import type {
  PluginActionMessage,
  PluginEventBroadcast,
  PluginIntentsMessage,
} from "./dashboard-plugin/intent-types.js";
import type { DisplayPrefs, PartialDisplayPrefs } from "./display-prefs.js";
import type { EditorInstanceStatus } from "./editor-types.js";
import type { TerminalSession } from "./terminal-types.js";
import type {
  CommandInfo,
  DashboardEvent,
  DashboardSession,
  DecoratorDescriptor,
  ExtensionUiModule,
  FileEntry,
  FlowInfo,
  GoalRecord,
  ImageContent,
  ModelInfo,
  OpenSpecData,
  OpenSpecGroup,
  PiSessionInfo,
  ViewTarget,
} from "./types.js";

// Batch ask_user contracts live in protocol.ts; re-export so browser-side
// consumers import from one place. See change: redesign-ask-user-question-cards.
export type {
  BatchAnswer,
  BatchQuestion,
  BatchResult,
  InteractiveMethod,
} from "./protocol.js";

// ── Configurable chat display ───────────────────────────────────────
// See change: configurable-chat-display.

/**
 * Server → browser: broadcast on every successful PATCH of global
 * display preferences. Browsers update their store and re-render.
 */
export interface DisplayPrefsUpdatedMessage {
  type: "display_prefs_updated";
  prefs: DisplayPrefs;
}

/**
 * Browser → server: write the sparse per-session override.
 * `override: null` clears the field from `.meta.json`.
 */
export interface SetSessionDisplayPrefsBrowserMessage {
  type: "setSessionDisplayPrefs";
  sessionId: string;
  override: PartialDisplayPrefs | null;
}

/**
 * Browser → server: persist the per-session collapse state of the
 * PROCESS subcard's background-processes drawer.
 * See change: persist-process-drawer-collapse.
 */
export interface SetSessionProcessDrawerBrowserMessage {
  type: "set_session_process_drawer";
  sessionId: string;
  collapsed: boolean;
}

/**
 * Browser → server: replace a session's full user-owned tag list. The server
 * normalizes the list (`normalizeTags`) before persist. Whole-array replace
 * (last-write-wins). See change: add-session-tags.
 */
export interface SetSessionTagsBrowserMessage {
  type: "set_session_tags";
  sessionId: string;
  tags: string[];
}

// ── Server → Browser ────────────────────────────────────────────────

export interface SessionAddedMessage {
  type: "session_added";
  session: DashboardSession;
  /**
   * Echoed `requestId` from the originating browser `spawn_session` /
   * `resume_session` (when known). Lets the client auto-select / dismiss
   * placeholder by exact correlation, replacing the cwd-FIFO heuristic.
   * Absent for server-initiated spawns (auto-resume, headless reload).
   * See change: spawn-correlation-token.
   */
  spawnRequestId?: string;
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

/**
 * Folder-HEAD branch update. Broadcast by the server folder-head poll /
 * watcher when a folder group key's git HEAD is first observed or changes.
 * `branch` is the branch name, the short SHA for detached HEAD, or `null`
 * when the folder is not a git repository. `cwd` is the resolved folder
 * group key (matches the client's `group.cwd`).
 * See change: refresh-folder-header-branch.
 */
export interface BrowserGitHeadUpdateMessage {
  type: "git_head_update";
  cwd: string;
  branch: string | null;
}

/**
 * Per-repo OpenSpec change-grouping update. Broadcast after every successful
 * write to `<cwd>/openspec/groups/groups.json`, debounced 100 ms per cwd.
 * Full payload (no incremental delta) so client logic stays simple.
 * See change: add-openspec-change-grouping.
 */
export interface BrowserOpenSpecGroupsUpdateMessage {
  type: "openspec_groups_update";
  cwd: string;
  groups: OpenSpecGroup[];
  assignments: Record<string, string>;
  /**
   * Persisted per-group manual change ordering (`groupId` → ordered
   * `changeName[]`, with `__ungrouped__` for the implicit column). Absent on
   * older servers; clients fall back to the default sort.
   * See change: redesign-openspec-board.
   */
  changeOrder?: Record<string, string[]>;
}

/**
 * Folder-scoped goals update. Broadcast after every successful mutation of
 * the per-folder goals file (`~/.pi/dashboard/goals/<folderHash>.json`),
 * debounced 100 ms per cwd. Full payload (no incremental delta).
 * See change: add-goals-folder-page.
 */
export interface BrowserGoalsUpdateMessage {
  type: "goals_update";
  cwd: string;
  goals: GoalRecord[];
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
  /**
   * Built-in (seeded default) role names, equal to `DEFAULT_ROLE_NAMES`.
   * Forwarded verbatim from the bridge's `roles_list`. The Roles panel reads
   * it to split roles into Built-in vs Custom and to show "＋ Add custom role".
   * Additive/optional; older clients ignore it.
   * See change: fix-builtin-role-names-relay.
   */
  builtinRoleNames?: string[];
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
  /** Echoed from input `resume_session.requestId` when provided. */
  requestId?: string;
  /**
   * For `mode: "fork"` only — populated once the new fork's bridge has
   * registered and been correlated. Absent for `mode: "continue"` (the
   * sessionId is unchanged across the respawn).
   * See change: spawn-correlation-token.
   */
  newSessionId?: string;
  /**
   * Optional structured failure classifier. Known values:
   *   - `"FORK_EMPTY_SESSION"`: fork attempted on a session whose
   *     `sessionFile` does not exist on disk yet (e.g., freshly spawned,
   *     no messages persisted).
   * Old clients that don't read this field still get the human-readable
   * `message`. See change: fix-fork-empty-session-silent-timeout.
   */
  code?: string;
  /**
   * Interpolation variables for the client-side translation of `code`
   * (`err.<domain>.<code>`). Additive; ignored by old clients.
   * See change: make-all-ui-text-i18n.
   */
  vars?: Record<string, string | number>;
}

export interface SpawnResultBrowserMessage {
  type: "spawn_result";
  cwd: string;
  success: boolean;
  message: string;
  /** Echoed from input `spawn_session.requestId` when provided. */
  requestId?: string;
  /** Spawned process PID when known (headless strategies); informational. */
  pid?: number;
  /** Stable failure classifier for client translation. Additive. See change: make-all-ui-text-i18n. */
  code?: string;
  /** Interpolation vars for `err.<domain>.<code>`. Additive. */
  vars?: Record<string, string | number>;
}

/**
 * Failure classification codes for spawn errors.
 * Set on every `{ success: false }` path inside process-manager and the
 * session-action-handler. Additive — clients that do not know a code fall
 * back to the `message` string.
 * See change: spawn-failure-diagnostics.
 */
export type SpawnFailureCode =
  | "DIR_MISSING"
  | "PI_NOT_FOUND"
  | "WIN_PI_CMD_ONLY"
  | "WT_MISSING"
  | "TMUX_MISSING"
  | "PI_CRASHED"
  | "SPAWN_ERRNO"
  | "PREFLIGHT_FAILED"
  | "REGISTER_TIMEOUT";

/**
 * A single reason from the synchronous spawn preflight check.
 * See change: spawn-failure-diagnostics.
 */
export interface PreflightReason {
  code: string;
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
  /** Structured failure classifier. Additive — old clients ignore this field. See change: spawn-failure-diagnostics. */
  code?: SpawnFailureCode;
  /** Preflight failure reasons. Only set when code === "PREFLIGHT_FAILED". See change: spawn-failure-diagnostics. */
  reasons?: PreflightReason[];
  /** Interpolation vars for `err.<domain>.<code>`. Additive. See change: make-all-ui-text-i18n. */
  vars?: Record<string, string | number>;
}

/**
 * Emitted when a spawned pi session never sends `session_register` within
 * the configured `spawnRegisterTimeoutMs` window.
 * See change: spawn-failure-diagnostics.
 */
export interface SpawnRegisterTimeoutMessage {
  type: "spawn_register_timeout";
  cwd: string;
  /** Present for headless spawns; absent for tmux/wt/wsl-tmux. */
  pid?: number;
  /** Last 4 KB of the per-session stderr log, if available. */
  stderrTail?: string;
  /** The effective watchdog timeout in ms — so the UI can render e.g. "30s". See change: spawn-failure-diagnostics (fix W2). */
  timeoutMs?: number;
}

/**
 * Emitted when pi finally registers AFTER the watchdog already fired.
 * The UI uses it to auto-clear the timeout banner for the given cwd.
 * See change: spawn-failure-diagnostics.
 */
export interface SpawnRegisterRecoveredMessage {
  type: "spawn_register_recovered";
  cwd: string;
  pid?: number;
}

export interface SessionsReorderedMessage {
  type: "sessions_reordered";
  cwd: string;
  sessionIds: string[];
}

/**
 * Atomic on-connect snapshot of the server's full session registry and
 * per-cwd ordering. Replaces the legacy per-session `session_added` loop
 * + per-cwd `sessions_reordered` loop that the gateway used to emit on
 * each browser WS connect. Client SHALL replace its `sessions` Map and
 * `sessionOrderMap` with this payload (no merging) so stale ids from a
 * previous server lifetime are dropped atomically.
 *
 * Live updates after the snapshot continue using the incremental
 * `session_added` / `session_updated` / `session_removed` /
 * `sessions_reordered` messages.
 *
 * See change: fix-stale-sessions-on-reconnect.
 */
export interface SessionsSnapshotMessage {
  type: "sessions_snapshot";
  /** Every session known to the server at construction time, alive AND ended. */
  sessions: DashboardSession[];
  /** cwd → ordered session ids. Only non-empty arrays are included. */
  orders: Record<string, string[]>;
}

export interface PinnedDirsUpdatedMessage {
  type: "pinned_dirs_updated";
  paths: string[];
}

/**
 * Server → browser broadcast of the full favorite-model label list after any
 * favorite/unfavorite mutation. Labels are `"provider/id"` strings. Mirrors
 * `pinned_dirs_updated`. See change: enrich-model-selector-capabilities-favorites.
 */
export interface FavoriteModelsUpdatedMessage {
  type: "favorite_models_updated";
  labels: string[];
}

// ── Workspaces (folder-workspaces) ───────────────────────────────────

/**
 * Named, server-persisted, collapsible container grouping one or more
 * folders. Membership is authoritative and orthogonal to pinning — a
 * folder may be in `folders[]` and `pinnedDirectories` independently.
 * Single-membership: a folder belongs to ≤1 workspace.
 * See change: folder-workspaces.
 */
export interface Workspace {
  id: string;
  name: string;
  collapsed: boolean;
  folders: string[];
}

/** Server → browser: full workspace list snapshot (sent on subscribe + every mutation). */
export interface WorkspacesUpdatedMessage {
  type: "workspaces_updated";
  workspaces: Workspace[];
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
    /** Interactive method, incl. "batch". See InteractiveMethod in protocol.ts. */
    type: string;
    options?: string[];
    defaultValue?: string;
    pipeline?: string;
    /** For type: "batch", carries questions: BatchQuestion[]. */
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

/** Progress event streamed during a package install/remove/update/move operation.
 *
 * `moveId` is set when this progress event is part of a move operation
 * (which composes install + remove). Clients group events by `moveId`
 * to display a single composite progress affordance instead of two
 * separate operations. Consumers that ignore the field continue to
 * render install + remove independently — graceful degradation.
 *
 * See change: unify-package-management-ui.
 */
export interface PackageProgressMessage {
  type: "package_progress";
  operationId: string;
  /** Optional move grouping id when emitted as part of a move. */
  moveId?: string;
  event: {
    type: "start" | "progress" | "complete" | "error";
    action: "install" | "remove" | "update" | "clone" | "pull" | "move";
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

/**
 * Bootstrap state snapshot. Mirrors `BootstrapState` in
 * `packages/server/src/bootstrap-state.ts` but kept as a structural
 * subset here so the shared package doesn't take a runtime dependency
 * on the server package.
 *
 * See change: unified-bootstrap-install.
 */
export interface BootstrapStateSnapshot {
  status: "ready" | "installing" | "failed";
  progress?: { step: string; pct?: number; output?: string };
  error?: { message: string; stack?: string };
  version?: { pi?: string; openspec?: string; tsx?: string };
  compatibility?: {
    minimum: string;
    recommended: string;
    maximum: string | null;
    current?: string;
    upgradeRecommended?: boolean;
    upgradeDashboard?: boolean;
  };
  bridgeRegistrationError?: string;
  /**
   * Legacy `@mariozechner/pi-coding-agent` installs detected on disk.
   * Surfaced by the client as a one-click cleanup banner. Empty array
   * means no legacy installs found. Pi was renamed to
   * `@earendil-works/pi-coding-agent` at v0.74 — the legacy scope can
   * collide with the new scope's `bin/pi` symlink.
   */
  legacyPiInstalls?: Array<{
    scope: "npm-global" | "npx-cache" | "managed";
    path: string;
    version: string | null;
  }>;
}

/**
 * Broadcast on every bootstrap-state transition. Browsers use this to
 * render the first-run install banner, the upgrade-pi progress display,
 * and version-skew hints.
 */
export interface BootstrapStatusUpdateMessage {
  type: "bootstrap_status_update";
  state: BootstrapStateSnapshot;
}

/**
 * Broadcast when a queued pi-dependent operation (e.g. a session-spawn
 * request accepted with 202 during "installing") finishes running after
 * the bootstrap transitioned to "ready". Clients that stored a ticketId
 * from the 202 response can correlate the outcome via this message.
 *
 * `success` is true when the queued handler resolved without throwing;
 * `error` carries the thrown message string when `success` is false.
 *
 * See change: unified-bootstrap-install.
 */
/**
 * Streamed during the +Worktree dialog's post-create dependency install
 * step. Only sent to the browser that initiated the worktree-create or
 * existing-row install, identified by `requestId`. Throttled to <= 4/sec
 * per requestId, each event carrying the most recent <= 4 KB tail of
 * combined stdout/stderr.
 *
 * Distinct from BootstrapStatusUpdateMessage / BootstrapTicketCompleteMessage
 * which describe the dashboard's own pi-core install. See change:
 * generalize-worktree-init-hook (renamed from worktree_bootstrap_*).
 */
/**
 * Trust scope chosen at confirm time for `POST /api/git/worktree/init`.
 * `session` = ephemeral (server memory, gone on restart); `project` = persisted
 * (today's behavior). Omitted → `project` (backward compatible). Any other value
 * is rejected `bad_request` by the server — no upward coercion.
 * See change: add-session-scoped-init-trust.
 */
export type WorktreeInitTrustScope = "session" | "project";

export interface WorktreeInitProgressMessage {
  type: "worktree_init_progress";
  requestId: string;
  cwd: string;
  /** Most recent <= 4 KB of combined stdout/stderr. */
  line: string;
}

/** Emitted exactly once when the worktree-init hook completes successfully. */
export interface WorktreeInitDoneMessage {
  type: "worktree_init_done";
  requestId: string;
  cwd: string;
  durationMs: number;
}

/** Emitted exactly once when the init hook fails or fails to spawn. */
export interface WorktreeInitFailedMessage {
  type: "worktree_init_failed";
  requestId: string;
  cwd: string;
  /** Stable classifier: `script_nonzero_exit` | `spawn_error` | `agent_failed` | `agent_incomplete`. */
  code: string;
  /** Short human hint when we recognized the failure family. */
  message: string;
  /** Last <= 4 KB of combined output. */
  stderr: string;
}

export interface BootstrapTicketCompleteMessage {
  type: "bootstrap_ticket_complete";
  ticketId: string;
  success: boolean;
  error?: string;
}

/** Sent when a package operation finishes (success or failure). */
export interface PackageOperationCompleteMessage {
  type: "package_operation_complete";
  operationId: string;
  /** Optional composite grouping id; set on every event of a composite move/reset op. */
  moveId?: string;
  action: "install" | "remove" | "update" | "move" | "reset";
  source: string;
  scope: "global" | "local";
  success: boolean;
  error?: string;
  /** Number of sessions reloaded (only on success). */
  sessionsReloaded?: number;
  /** Set on a composite move OR reset op when install succeeded but remove
   * failed. Move: the package now exists in BOTH scopes. Reset: the published
   * spec installed but the local/git entry is still registered. Either way the
   * UI should surface a recovery action (POST /api/packages/remove of the
   * still-present entry). */
  partialSuccess?: {
    installed: boolean;
    removed: boolean;
    removeError?: string;
  };
}

// ── Extension UI System (Phase 1: management-modal slot) ───────────
// See change: add-extension-ui-modal.

/** Server → browser: cached extension-declared UI modules for a session. */
export interface BrowserUiModulesListMessage {
  type: "ui_modules_list";
  sessionId: string;
  modules: ExtensionUiModule[];
}

/** Server → browser: row data for a `view.dataEvent`. */
export interface BrowserUiDataListMessage {
  type: "ui_data_list";
  sessionId: string;
  event: string;
  items: unknown[];
}

// ── Extension UI System (Phase 2: live in-page decorations) ──
// See change: add-extension-ui-decorations.

/**
 * Server → browser: a live decorator descriptor (forwarded verbatim from the
 * extension). `removed: true` instructs the client to unmount the matching
 * descriptor.
 */
export interface BrowserExtUiDecoratorMessage {
  type: "ext_ui_decorator";
  sessionId: string;
  descriptor: DecoratorDescriptor;
  removed?: boolean;
}

/**
 * Server → browser: register a base64-encoded image asset under a content
 * hash for the given session. Forwarded verbatim from the bridge's
 * `asset_register` message and replayed to reconnecting browsers (in
 * chronological position relative to its referencing `message_update` /
 * `message_end`). The client populates a per-session `Map<hash,{data,mime}>`
 * consumed by the `MarkdownContent` `pi-asset:` resolver.
 * See change: chat-markdown-local-images-and-math.
 */
export interface BrowserAssetRegisterMessage {
  type: "asset_register";
  sessionId: string;
  hash: string;
  mimeType: string;
  data: string;
}

/** Sent when a plugin's config changes; carries only that plugin's namespace. */
export interface PluginConfigUpdateMessage {
  type: "plugin_config_update";
  /** Plugin id that was updated. */
  id: string;
  /**
   * Only this plugin's namespace config (plugins.<id>.*).
   * Never contains other plugins' configs.
   */
  config: unknown;
}

/**
 * Server → browser: broadcast just before the server restarts/shuts down so a
 * browser-side `useAsyncAction(confirm: "ws")` can correlate its restart click.
 * Mirrors the bridge-facing `ServerRestartingExtensionMessage` (protocol.ts).
 * `requestId` echoes the optional client correlation id from `POST /api/restart`;
 * additive + optional so clients/bridges that omit it are unaffected.
 * See change: add-async-action-feedback.
 */
export interface ServerRestartingMessage {
  type: "server_restarting";
  reason: "restart" | "shutdown";
  quiesceMs: number;
  requestId?: string;
}

/**
 * Server → browser: cold-start recovery offer. Broadcast once, to all
 * connected clients, when ≥1 session was interrupted by an unclean host
 * shutdown and the `reopenSessionsAfterShutdown` setting is `"ask"`. The
 * client renders this as a sticky notification in the top-right toast stack
 * (no auto-timeout); accepting routes each candidate through `resume_session`.
 * See change: reopen-sessions-after-shutdown.
 */
export interface RecoveryCandidate {
  sessionId: string;
  name?: string;
  cwd?: string;
  model?: string;
  /** Server boot id under which the session was last seen running. */
  liveEpoch?: number;
}
export interface RecoveryOfferMessage {
  type: "recovery_offer";
  candidates: RecoveryCandidate[];
}

/**
 * Browser → server: durable dismissal of a cold-start recovery offer. Sent
 * when the user clicks the offer's dismiss (×) action. The server consumes
 * the on-disk liveness marker (`setLiveness(file, {live:false})`) for each
 * listed session so it is never re-classified as a recovery candidate, and
 * clears its held pending offer so `onConnect` replay stops. Mirrors Chrome
 * consuming its crash sentinel on dismiss.
 * See change: fix-recovery-offer-dismiss-and-phantom-reopen.
 */
export interface RecoveryDismissMessage {
  type: "recovery_dismiss";
  sessionIds: string[];
}

/**
 * Server → browser: automatic session naming failed for `sessionId`. Forwarded
 * from the bridge's `auto_name_error`; the client renders a one-shot toast
 * ("Couldn't auto-name session: <reason>"). See change: add-auto-session-naming.
 */
export interface AutoNameErrorBrowserMessage {
  type: "auto_name_error";
  sessionId: string;
  reason: string;
}

export type ServerToBrowserMessage =
  | ServerRestartingMessage
  | AutoNameErrorBrowserMessage
  | RecoveryOfferMessage
  | PluginConfigUpdateMessage
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
  | BrowserGitHeadUpdateMessage
  | BrowserOpenSpecGroupsUpdateMessage
  | BrowserGoalsUpdateMessage
  | BrowserModelsListMessage
  | SessionsListBrowserMessage
  | ResumeResultBrowserMessage
  | SpawnResultBrowserMessage
  | SpawnErrorMessage
  | SpawnRegisterTimeoutMessage
  | SpawnRegisterRecoveredMessage
  | SessionsReorderedMessage
  | SessionsSnapshotMessage
  | PinnedDirsUpdatedMessage
  | FavoriteModelsUpdatedMessage
  | WorkspacesUpdatedMessage
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
  | ModelsRefreshedMessage
  | BootstrapStatusUpdateMessage
  | BootstrapTicketCompleteMessage
  | WorktreeInitProgressMessage
  | WorktreeInitDoneMessage
  | WorktreeInitFailedMessage
  | BrowserUiModulesListMessage
  | BrowserUiDataListMessage
  | BrowserExtUiDecoratorMessage
  | BrowserAssetRegisterMessage
  | PluginIntentsMessage
  | PluginEventBroadcast
  | DisplayPrefsUpdatedMessage
  | QueueUpdateToBrowserMessage
  | PromptReceivedToBrowserMessage
  | ViewMessagesUpdateMessage
  | CanvasIntentMessage
  | CanvasServerChipMessage
  | FileChangedMessage;

/**
 * Server push: drive the per-session auto-canvas surface (change: auto-canvas).
 *
 * Two phases (Decision 1 two-phase open):
 *   - `eager`  — the first qualifying candidate mid-turn; open immediately
 *                (subject to the client viewport gate — mobile surfaces a chip
 *                instead of yanking chat).
 *   - `settle` — fired at `agent_end`; the turn's winning target owns the slot.
 *
 * `target` is the normalized winning `ViewTarget` (file/url), or `null` when the
 * turn produced nothing renderable. `mode` maps to the lifecycle state
 * (`replace` transient vs `pin` kept). Servers never arrive here — they use
 * `canvas_server_chip`.
 */
export interface CanvasIntentMessage {
  type: "canvas_intent";
  sessionId: string;
  phase: "eager" | "settle";
  target: ViewTarget | null;
  mode?: "replace" | "pin";
  title?: string;
}

/**
 * Server push: surface a declared-server confirm chip (Decision 4). Carries
 * ONLY the port — NO announced host (SSRF gate: the client probes
 * `127.0.0.1:port` on tap, never a host the agent named). No pre-tap fetch.
 */
export interface CanvasServerChipMessage {
  type: "canvas_server_chip";
  sessionId: string;
  port: number;
  title?: string;
  /**
   * True = the chip expired at the turn boundary / server-exit and MUST become
   * non-actionable (S32). When set, `port` echoes the expired chip's port; the
   * client drops it. Absent/false = surface a fresh, tappable chip.
   */
  expire?: boolean;
}

/**
 * Server push: an open editor-pane file changed on disk (agent edit or
 * external change), detected by the narrow open-files watch. The pane shows a
 * per-tab "changed on disk" banner offering Refresh (no auto-reload).
 * See change: split-editor-workspace.
 */
export interface FileChangedMessage {
  type: "file_changed";
  sessionId: string;
  /** Path relative to the session cwd. */
  path: string;
}

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
  /** Delivery mode: "steer" (after current turn) or "followUp" (after agent finishes). Defaults to "followUp" when absent. See change: add-steering-message. */
  delivery?: "steer" | "followUp";
}

export interface AbortToBrowserMessage {
  type: "abort";
  sessionId: string;
}

// ── Follow-up queue mutation (bridge-owned buffer) ──────────────────
//
// Pi's ExtensionAPI (verified through 0.76.0) exposes no queue-mutation
// primitives to extensions. The bridge owns `bridgeFollowUp: string[]`
// authoritatively and never forwards dashboard-queued follow-ups to pi
// until the drain loop ships them on `agent_end`. All mutation messages
// below target the bridge buffer ONLY — never pi.
// See change: rework-mid-turn-prompt-queue (spec mid-turn-prompt-queue).
//
// NOTE: the old pi-mutation message types from the deleted Phase 3
// architecture (clear_steering_queue, clear_followup_slot,
// edit_followup_slot) STAY PERMANENTLY DELETED. The names below for
// edit/remove/promote_followup_entry are REUSED with new
// bridge-buffer-only semantics — they no longer touch pi.

export interface ClearFollowupEntriesFromBrowserMessage {
  type: "clear_followup_entries";
  sessionId: string;
  /** `"all"` empties the bridge buffer; `number[]` splices listed indices (sorted descending bridge-side to avoid index drift). */
  indices: number[] | "all";
}

/** Replaces `bridgeFollowUp[index]`. Mutates bridge buffer only — no pi call. */
export interface EditFollowupEntryFromBrowserMessage {
  type: "edit_followup_entry";
  sessionId: string;
  index: number;
  text: string;
  images?: ImageContent[];
}

/** Splices `bridgeFollowUp[index]`. Mutates bridge buffer only — no pi call. */
export interface RemoveFollowupEntryFromBrowserMessage {
  type: "remove_followup_entry";
  sessionId: string;
  index: number;
}

/** Moves `bridgeFollowUp[index]` to position 0 via splice + unshift. Silent no-op when `index <= 0`. No pi call. */
export interface PromoteFollowupEntryFromBrowserMessage {
  type: "promote_followup_entry";
  sessionId: string;
  index: number;
}

/**
 * Server -> browser: broadcast pi's queue mirror after a `queue_update`
 * arrives from the bridge. Drives `Session.pendingQueues`.
 * See change: add-followup-edit-and-steer-cancel.
 */
export interface QueueUpdateToBrowserMessage {
  type: "queue_update";
  sessionId: string;
  steering: string[];
  followUp: string[];
}

/**
 * Server -> browser: forwarded bridge ack for a `send_prompt`. `fresh:true`
 * transitions the optimistic `pendingPrompt` to `status:"sent"`; `fresh:false`
 * drops `pendingPrompt` (the send raced into a mid-turn queue entry, now owned
 * by `mid-turn-prompt-queue`). See change: optimistic-prompt-progress.
 */
export interface PromptReceivedToBrowserMessage {
  type: "prompt_received";
  sessionId: string;
  fresh: boolean;
}

/**
 * Server → browser: full snapshot of a session's `/view` preview rows.
 * Sent on subscribe (as a snapshot) and on every change (append). Each
 * entry is a minimal ChatMessage shape with `view` set; the client merges
 * them into its rendered chat by timestamp. View messages live in a
 * separate server-side store, NEVER in pi's events.jsonl — the agent does
 * not observe them. See change: render-file-previews.
 */
export interface ViewMessagesUpdateMessage {
  type: "view_messages_update";
  sessionId: string;
  viewMessages: Array<{
    id: string;
    role: "user";
    content: "";
    timestamp: number;
    view: import("./types.js").ViewTarget;
  }>;
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

/**
 * Browser asks the server to forward `request_providers` to the bridge.
 * See change: replace-hardcoded-provider-lists.
 */
export interface RequestProvidersBrowserMessage {
  type: "request_providers";
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

/**
 * Graceful stop: let the agent finish the current turn, then shut the
 * session down cleanly. Distinct from abort (mid-stream interrupt) and
 * force_kill (SIGKILL). See change: adopt-pi-071-072-073-features.
 */
export interface StopAfterTurnBrowserMessage {
  type: "stop_after_turn";
  sessionId: string;
}

export interface ForceKillResultMessage {
  type: "force_kill_result";
  sessionId: string;
  success: boolean;
  message?: string;
  /** Stable failure classifier for client translation. Additive. See change: make-all-ui-text-i18n. */
  code?: string;
  /** Interpolation vars for `err.<domain>.<code>`. Additive. */
  vars?: Record<string, string | number>;
}

export interface ProcessListUpdateMessage {
  type: "process_list_update";
  sessionId: string;
  // Server populates `kind` + `label` on every entry; `sessionRef` only for
  // `kind: "sub-session"`. Fields optional for back-compat with older
  // clients. See change: classify-process-list-entries.
  processes: Array<{ pid: number; pgid: number; command: string; elapsedMs: number; kind?: import("./protocol.js").ProcessKind; label?: string; sessionRef?: string }>;
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
  /**
   * Client-minted UUIDv4 used to correlate `resume_result` and (for fork mode)
   * the eventual `session_added` for the new session. Optional for back-compat.
   * See change: spawn-correlation-token.
   */
  requestId?: string;
  /**
   * Placement intent for the resumed session in the cwd's sessionOrder:
   *   - "front" (default): move to top of alive tier (Resume button, REST,
   *     prompt-auto-resume).
   *   - "keep": leave order alone (drag-to-resume — drop position was already
   *     persisted by an earlier `reorder_sessions` message).
   * Server defaults to "front" when omitted, preserving prior behavior.
   * See change: differentiate-resume-intent-by-trigger.
   */
  placement?: "front" | "keep";
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
  /**
   * Optional kebab-case OpenSpec change name to attach to the spawned session
   * once it registers. The server queues the intent in `pendingAttachByCwd`
   * and consumes it on the next matching `session_register`.
   * Old servers that ignore unknown fields produce a bare spawn (degraded but
   * recoverable: the user attaches manually). See change:
   * add-folder-task-checker-and-spawn-attach.
   */
  attachProposal?: string;
  /**
   * Optional base ref the worktree was created from. Set ONLY by the
   * dashboard's worktree dialog after a successful `POST /api/git/worktree`.
   * Server queues the intent in `pendingWorktreeBaseByCwd` and consumes it
   * on the next matching `session_register`, writing `gitWorktreeBase` to
   * the session's `.meta.json` sidecar so the WORKSPACE-subcard pill can
   * later render `created from <base>` as its tooltip.
   * Old servers ignore unknown fields — degraded fallback: the pill
   * shows the generic `git worktree` tooltip instead.
   * See change: add-worktree-spawn-dialog.
   */
  gitWorktreeBase?: string;
  /**
   * Optional first prompt dispatched into the spawned session once it
   * registers. The server queues it in `pendingInitialPromptByCwd` and
   * consumes it on the next matching `session_register` (mirrors
   * `attachProposal`). Used by the no-hook Initialize button to pre-inject
   * `/skill:project-init` so the interactive scaffolder starts on its own.
   * Old servers ignore unknown fields — degraded fallback: the session
   * spawns idle and the user invokes the skill manually.
   * See change: project-init-skill-and-profiles.
   */
  initialPrompt?: string;
  /**
   * Client-minted UUIDv4 used to correlate `spawn_result` and the eventual
   * `session_added` (which echoes it as `spawnRequestId`). Optional for
   * back-compat with older clients.
   * See change: spawn-correlation-token.
   */
  requestId?: string;
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

/**
 * Browser → server: commit a suggested proposal replacement. Attaches
 * `changeName` (reusing the attach + auto-rename path) and clears the
 * session's `pendingReplaceProposal`. The committed `changeName` is NOT
 * added to `rejectedReplaceProposals`.
 * See change: replace-proposal-dialog-with-race-handling.
 */
export interface AcceptReplaceProposalBrowserMessage {
  type: "accept_replace_proposal";
  sessionId: string;
  changeName: string;
}

/**
 * Browser → server: reject a suggested proposal replacement. Appends
 * `changeName` to `rejectedReplaceProposals` (deduped) and clears
 * `pendingReplaceProposal`. Esc / click-outside map to this too.
 * See change: replace-proposal-dialog-with-race-handling.
 */
export interface DismissReplaceProposalBrowserMessage {
  type: "dismiss_replace_proposal";
  sessionId: string;
  changeName: string;
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

/**
 * Browser → server: add a model to favorites. Label = `"provider/id"`.
 * See change: enrich-model-selector-capabilities-favorites.
 */
export interface FavoriteModelMessage {
  type: "favorite_model";
  label: string;
}

/** Browser → server: remove a model from favorites. */
export interface UnfavoriteModelMessage {
  type: "unfavorite_model";
  label: string;
}

export interface ReorderPinnedDirsMessage {
  type: "reorder_pinned_dirs";
  paths: string[];
}

// ── Workspace mutation messages (browser → server) ───────────────────
// See change: folder-workspaces. Verb-first to match pin_directory family.

export interface CreateWorkspaceMessage {
  type: "create_workspace";
  name: string;
}

export interface RenameWorkspaceMessage {
  type: "rename_workspace";
  id: string;
  name: string;
}

export interface DeleteWorkspaceMessage {
  type: "delete_workspace";
  id: string;
}

export interface SetWorkspaceCollapsedMessage {
  type: "set_workspace_collapsed";
  id: string;
  collapsed: boolean;
}

export interface AddFolderToWorkspaceMessage {
  type: "add_folder_to_workspace";
  id: string;
  path: string;
}

export interface RemoveFolderFromWorkspaceMessage {
  type: "remove_folder_from_workspace";
  id: string;
  path: string;
}

export interface ReorderWorkspaceFoldersMessage {
  type: "reorder_workspace_folders";
  id: string;
  paths: string[];
}

export interface ReorderWorkspacesMessage {
  type: "reorder_workspaces";
  ids: string[];
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

/** Open an inline interactive terminal card in a session's chat stream.
 *  Server spawns an ephemeral PTY in `cwd` and writes an `inline_terminal_open`
 *  event into the `sessionId` event stream. See change: add-inline-terminal-card. */
export interface OpenInlineTerminalBrowserMessage {
  type: "open_inline_terminal";
  sessionId: string;
  cwd: string;
}

/** Close a live inline terminal card. Server captures the ring-buffer transcript,
 *  kills the PTY, and writes an `inline_terminal_close` event into the `sessionId`
 *  event stream. See change: add-inline-terminal-card. */
export interface CloseInlineTerminalBrowserMessage {
  type: "close_inline_terminal";
  sessionId: string;
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
  action: "run" | "new" | "edit" | "delete" | "set-edit-mode";
  flowName?: string;
  task?: string;
  description?: string;
  /** For action "set-edit-mode": toggles pi-flows `flows.editFlow`. */
  enabled?: boolean;
}

/**
 * Plugin settings-section write. The shell intercepts this in the plugin `send`
 * and routes it to `POST /api/config/plugins/:id` (it is NOT forwarded over the
 * WebSocket). See change: fix-plugin-config-write-persistence.
 */
export interface PluginConfigWriteBrowserMessage {
  type: "plugin_config_write";
  id: string;
  config: Record<string, unknown>;
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
  /**
   * Optional pasted images for a `type:"input"` answer (standalone
   * `ask_user{method:"input"}`). The encoder cannot fit images into the
   * string `answer`, so they ride here. Additive. See change:
   * add-ask-user-input-multiline-paste.
   */
  images?: ImageContent[];
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

/**
 * Browser → server: remove a CUSTOM role. Forwarded to the target session
 * bridge which purges it via the `roles:remove` handler (built-ins rejected
 * server-side). See change: add-custom-roles-ui.
 */
export interface RoleRemoveBrowserMessage {
  type: "role_remove";
  sessionId: string;
  role: string;
}

export interface RequestRolesBrowserMessage {
  type: "request_roles";
  sessionId: string;
}

/**
 * Browser → server: the user invoked a Phase-1 module action / requested
 * row data. Server forwards via `piGateway.sendToSession` to the bridge,
 * which re-emits as `pi.events.emit(event, { ...params, action, _reply })`.
 * See change: add-extension-ui-modal.
 */
/**
 * Browser → server: declares which session a browser is currently displaying
 * (typically when the URL is `/session/:id`). The server uses this to gate
 * unread-trigger evaluation and to clear the unread bit when an unread session
 * is opened. Browsers SHALL re-send `session_view` for the currently-displayed
 * session on every WebSocket reconnect so server-side state stays coherent.
 * See change: session-card-unread-stripes.
 */
export interface SessionViewBrowserMessage {
  type: "session_view";
  sessionId: string;
}

/**
 * Browser → server: declares the browser is no longer displaying the session
 * (e.g. user navigated away from `/session/:id`).
 * See change: session-card-unread-stripes.
 */
export interface SessionUnviewBrowserMessage {
  type: "session_unview";
  sessionId: string;
}

export interface UiManagementBrowserMessage {
  type: "ui_management";
  sessionId: string;
  action: string;
  event: string;
  params?: Record<string, unknown>;
}

/**
 * Browser → server: inject a `/view` preview row into the session. The
 * server persists it in a per-session view-messages store (separate from
 * pi's events.jsonl so the agent never observes it) and broadcasts the
 * updated list via `view_messages_update`.
 * See change: render-file-previews.
 */
export interface InjectViewMessageBrowserMessage {
  type: "inject_view_message";
  sessionId: string;
  target: import("./types.js").ViewTarget;
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
  | RequestProvidersBrowserMessage
  | SetThinkingLevelBrowserMessage
  | SetModelBrowserMessage
  | ShutdownBrowserMessage
  | StopAfterTurnBrowserMessage
  | ListSessionsBrowserMessage
  | ResumeSessionBrowserMessage
  | HideSessionBrowserMessage
  | UnhideSessionBrowserMessage
  | SpawnSessionBrowserMessage
  | AttachProposalBrowserMessage
  | DetachProposalBrowserMessage
  | AcceptReplaceProposalBrowserMessage
  | DismissReplaceProposalBrowserMessage
  | ReorderSessionsBrowserMessage
  | PinDirectoryMessage
  | UnpinDirectoryMessage
  | FavoriteModelMessage
  | UnfavoriteModelMessage
  | ReorderPinnedDirsMessage
  | CreateWorkspaceMessage
  | RenameWorkspaceMessage
  | DeleteWorkspaceMessage
  | SetWorkspaceCollapsedMessage
  | AddFolderToWorkspaceMessage
  | RemoveFolderFromWorkspaceMessage
  | ReorderWorkspaceFoldersMessage
  | ReorderWorkspacesMessage
  | OpenSpecBulkArchiveBrowserMessage
  | CreateTerminalBrowserMessage
  | KillTerminalBrowserMessage
  | OpenInlineTerminalBrowserMessage
  | CloseInlineTerminalBrowserMessage
  | RenameTerminalBrowserMessage
  | FlowControlBrowserMessage
  | ForceKillBrowserMessage
  | FlowManagementBrowserMessage
  | PluginConfigWriteBrowserMessage
  | ArchitectPromptResponseBrowserMessage
  | PromptResponseBrowserMessage
  | RoleSetBrowserMessage
  | RolePresetLoadBrowserMessage
  | RolePresetSaveBrowserMessage
  | RolePresetDeleteBrowserMessage
  | RoleRemoveBrowserMessage
  | RequestRolesBrowserMessage
  | UiManagementBrowserMessage
  | SessionViewBrowserMessage
  | SessionUnviewBrowserMessage
  | KillProcessBrowserMessage
  | PluginActionMessage
  | ClearFollowupEntriesFromBrowserMessage
  | EditFollowupEntryFromBrowserMessage
  | RemoveFollowupEntryFromBrowserMessage
  | PromoteFollowupEntryFromBrowserMessage
  | WorktreeInitSubscribeMessage
  | WorktreeInitUnsubscribeMessage
  | SetSessionDisplayPrefsBrowserMessage
  | SetSessionProcessDrawerBrowserMessage
  | SetSessionTagsBrowserMessage
  | InjectViewMessageBrowserMessage
  | RecoveryDismissMessage
  | SubagentResyncRequestBrowserMessage
  | WatchFilesBrowserMessage;

/**
 * Browser → server → bridge: request the latest retained snapshot of a
 * still-running subagent's timeline, to recover after a gap/reconnect without
 * waiting for completion. The server forwards it to the owning bridge, which
 * replies with a synthetic `subagent_started` `event_forward`, or no-ops for an
 * unknown/finished agent (the durable completed-case backfill covers those).
 * See change: fix-subagent-live-detail-reliability (D2).
 */
export interface SubagentResyncRequestBrowserMessage {
  type: "subagent_resync_request";
  sessionId: string;
  agentId: string;
}

/**
 * Browser declares the editor pane's currently-open files for a session so the
 * server watches exactly those (and no more). Sent on open-set change and on
 * pane unmount / session switch (with an empty `paths` to clear).
 * See change: split-editor-workspace.
 */
export interface WatchFilesBrowserMessage {
  type: "watch_files";
  sessionId: string;
  cwd: string;
  /** Rel-paths of the open tabs; `[]` tears the session's watchers down. */
  paths: string[];
}

/**
 * Browser registers interest in worktree-init events for a given
 * `requestId` BEFORE issuing `POST /api/git/worktree/init`. Server stores
 * the mapping requestId -> originating WebSocket and only delivers the
 * matching `worktree_init_*` events to that connection. See change:
 * generalize-worktree-init-hook (renamed from worktree_bootstrap_*).
 */
export interface WorktreeInitSubscribeMessage {
  type: "worktree_init_subscribe";
  /** Legacy per-click correlation key. */
  requestId?: string;
  /**
   * Stable per-checkout key. Subscribing by `cwd` survives refresh and reaches
   * every tab; used by the manual button, auto-on-spawn, and boot rehydration.
   * See change: friendlier-worktree-init.
   */
  cwd?: string;
}

/** Drops the subscription if the dialog is cancelled or completes. */
export interface WorktreeInitUnsubscribeMessage {
  type: "worktree_init_unsubscribe";
  requestId?: string;
  cwd?: string;
}

/**
 * One active worktree-init run in the server's cwd-keyed registry, as returned
 * by `GET /api/git/worktree/active-inits`. See change: friendlier-worktree-init.
 */
export interface ActiveWorktreeInit {
  cwd: string;
  phase: "running" | "done" | "failed";
  startedAt: number;
  lastLine?: string;
  /** Failure classifier (phase `failed` only). */
  code?: string;
}

