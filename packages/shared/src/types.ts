/** Source environment where a pi session is running */
export type SessionSource = "tui" | "zed" | "tmux" | "dashboard" | "terminal" | "unknown";

/** Current status of a session */
export type SessionStatus = "active" | "idle" | "streaming" | "ended";

/**
 * Per-session git-worktree state. Populated by the bridge's VCS probe when
 * `git rev-parse --git-common-dir` resolves outside `--show-toplevel` (the
 * canonical signal that this cwd is a worktree, not the main checkout).
 * Absent (or `undefined`) for plain checkouts — clients MUST treat absence
 * as "not a worktree". Used by the dashboard to (a) group worktree
 * sessions under their parent repo, (b) render the WORKSPACE-subcard
 * worktree pill.
 *
 * `base` is post-create metadata, set by the server when a session is
 * spawned via the dashboard's worktree dialog and persisted to
 * `.meta.json` as `gitWorktreeBase`. The bridge itself never populates
 * `base` (git does not record the ref a worktree was forked from).
 *
 * See change: add-worktree-spawn-dialog.
 */
export interface GitWorktreeInfo {
  /** Absolute path of the main worktree (parent repo root). */
  mainPath: string;
  /** Basename of the worktree directory (typically `<repo>/.worktrees/<name>`). */
  name: string;
  /** Base ref the worktree was created from. Server-supplied, optional. */
  base?: string;
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
   * pi-coding-agent version the session is actually running, reported by the
   * bridge from inside pi's own process. Absent on older bridges and until the
   * first report. See change: restore-pi-version-skew-surface.
   */
  piVersion?: string;
  /**
   * Per-session git-worktree identity. Set only when the session's cwd
   * is a git worktree (not the main checkout). See `GitWorktreeInfo`.
   * Absent on older bridges and for plain checkouts. Clients should read
   * `gitWorktree.base` for the create-from ref (when known); the raw
   * `gitWorktreeBase` field below is the server-side cache used to
   * compose `base` on the broadcast payload.
   * See change: add-worktree-spawn-dialog.
   */
  gitWorktree?: GitWorktreeInfo;
  /**
   * Server-cached base ref for the session's worktree, loaded from the
   * sidecar `.meta.json` (`gitWorktreeBase`). Used internally to compose
   * `gitWorktree.base` when broadcasting; clients SHOULD prefer
   * `gitWorktree.base` (merged) and ignore this raw cache.
   * See change: add-worktree-spawn-dialog.
   */
  gitWorktreeBase?: string;
  /**
   * Tri-state whether the session's cwd is a git repository, independent of
   * branch-info arrival. `true` = confirmed git repo, `false` = confirmed
   * non-git, `undefined` = unknown (probe inconclusive / legacy session).
   * Carried on `session_register` (no arrival race), persisted to `.meta.json`,
   * restored by `sessionFromMeta` on cold start. Used to gate the `+Worktree`
   * button (hide only on `=== false`).
   * See change: gate-session-worktree-button-on-git.
   */
  isGitRepo?: boolean;
  /**
   * Server-managed flag set by any of three probe sites: (1) the bridge's
   * 30 s VCS tick (`existsSync(cwd) === false`), (2) the server's session
   * scanner re-probing ended sessions on boot, (3) the `worktree/remove`
   * lifecycle endpoint optimistically stamping every session under the
   * removed path. Purely computed — NEVER persisted to `.meta.json`. Older
   * bridges never send this; clients SHALL treat `undefined` as "not
   * missing". See change: add-worktree-lifecycle-actions.
   */
  cwdMissing?: boolean;
  openspecPhase?: OpenSpecPhase | null;
  openspecChange?: string | null;
  attachedProposal?: string | null;
  /**
   * Server-suggested replacement for a manually-attached proposal that the
   * user has not yet accepted or dismissed. Set by the event-wiring
   * coalescing branch when the LLM emits an active OpenSpec operation for a
   * different change than the one manually attached. When non-null AND
   * `attachedProposal` is non-null, the client renders the replace-proposal
   * dialog. Coalesces (latest wins); cleared on accept/dismiss/`agent_end`.
   * See change: replace-proposal-dialog-with-race-handling.
   */
  pendingReplaceProposal?: string | null;
  /**
   * ChangeNames the user dismissed during the current LLM activity loop.
   * A dismissed name does NOT re-prompt until `agent_end` clears this set.
   * Per-name: dismissing B does not suppress a later prompt for C.
   * See change: replace-proposal-dialog-with-race-handling.
   */
  rejectedReplaceProposals?: string[];
  /**
   * Sparse per-session override for chat-view display preferences. Mirror
   * of `SessionMeta.displayPrefsOverride`. Deep-merged onto the global
   * `DisplayPrefs` on the client side via `mergeDisplayPrefs`.
   * See change: configurable-chat-display.
   */
  displayPrefsOverride?: import("./display-prefs.js").PartialDisplayPrefs;
  /**
   * Per-session collapse state for the PROCESS subcard's background-
   * processes drawer. Mirror of `SessionMeta.processDrawerCollapsed`.
   * `undefined` (field absent) means "no stored choice" — the drawer
   * renders collapsed by default. See change: persist-process-drawer-collapse.
   */
  processDrawerCollapsed?: boolean;
  contextTokens?: number | null;
  contextWindow?: number;
  sessionFile?: string;
  sessionDir?: string;
  hidden?: boolean;
  firstMessage?: string;
  dataUnavailable?: boolean;
  /**
   * Liveness marker fields mirrored from `.meta.json` at scan time so
   * cold-start restore can classify interrupted-session recovery candidates
   * (`live===true && closedReason!=="manual"`). Server-internal; not part of
   * the steady-state wire contract. See change: reopen-sessions-after-shutdown.
   */
  live?: boolean;
  liveEpoch?: number;
  closedReason?: string;
  /** Set at cold-start restore when the scanned session is a recovery
   *  candidate. See change: reopen-sessions-after-shutdown. */
  recoveryCandidate?: boolean;
  resuming?: boolean;
  /**
   * Client-side transient: set optimistically when the user triggers
   * shutdown so the card can render a "closing" state (dim + spinner +
   * disabled ✕) while the server kill ladder runs. Mirrors `resuming`.
   * Cleared when `session_removed` removes the card, or by a bounded
   * safety-revert timer. Bridges and server SHALL NOT send it.
   */
  closing?: boolean;
  /** Last known bridge entry count (for skip-wipe comparison on reconnect) */
  lastEntryCount?: number;
  /** OS process ID of the pi agent — used for force-kill escalation */
  pid?: number;
  /** Active child processes detected by bridge process scanner. Server
   *  enriches each with classification fields. See change:
   *  classify-process-list-entries. */
  processes?: Array<{ pid: number; pgid: number; command: string; elapsedMs: number; kind?: import("./protocol.js").ProcessKind; label?: string; sessionRef?: string }>;
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
  /**
   * Per-session image asset registry, keyed by content hash. Populated by
   * `asset_register` events emitted by the bridge for local-file images
   * referenced as `![](path)` in assistant markdown. Survives event-buffer
   * eviction (lives on Session, not in the rolling event buffer) so
   * `pi-asset:<hash>` references in older messages still resolve.
   * See change: chat-markdown-local-images-and-math.
   */
  assets?: Record<string, { data: string; mimeType: string }>;
  /**
   * Mirror of pi's native steering + follow-up queues for this session.
   * Populated from pi's `queue_update` event, forwarded by the bridge.
   * `steering[]` typically empties every turn boundary (1-15 s); `followUp`
   * is dashboard-enforced capacity 1 and drains on `agent_end`.
   * See capability `mid-turn-prompt-queue`. See change: add-followup-edit-and-steer-cancel.
   */
  pendingQueues?: { steering: string[]; followUp: string[] };
  /**
   * Session classification. Currently the only non-default value is
   * `"automation"`, stamped on sessions spawned by the automation-plugin's
   * scheduler. Plain user sessions leave this `undefined`. The board/order
   * filter treats `kind==="automation"` runs as hidden unless their
   * `automationRun.visibility` is `"shown"`. Persisted to `.meta.json`.
   * See change: add-automation-plugin.
   */
  kind?: "automation";
  /**
   * Automation-run identity, set together with `kind==="automation"`. `name`
   * is the automation's folder name; `runId` is the per-occurrence run id
   * (`<date>-<name>` store key). `visibility` carries the run's EFFECTIVE
   * board visibility (per-automation `visibility` field ?? settings default,
   * default `"hidden"`) so the board filter can decide inclusion without
   * re-reading the automation config. Persisted to `.meta.json`.
   * See change: add-automation-plugin.
   */
  automationRun?: { name: string; runId: string; visibility?: "hidden" | "shown" };
  /**
   * Owning goal id when this session was spawned under / linked to a
   * folder-scoped `GoalRecord`. Persisted to `.meta.json`. The session-card
   * goal chip reads this to navigate to the owning goal's detail page.
   * See change: add-goals-folder-page.
   */
  goalId?: string;
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

// PendingPrompt removed in change: add-followup-edit-and-steer-cancel.
// Pi's native queues are now the single source of truth; `Session.pendingQueues`
// holds `string[]` arrays directly from pi's `queue_update` event.

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
  /** Human-friendly label from `Model.name`; falls back to id when absent. */
  name?: string;
  /** From `Model.reasoning` — model supports thinking. */
  reasoning?: boolean;
  /** Derived: `Model.input.includes("image")` — model accepts image input. */
  vision?: boolean;
  /** From `Model.contextWindow`. */
  contextWindow?: number;
  /**
   * Confidence of `reasoning`/`vision`: `"catalog"` when the bridge's
   * `enrichModelMetadata()` probe resolved the model against pi's registry
   * (real capabilities); `"fallback"` when it force-defaulted
   * (`input:["text","image"]`, `reasoning:false`) because the provider
   * reported no capability data. Drives confident-badge vs `?`-badge in the
   * selector. Absent = old bridge that sent no capability fields (render no
   * badge, NOT `?`). See change: enrich-model-selector-capabilities-favorites.
   */
  metadataSource?: "catalog" | "fallback";
  /**
   * Thinking levels this model supports, derived from pi 0.72+'s per-model
   * `thinkingLevelMap`. Keys whose value is non-null (string | true) are
   * projected here; null map entries mean "pi level not supported by this
   * model". Absent on pre-0.72 bridges (no map) → selector falls back to all
   * canonical levels. See change: adopt-pi-071-072-073-features.
   */
  supportedThinkingLevels?: string[];
}

/**
 * Provider catalogue entry pushed by the bridge to the server.
 * Derived from pi's live `ModelRegistry` (see provider-register.ts in
 * the bridge). The server caches the most recently received catalogue
 * and uses it as the source for `GET /api/provider-auth/status`.
 * See change: replace-hardcoded-provider-lists.
 */
export interface ProviderInfo {
  /** pi-ai provider id (e.g. "anthropic", "deepseek", "google-vertex"). */
  id: string;
  /** From `modelRegistry.getProviderDisplayName(id)`; falls back to id. */
  displayName: string;
  /** True iff `authStorage.getOAuthProviders()` includes this id. */
  hasOAuth: boolean;
  /** True iff a credential is stored in auth.json. */
  configured: boolean;
  /** Where the credential is sourced from, when configured. */
  source?: "stored" | "environment" | "fallback" | "runtime";
  /** First env var name pi-ai consults for this provider, when applicable. */
  envVar?: string;
  /** True when configured via ambient credential chain (AWS profile / GCP ADC). */
  ambient?: boolean;
  /** Expiry timestamp for OAuth credentials. */
  expires?: number;
  /**
   * True when this provider was registered by the dashboard itself via
   * `pi.registerProvider()` from `~/.pi/agent/providers.json` (a "custom"
   * provider managed by the LLM Providers settings section). Consumers
   * use this to suppress API-key auth rows for custom providers — their
   * keys are managed elsewhere. OAuth rows are still emitted because a
   * custom OAuth provider needs its login button.
   */
  custom?: boolean;
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
  /**
   * Group assignment joined server-side from `<cwd>/openspec/groups/groups.json`.
   * `null` or absent means Ungrouped. Clients SHALL NOT recompute the join.
   * See change: add-openspec-change-grouping.
   */
  groupId?: string | null;
}

/** Schema version for the per-repo OpenSpec groups file at
 *  `<cwd>/openspec/groups/groups.json`. Bumped only on incompatible shape changes.
 *  See change: add-openspec-change-grouping. */
export const OPENSPEC_GROUPS_SCHEMA_VERSION = 1 as const;

/** Schema version for the per-folder goals file under the dashboard data dir
 *  (`~/.pi/dashboard/goals/<folderHash>.json`). Bumped only on incompatible
 *  shape changes. See change: add-goals-folder-page. */
export const GOALS_SCHEMA_VERSION = 1 as const;

/** Durable lifecycle status of a folder-scoped goal. Distinct from the
 *  goal-plugin's live `GoalStatus` ("active"/"done") — this is the dashboard's
 *  owned intent. See change: add-goals-folder-page. */
export type GoalRecordStatus = "pursuing" | "paused" | "achieved" | "cleared";

/** A single success criterion on a goal. */
export interface GoalCriterion {
  text: string;
  done: boolean;
}

/** Optional budget config mirrored onto the in-session loop. */
export interface GoalBudget {
  maxTurns?: number;
  maxSpendUsd?: number;
}

/** Judge-model selection for a goal's loop. Cross-model by default; `sameModel`
 *  opts into self-judge (judge == executor). See change:
 *  sophisticate-goal-authoring-and-control. */
export interface GoalJudge {
  provider: string;
  modelId: string;
  sameModel?: boolean;
}

/** A single judge verdict recorded for a goal's driver loop, derived from
 *  advances in the `goal_status` snapshot stream. FIFO-capped on the record.
 *  See change: sophisticate-goal-authoring-and-control. */
export interface GoalVerdict {
  /** Continuation turn this verdict was observed at. */
  turn: number;
  /** Wall-clock ms when appended. */
  at: number;
  verdict: "continue" | "satisfied" | "paused";
  note?: string;
}

/** Max retained verdicts per GoalRecord (FIFO; oldest dropped past this).
 *  See change: sophisticate-goal-authoring-and-control. */
export const GOAL_VERDICTS_CAP = 50 as const;

/** Folder-scoped goal record. Dashboard owns the durable definition
 *  (objective, criteria, status intent, linked sessions); the
 *  @ricoyudog/pi-goal-hermes extension stays source of truth for live loop
 *  state, associated by `goalId` on the `goal_status` snapshot.
 *  See change: add-goals-folder-page. */
export interface GoalRecord {
  /** Server-generated unique id. */
  id: string;
  /** Folder scope key (absolute cwd). */
  cwd: string;
  objective: string;
  criteria: GoalCriterion[];
  status: GoalRecordStatus;
  budget?: GoalBudget;
  /** Judge-model selection (optional; absent = extension default cross-model). */
  judge?: GoalJudge;
  /** Bounded per-turn judge verdict history (FIFO, cap `GOAL_VERDICTS_CAP`). */
  verdicts?: GoalVerdict[];
  /** Latest `turnsUsed` observed from any driver's live loop. Optional; a
   *  pre-change record backfills on the first snapshot after upgrade.
   *  See change: persist-goal-status-and-progress. */
  lastKnownTurnsUsed?: number;
  /** Cumulative turns consumed across all drivers of this goal (per-driver
   *  non-negative deltas; the truthful budget denominator). Optional.
   *  See change: persist-goal-status-and-progress. */
  totalTurnsUsed?: number;
  /** Wall-clock ms when `turnsUsed` last strictly increased. Optional.
   *  See change: persist-goal-status-and-progress. */
  lastProgressAt?: number;
  /** Sessions opened in service of this goal (drivers + workers, incl. hidden). */
  sessionIds: string[];
  /** Session running the pi-goal-hermes loop, when known. */
  driverSessionId?: string;
  createdAt: number;
  updatedAt: number;
}

/** Shape of the on-disk goals file under the dashboard data dir.
 *  See change: add-goals-folder-page. */
export interface GoalsFile {
  schemaVersion: number;
  goals: GoalRecord[];
}

/** A user-defined group of OpenSpec changes within a single repo.
 *  See change: add-openspec-change-grouping. */
export interface OpenSpecGroup {
  /** Server-generated slug from `name` plus collision suffix. Stable across rename. */
  id: string;
  /** User-visible label; editable. */
  name: string;
  /** Optional CSS hex color (`#RRGGBB`). Clients fall back to a default palette when omitted. */
  color?: string;
  /** Display order; server keeps values contiguous `0..groups.length - 1` after every reorder. */
  order: number;
}

/** Shape of the on-disk groups file at `<cwd>/openspec/groups/groups.json`.
 *  Single combined file for groups + assignments — one read, one write, atomic.
 *  See change: add-openspec-change-grouping. */
export interface OpenSpecGroupsFile {
  schemaVersion: number;
  groups: OpenSpecGroup[];
  /** `changeName` → `groupId`. Unassigned changes have no entry. */
  assignments: Record<string, string>;
  /**
   * Persisted manual ordering of changes within each group. Key = `groupId`
   * (or `OPENSPEC_UNGROUPED_KEY` for the implicit Ungrouped column); value =
   * ordered list of `changeName`. Absent groups/changes fall back to the
   * deterministic default sort (in-progress → complete → name). Optional for
   * backward compatibility with files written before this field existed.
   * See change: redesign-openspec-board.
   */
  changeOrder?: Record<string, string[]>;
}

/** Sentinel `groupId` key for the implicit Ungrouped column in
 *  `OpenSpecGroupsFile.changeOrder`. See change: redesign-openspec-board. */
export const OPENSPEC_UNGROUPED_KEY = "__ungrouped__" as const;

/**
 * Global OpenSpec workflow configuration — the user's enabled commands
 * and delivery preferences. Returned by `openspec config list --json`.
 *
 * `workflows` is the single source of truth for which actions render.
 * `delivery` decides the prompt prefix (skills vs commands).
 * See change: redesign-session-card-and-composer (config-driven-workflow).
 */
export interface OpenSpecConfig {
  profile: "core" | "expanded" | "custom";
  delivery: "skills" | "commands" | "both";
  workflows: string[];
}

/**
 * Canonical workflow sets per profile, shared by client + server.
 * `core` mirrors the openspec CLI preset; `expanded` is the full set
 * (no CLI preset exists for it — written as JSON).
 * See change: add-openspec-profile-settings.
 */
export const CORE_WORKFLOWS: readonly string[] = [
  "propose", "explore", "apply", "archive",
];

export const EXPANDED_WORKFLOWS: readonly string[] = [
  "propose", "explore", "new", "continue", "ff",
  "apply", "verify", "sync", "archive", "bulk-archive", "onboard",
];

/** Default config used as fallback when fetch fails or hasn't arrived yet.
 *  Assumes the full expanded set so no UI disappears unexpectedly. */
export const DEFAULT_OPENSPEC_CONFIG: OpenSpecConfig = {
  profile: "custom",
  delivery: "both",
  workflows: [
    "explore", "propose", "new", "continue", "ff",
    "apply", "verify", "sync", "archive",
    "bulk-archive", "onboard",
  ],
};

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
  /**
   * `openspec list` returned authoritative data for this cwd. Requires both
   * `<cwd>/openspec/` AND `<cwd>/openspec/changes/` to exist AND the CLI to
   * succeed. Does NOT distinguish "openspec project, no changes yet" from
   * "truly not an openspec project" — see `hasOpenspecDir` for that.
   */
  initialized: boolean;
  changes: OpenSpecChange[];
  /**
   * Cold-boot signaling: server has detected `openspec/changes/` for this
   * cwd but the slow poll has not yet produced authoritative data.
   *
   * Optional for backwards compatibility — absence means `false`. Composes
   * with `initialized` to encode three states:
   *   - { initialized: false, pending: false } → no openspec dir
   *   - { initialized: false, pending: true  } → dir exists, polling
   *   - { initialized: true,  pending: ?     } → poll complete
   *
   * See change: fix-cold-boot-openspec-protocol.
   */
  pending?: boolean;
  /**
   * Whether `<cwd>/openspec/` directory exists. Strictly weaker than
   * `initialized`: this can be `true` while `initialized` is `false` when
   * the project is OpenSpec-initialized (`openspec init` was run) but
   * `openspec/changes/` doesn't exist yet (no proposals authored). In that
   * case `openspec list` errors out and `initialized` stays `false`, but
   * the session card should still show the OPENSPEC subcard as an
   * init/attach affordance.
   *
   * Optional for backwards compatibility — absence means "unknown, fall
   * back to `initialized || pending`" on the client side.
   *
   * See change: auto-hide-empty-session-subcards.
   */
  hasOpenspecDir?: boolean;
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

/**
 * Structured error payload emitted when a registry-resolved tool is
 * missing at spawn time. Carries only the tool name; the client fetches
 * live install hints via /api/tools and renders an inline error with a
 * deep-link into Settings → Tools.
 * See change: register-bash-and-tool-install-help.
 */
export interface MissingToolError {
  kind: "missing-tool";
  toolName: string;
}

/** Data payload for bash_output dashboard events */
export interface BashOutputData {
  command: string;
  output: string;
  exitCode: number;
  /** true for !! (silent), false for ! (sent to LLM) */
  excludeFromContext: boolean;
  /**
   * Set to "slash-exec" when the output originates from an executable-mode
   * slash template (`executable: bash` frontmatter). The client renders an
   * "ℹ ran locally — LLM not invoked" footer for this source. Absent for
   * `!` / `!!` invocations — additive, backward-compatible (older clients
   * ignore the field and render no footer).
   * See change: add-dashboard-slash-commands.
   */
  source?: "slash-exec";
  /**
   * Set when the shell binary could not be resolved (e.g. no bash on a
   * clean Windows host). The client renders MissingToolInlineError
   * instead of plain output; no command actually ran.
   * See change: register-bash-and-tool-install-help.
   */
  missingTool?: MissingToolError;
}

/** Data payload for inline_terminal_open dashboard events.
 *  Fixes the inline terminal card's durable position in the chat stream so
 *  it is reconstructed on reload via event replay.
 *  See change: add-inline-terminal-card. */
export interface InlineTerminalOpenData {
  /** The ephemeral PTY's terminal id (reattach via /ws/terminal/:id). */
  terminalId: string;
}

/** Data payload for inline_terminal_close dashboard events.
 *  Freezes the card to a read-only scrollable transcript on close.
 *  See change: add-inline-terminal-card. */
export interface InlineTerminalCloseData {
  /** The closed terminal's id. */
  terminalId: string;
  /** Captured final scrollback transcript. */
  transcript: string;
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

/** First-class node-kind discriminator emitted by every pi-flows executor.
 *  Decided once at the node's started event; carried on the event payload so it
 *  persists + replays. Distinct from FlowDetailEntry.kind (text|thinking|tool|error).
 *  See change: rework-flows-plugin-for-new-pi-flows (consumes pi-flows surface-node-kind). */
export type NodeKind =
  | "agent"
  | "agent-decision"
  | "code"
  | "code-decision"
  | "fork";

/** Per-agent (per-step) state tracked in flow state */
export interface FlowAgentState {
  agentName: string;
  stepId: string;
  /** Step type from the flow config (agent, fork, agent-decision, etc.) */
  stepType?: string;
  /** Node-kind from the lifecycle started event; selects the card renderer. */
  nodeKind?: NodeKind;
  /** Failure outcome from the completion event: routed-soft vs flow-halting-hard. */
  outcome?: "success" | "soft" | "hard";
  /** Typed outputs from the completion event (code/agent contract). */
  typedOutputs?: Record<string, string>;
  /** Chosen branch label for code-decision / agent-decision nodes. */
  branch?: string;
  /** Resolved handler target path for code / code-decision nodes (from started). */
  codeTarget?: string;
  status: FlowAgentStatus;
  label?: string;
  model?: string;
  resolvedModel?: string;
  cardRole?: string;
  blockedBy: string[];
  tokens?: { input: number; output: number };
  /** Accumulated per-agent USD cost from `flow_agent_complete` (`result.cost`).
   *  Sibling of `tokens`; `undefined` when the session predates cost surfacing. */
  cost?: number;
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

/** Overall flow execution status. `interrupted` = orphaned run reconciled on resume
 *  (pi-flows clear-orphaned synthesized terminal). */
export type FlowStatus = "running" | "success" | "error" | "aborted" | "interrupted";

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
   *  Includes non-agent steps (fork, agent-decision, code-decision). `branches`
   *  carries decision routing (label → target) emitted by `flow:flow-started`. */
  dagSteps?: Array<{ id: string; stepType: string; agent?: string; blockedBy: string[]; branches?: Record<string, string>; onComplete?: string; onError?: string }>;
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
  stepType?: "agent" | "fork" | "conditional" | "agent-decision" | "agent-loop-decision";
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
  /**
   * Optional structured failure-classifier code paired with `error`.
   * Lets clients render specific UI for known failure modes
   * (e.g., `"FORK_EMPTY_SESSION"`).
   * See change: fix-fork-empty-session-silent-timeout.
   */
  code?: string;
  /**
   * Optional captured stderr from a shelled-out command (e.g. `git
   * worktree add`). Surfaced verbatim so the client can render the
   * git error inline in dialogs. See change: add-worktree-spawn-dialog.
   */
  stderr?: string;
  /**
   * Set on `POST /api/git/worktree` responses whose `code === "path_exists"`.
   * `true` when the colliding path exists on disk but is NOT a registered
   * worktree (likely orphan from a previous failed attempt); `false` when
   * the path IS a registered worktree. Undefined for non-`path_exists`
   * errors. Drives the dialog's inline `[Clean up]` button.
   * See change: openspec-worktree-spawn-button.
   */
  orphanLikely?: boolean;
}

/**
 * Target for a dashboard-local `/view` preview. Discriminated by `kind`.
 * - `file`: a path inside a known session cwd (anti-traversal enforced by the
 *   server when the file is served).
 * - `url`: an absolute `http(s)://` URL (renderer dispatch picks YouTube
 *   embed vs. fallback "open in new tab").
 * Persisted on a `ChatMessage` as the optional `view` field. Filtered out
 * of the pi-bound message stream by the bridge — view rows are a UI-only
 * artifact and never reach the agent. See change: render-file-previews.
 */
export type ViewTarget =
  | { kind: "file"; cwd: string; path: string }
  | { kind: "url"; url: string };
