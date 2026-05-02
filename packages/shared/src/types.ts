/** Source environment where a pi session is running */
export type SessionSource = "tui" | "zed" | "tmux" | "dashboard" | "terminal" | "unknown";

/** Current status of a session */
export type SessionStatus = "active" | "idle" | "streaming" | "ended";

/**
 * Per-session jj (Jujutsu) probe state. Populated by the bridge when the
 * cwd contains a `.jj/` directory and the `jj` tool resolves; otherwise
 * left undefined.
 * See change: add-jj-workspace-plugin.
 */
export interface JjState {
  /** True iff cwd is inside a jj repo (`.jj/` reachable). */
  isJjRepo: boolean;
  /** True iff the repo is jj-colocated with git (both `.jj/` and `.git/`). */
  isColocated: boolean;
  /**
   * Name of the workspace whose working copy is at this cwd.
   * `"default"` for the original/source workspace; user-named for siblings
   * created via `jj workspace add`.
   */
  workspaceName?: string;
  /** Absolute path of the workspace root (== cwd for the active workspace). */
  workspaceRoot?: string;
  /** Bookmarks present on the workspace's `@-` (used by the badge / fold-back). */
  bookmarks?: string[];
  /** Last probe error, surfaced for diagnostics. Empty when probe succeeded. */
  lastError?: string;
}

/** A dashboard session representing a connected pi instance */
export interface DashboardSession {
  id: string;
  cwd: string;
  name?: string;
  source: SessionSource;
  status: SessionStatus;
  model?: string;
  thinkingLevel?: string;
  startedAt: number;
  endedAt?: number;
  /**
   * Epoch ms timestamp of the most recent activity event observed for this
   * session. Server-managed: stamped in `event-wiring.ts` whenever an
   * `event_forward` arrives whose `eventType` is on the activity-event
   * allowlist (`isActivityEvent`). NOT persisted to `.meta.json`; cold-start
   * seeded from `events.jsonl` mtime in `session-scanner.ts`. Drives the
   * session-card relative-time badge via `selectBadgeTimestamp`.
   * See change: session-card-last-activity-badge.
   */
  lastActivityAt?: number;
  /**
   * Server-managed per-session unread bit. `true` when an attention-worthy
   * event (turn finished, ask_user appeared, agent_end with error) fired
   * while no browser was viewing the session. Cleared when any browser
   * sends `session_view`. Persisted to `.meta.json` so it survives reload.
   * Bridges SHALL NOT send this field.
   * See change: session-card-unread-stripes.
   */
  unread?: boolean;
  tokensIn?: number;
  tokensOut?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  currentTool?: string | null;
  gitBranch?: string;
  gitBranchUrl?: string;
  gitPrNumber?: number;
  gitPrUrl?: string;
  /**
   * Per-session jj (Jujutsu) state. Populated by the bridge's per-session
   * VCS probe when (a) the tool registry resolves `jj` AND (b) `.jj/` exists
   * in the session cwd. Absent or `{ isJjRepo: false }` for sessions outside
   * a jj repo — jj-plugin slot predicates treat both as inactive. NOT
   * persisted to `.meta.json`; refreshed on every probe tick.
   * See change: add-jj-workspace-plugin.
   */
  jjState?: JjState;
  openspecPhase?: OpenSpecPhase | null;
  openspecChange?: string | null;
  attachedProposal?: string | null;
  contextTokens?: number | null;
  contextWindow?: number;
  sessionFile?: string;
  sessionDir?: string;
  hidden?: boolean;
  firstMessage?: string;
  dataUnavailable?: boolean;
  resuming?: boolean;
  /** Active flow name (set during flow execution) */
  activeFlowName?: string;
  /** Number of completed agents in the active flow */
  flowAgentsDone?: number;
  /** Total number of agents in the active flow */
  flowAgentsTotal?: number;
  /** Flow execution status */
  flowStatus?: FlowStatus;
  /** Last known bridge entry count (for skip-wipe comparison on reconnect) */
  lastEntryCount?: number;
  /** OS process ID of the pi agent — used for force-kill escalation */
  pid?: number;
  /** Active child processes detected by bridge process scanner */
  processes?: Array<{ pid: number; pgid: number; command: string; elapsedMs: number }>;
  /** Latest process metrics from the pi agent */
  processMetrics?: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    cpuPercent: number;
    eventLoopMaxMs?: number;
    loadAvg1m: number;
    /** Timestamp when metrics were last received */
    updatedAt: number;
  };
  /** Extension-declared UI modules (Phase 1: management-modal slot). */
  uiModules?: ExtensionUiModule[];
  /** Cached row data per `view.dataEvent` for table/grid views. Per-event item cap is enforced server-side. */
  uiDataMap?: Record<string, unknown[]>;
  /**
   * Phase-2 live in-page decorations (footer-segment, agent-metric, breadcrumb,
   * gate, toast). Keyed by `${kind}:${namespace}:${id}`. Last-write-wins on
   * upsert; explicit removal via `ext_ui_decorator { removed: true }` deletes
   * the entry. See change: add-extension-ui-decorations.
   */
  uiDecorators?: Record<string, DecoratorDescriptor>;
}

// ── Extension UI System (Phase 1: management-modal slot) ───────────
// Per `extension-ui-system` design + `add-extension-ui-modal` change.
// Field/type names match PR #15 verbatim so any later archival diff stays small.

export type UiViewKind = "table" | "grid" | "form";

export type UiFieldKind =
  | "text"
  | "number"
  | "boolean"
  | "select"
  | "code"
  | "datetime"
  | "textarea";

export interface UiField {
  /** Dot-path into row / form-state. */
  key: string;
  label: string;
  kind: UiFieldKind;
  /** For kind: "select". */
  options?: string[];
  placeholder?: string;
  required?: boolean;
  readOnly?: boolean;
  /** Legacy alias for kind: "textarea". Prefer `kind: "textarea"`. */
  multiline?: boolean;
  /** Display-only: table column width. */
  width?: string | number;
  /** For kind: "code". Hint to syntax highlighter. */
  language?: string;
}

export interface UiAction {
  /** Action id, echoed back as the `action` field on the `ui_management` message. */
  id: string;
  label: string;
  /** MDI icon key from `@mdi/js` (e.g. `"mdiCheckCircle"`). Unknown keys render no icon. */
  icon?: string;
  variant?: "primary" | "secondary" | "danger";
  /** Event name re-emitted on the extension's `pi.events` bus when the action fires. */
  event: string;
  params?: Record<string, unknown>;
  /** If present, dashboard mounts ConfirmDialog with this message before dispatching. */
  confirm?: string;
}

export interface UiSection {
  id: string;
  title?: string;
  description?: string;
  fields: UiField[];
}

export interface UiView {
  kind: UiViewKind;
  /** Table/grid columns; form fields when no `sections` provided. */
  fields?: UiField[];
  /** For form view: grouped fields. Mutually exclusive with top-level `fields`. */
  sections?: UiSection[];
  /** Event name to request rows; required for `table`/`grid`. */
  dataEvent?: string;
  /** Unique-row field for `table`/`grid` (default: `"id"`). */
  rowKey?: string;
  /** Per-row actions for `table`/`grid`. */
  rowActions?: UiAction[];
  /** Shown when `items.length === 0`. */
  emptyState?: string;
  /** Top-of-modal toolbar actions. */
  actions?: UiAction[];
}

export interface ExtensionUiModule {
  /** Phase 1: only `"management-modal"`. */
  kind: "management-modal";
  /** Unique within the session. Last-write-wins on collision. */
  id: string;
  /** Exact slash command (case-sensitive). */
  command: string;
  title: string;
  description?: string;
  /** MDI icon key from `@mdi/js`. */
  icon?: string;
  /** Free-form group label (sidebar grouping in future). */
  category?: string;
  view: UiView;
}

// ── Extension UI System (Phase 2: live in-page decorations) ──────
// Per `extension-ui-system` design + `add-extension-ui-decorations` change.
// Single discriminated union forwarded as one `ext_ui_decorator` message per
// descriptor. Cache key: `${kind}:${namespace}:${id}`. `namespace` MUST match
// `/^[a-z0-9-]+$/`; the bridge drops malformed namespaces with a warning.

export type DecoratorKind =
  | "footer-segment"
  | "agent-metric"
  | "breadcrumb"
  | "gate"
  | "toast";

export interface FooterSegmentPayload {
  text: string;
  tooltip?: string;
  /** MDI icon key from `@mdi/js`. Unknown keys render no icon. */
  icon?: string;
}

export interface AgentMetricPayload {
  /** Matches the agent id rendered by `FlowAgentCard`. */
  agentId: string;
  text: string;
  tooltip?: string;
}

export interface BreadcrumbStep {
  id: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
}

export interface BreadcrumbPayload {
  steps: BreadcrumbStep[];
  /** Step id of the currently-active step (overrides `status: "active"` selection). */
  current?: string;
}

export interface GatePayload {
  /** Matches the flow id rendered in `FlowLaunchDialog`. */
  flowId: string;
  available: boolean;
  /** Reason rendered as a tooltip when `available: false`. */
  reason?: string;
}

export interface ToastPayload {
  level: "info" | "success" | "warn" | "error";
  message: string;
  /** Auto-dismiss after this many ms. Default 5000; `0` = sticky. */
  durationMs?: number;
}

export type DecoratorDescriptor =
  | { kind: "footer-segment"; namespace: string; id: string; payload: FooterSegmentPayload }
  | { kind: "agent-metric";   namespace: string; id: string; payload: AgentMetricPayload }
  | { kind: "breadcrumb";     namespace: string; id: string; payload: BreadcrumbPayload }
  | { kind: "gate";           namespace: string; id: string; payload: GatePayload }
  | { kind: "toast";          namespace: string; id: string; payload: ToastPayload };

/** An event forwarded from a pi session */
export interface DashboardEvent {
  eventType: string;
  timestamp: number;
  data: Record<string, unknown>;
}

/** Info about an available flow from pi-flows */
export interface FlowInfo {
  name: string;
  description: string;
  taskRequired: boolean;
  source?: string;
}

/** Info about an available command */
export interface CommandInfo {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill" | "builtin";
  location?: string;
  path?: string;
}

/** Image content for message attachments (compatible with pi SDK ImageContent) */
export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

/** File entry from directory listing */
export interface FileEntry {
  path: string;
  isDirectory: boolean;
}

/** Per-turn token usage breakdown */
export interface TurnUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Context window usage */
export interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
}

/** Available model info */
export interface ModelInfo {
  provider: string;
  id: string;
}

/** Role assignment info (from pi-flows role-manager) */
export interface RoleInfo {
  roles: Record<string, string>;
  presets: Array<{ name: string; roles: Record<string, string> }>;
  activePreset: string | null;
}

/** OpenSpec artifact status */
export interface OpenSpecArtifact {
  id: string;
  status: "done" | "ready" | "blocked";
}

/** A single OpenSpec change */
export interface OpenSpecChange {
  name: string;
  status: "no-tasks" | "in-progress" | "complete";
  completedTasks: number;
  totalTasks: number;
  artifacts: OpenSpecArtifact[];
  /**
   * Artifact-authoring completeness reported by `openspec status --change <name> --json`.
   * `true` when all required artifacts for the change's workflow are present/done.
   * Orthogonal to task-tally completeness; used by the dashboard to surface an
   * "Archive anyway" escape hatch when artifacts are authored but tasks remain unchecked.
   */
  isComplete?: boolean;
}

/** Lifecycle state of an OpenSpec change, derived from artifacts + task status */
export enum ChangeState {
  PLANNING = "PLANNING",
  READY = "READY",
  IMPLEMENTING = "IMPLEMENTING",
  COMPLETE = "COMPLETE",
}

/** Derive the lifecycle state of an OpenSpec change from its data */
export function deriveChangeState(change: OpenSpecChange): ChangeState {
  const allDone = change.artifacts.length > 0 && change.artifacts.every((a) => a.status === "done");
  if (!allDone) return ChangeState.PLANNING;
  if (change.status === "complete") return ChangeState.COMPLETE;
  if (change.status === "in-progress") return ChangeState.IMPLEMENTING;
  return ChangeState.READY;
}

/** OpenSpec data for a session's project */
export interface OpenSpecData {
  initialized: boolean;
  changes: OpenSpecChange[];
}

/** OpenSpec workflow phase detected from tool calls */
export type OpenSpecPhase =
  | "explore"
  | "new"
  | "continue"
  | "ff"
  | "apply"
  | "verify"
  | "archive"
  | "sync-specs"
  | "onboard";

/** Active OpenSpec activity for a session */
export interface OpenSpecActivity {
  phase: OpenSpecPhase;
  changeName?: string;
}

/** Pi session info returned from SessionManager.list() */
export interface PiSessionInfo {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  parentSessionPath?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage?: string;
}

/** Data payload for bash_output dashboard events */
export interface BashOutputData {
  command: string;
  output: string;
  exitCode: number;
  /** true for !! (silent), false for ! (sent to LLM) */
  excludeFromContext: boolean;
}

/** Data payload for command_feedback dashboard events */
export interface CommandFeedbackData {
  command: string;
  status: "started" | "completed" | "error";
  message?: string;
}

// ── Flow Dashboard Types ────────────────────────────────────────────

/** Status of a flow agent card */
export type FlowAgentStatus = "pending" | "running" | "complete" | "error" | "blocked";

/** A recent tool call displayed on an agent card */
export interface FlowRecentTool {
  toolName: string;
  inputPreview: string;
}

/** Detail history entry for agent detail view */
export type FlowDetailEntry =
  | { kind: "tool"; toolName: string; input: unknown; output?: unknown; isError: boolean }
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "error"; text: string };

/** Agent card config from pi-flows AgentConfig (minimal subset) */
export interface FlowAgentCardConfig {
  name: string;
  description?: string;
  model?: string;
  card?: { label?: string; metric?: string; role?: string };
  sourcePath?: string;
}

/** Per-agent state tracked in flow state */
export interface FlowAgentState {
  agentName: string;
  stepId: string;
  /** Step type from the flow config (agent, fork, agent-decision, agent-loop-decision, etc.) */
  stepType?: string;
  status: FlowAgentStatus;
  label?: string;
  model?: string;
  resolvedModel?: string;
  cardRole?: string;
  blockedBy: string[];
  tokens?: { input: number; output: number };
  duration?: number;
  summary?: string;
  files?: string[];
  recentTools: FlowRecentTool[];
  detailHistory: FlowDetailEntry[];
  loopIteration?: number;
  loopMax?: number;
  sourcePath?: string;
  runCount?: number;
}

/** Overall flow execution status */
export type FlowStatus = "running" | "success" | "error" | "aborted";

/** Flow execution state tracked client-side by the event reducer */
export interface FlowState {
  flowName: string;
  task: string;
  status: FlowStatus;
  autonomousMode: boolean;
  /** Path to the flow YAML file (for YAML viewer) */
  flowSource?: string;
  /** Ordered map — insertion order matches step order from flow config */
  agents: Map<string, FlowAgentState>;
  /** All steps from the flow configuration — used for DAG graph rendering.
   *  Includes non-agent steps (fork, conditional, agent-loop-decision). */
  dagSteps?: Array<{ id: string; stepType: string; agent?: string; blockedBy: string[]; loopTarget?: string; exitTarget?: string }>;
  /** Flow-ref steps from the flow configuration (subflows) */
  flowRefSteps?: Array<{ id: string; label: string; blockedBy: string[] }>;
  /** Set after flow_complete event */
  flowResult?: Record<string, unknown>;

  /** Next flow to run (workflow stage resolution) */
  nextStep?: string | null;
  /** Pre-computed summary stats */
  summaryStats?: {
    agentCount: number;
    duration: string;
    fileCount: number;
    perAgent: Array<{ name: string; status: string; fileCount: number }>;
  };
}

// ── Architect Dashboard Types ───────────────────────────────────────

/** Phase of the architect lifecycle */
export type ArchitectPhase = "context" | "designing" | "preview" | "complete" | "cancelled";

/** Agent entry tracked during architect design */
export interface ArchitectAgentEntry {
  name: string;
  type: "built-in" | "local" | "custom";
  status: "pending" | "creating" | "done" | "error";
  statusText?: string;
  /** Raw markdown source from agent_write (only for custom agents) */
  source?: string;
}

/** Step in the designed flow DAG */
export interface ArchitectDagStep {
  id: string;
  agentName?: string;
  blockedBy: string[];
  /** Step type — matches flow engine step types */
  stepType?: "agent" | "fork" | "conditional" | "agent-decision" | "agent-loop-decision" | "flow-ref";
  /** For loop steps: the step ID to loop back to */
  loopTarget?: string;
  /** For loop steps: the step ID to continue to after exiting the loop */
  exitTarget?: string;
}

/** Parsed flow metadata from architect preview */
export interface ArchitectParsedFlow {
  name: string;
  description: string;
  maxConcurrent: number;
  steps: ArchitectDagStep[];
}

/** Architect state tracked client-side by the architect reducer */
export interface ArchitectPrompt {
  id: string;
  type: "select" | "input" | "confirm";
  question: string;
  options?: string[];
  defaultValue?: string;
}

export interface ArchitectState {
  phase: ArchitectPhase;
  architectMode: "new" | "edit";
  flowName: string;
  /** Resolved model ID (e.g., "anthropic/claude-opus-4-6") */
  resolvedModel?: string;
  /** Model alias (e.g., "@planning") */
  modelAlias?: string;
  agents: ArchitectAgentEntry[];
  dagSteps: ArchitectDagStep[];
  parsedFlows: ArchitectParsedFlow[];
  lastToolCall: { toolName: string; inputPreview: string } | null;
  /** Rolling window of recent tool calls for card display */
  recentTools: FlowRecentTool[];
  /** Full detail history (tool calls, text, thinking) for detail view */
  detailHistory: FlowDetailEntry[];
  iteration: number;
  catalogSummary?: string;
  error?: string;
  /** Pending architect prompt (Save/Replan/Cancel etc.) rendered in widget bar */
  pendingPrompt: ArchitectPrompt | null;
  /** Raw flow YAML content for the YAML viewer */
  flowYamlContent?: string;
  /** Whether the last flow_write succeeded (file written to disk) */
  flowWriteStatus?: "written" | "validation-error";
}

/** REST API response envelope */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
