/**
 * Bridge ↔ server protocol (task 2.1, design D3/D5/D7): the request-lane type
 * names, the tool/op table, stable error codes, event and report payloads, the
 * mail-event payload and the single `TEAM_TOOLS_BY_ROLE` table that later
 * changes extend. The caller is identified by the lane socket's `sessionId`,
 * never by a field defined here.
 * See change: add-agent-teams-core.
 */
import type { Committer, Mail, MailPriority, PlanApprovalPolicy, Task, TaskStatus } from "./types.js";

/** Request-lane message types (`agent-teams/<type>`). One call type + four lifecycle types. */
export const LANE_CALL = "agent-teams/call";
export const LANE_HELLO = "agent-teams/hello";
export const LANE_BUSY = "agent-teams/busy";
export const LANE_IDLE = "agent-teams/idle";
export const LANE_ACK = "agent-teams/ack";
export const LANE_TYPES = [LANE_CALL, LANE_HELLO, LANE_BUSY, LANE_IDLE, LANE_ACK] as const;

/** The eleven core agent tools: each has one `tool-renderer` claim (`client/tool-families.ts`). */
export const CORE_TEAM_OPS = [
  "TeamCreate",
  "TeammateSpawn",
  "SendMessage",
  "TaskCreate",
  "TaskList",
  "TaskGet",
  "TaskUpdate",
  "TeamStatus",
  "ShutdownRequest",
  "ShutdownResponse",
  "TeamDelete",
] as const;
export type CoreTeamOp = (typeof CORE_TEAM_OPS)[number];

/** Plan-approval tools (templates-hooks change): generic host tool row, no renderer claim in v1. */
export const PLAN_OPS = ["PlanSubmit", "PlanDecision"] as const;
export type PlanOp = (typeof PLAN_OPS)[number];

/** Every agent tool is a thin client of `agent-teams/call {op, args}`. */
export const TEAM_OPS = [...CORE_TEAM_OPS, ...PLAN_OPS] as const;
export type TeamOp = (typeof TEAM_OPS)[number];

/**
 * Server-side start ops carried by `agent-teams/call` from bridge code only
 * (`/agent-team` command): NOT agent tools, so never in `TEAM_OPS`, never in
 * `TEAM_TOOLS_BY_ROLE` (a prompt-injected lead must not be able to start templates).
 */
export const START_OPS = ["team.start", "team.templates"] as const;
export type StartOp = (typeof START_OPS)[number];

export function isStartOp(value: unknown): value is StartOp {
  return typeof value === "string" && (START_OPS as readonly string[]).includes(value);
}

export function isTeamOp(value: unknown): value is TeamOp {
  return typeof value === "string" && (TEAM_OPS as readonly string[]).includes(value);
}

/** Roles the bridge registers tools for. `member` is the teammate role. */
export type TeamRole = "plain" | "lead" | "member";

const TASK_TOOLS = ["TaskCreate", "TaskList", "TaskGet", "TaskUpdate"] as const satisfies readonly TeamOp[];

/**
 * The single role → tool table. Lists are MINIMUMS later changes extend. A lead
 * keeps the plain tools registered (`TeamCreate` answers `already_in_team`); the
 * lead-only tools are `LEAD_ONLY_TOOLS`. A teammate has no `TeamCreate`,
 * `TeammateSpawn`, `ShutdownRequest` or `TeamDelete`: nested teams are
 * structurally impossible.
 */
export const TEAM_TOOLS_BY_ROLE: Record<TeamRole, readonly TeamOp[]> = {
  plain: ["TeamCreate", "TeammateSpawn"],
  lead: [
    "TeamCreate",
    "TeammateSpawn",
    ...TASK_TOOLS,
    "SendMessage",
    "TeamStatus",
    "ShutdownRequest",
    "TeamDelete",
    "PlanDecision",
  ],
  member: [...TASK_TOOLS, "SendMessage", "TeamStatus", "ShutdownResponse", "PlanSubmit"],
};

/** Ops only the lead may call: a teammate gets `not_lead` before the op runs (nested teams are impossible). */
export const LEAD_ONLY_OPS: readonly TeamOp[] = ["TeammateSpawn", "ShutdownRequest", "TeamDelete", "PlanDecision"];

/** Tools a session gains when it becomes lead and loses when its team closes. */
export const LEAD_ONLY_TOOLS: readonly TeamOp[] = TEAM_TOOLS_BY_ROLE.lead.filter(
  (t) => !TEAM_TOOLS_BY_ROLE.plain.includes(t),
);

/** Stable lowercase error codes surfaced as `details.error` (design "Tool contract"). */
export const ERROR_CODES = [
  "agent_invalid",
  "agent_not_found",
  "agent_untrusted",
  "already_decided",
  "already_in_team",
  "already_claimed",
  "blocked",
  "broadcast_lead_only",
  "cwd_outside_lead",
  "cwd_outside_scope",
  "cwd_required",
  "delivery_timeout",
  "dependency_cycle",
  "emit_refused",
  "forbidden",
  "hash_mismatch",
  "hook_blocked",
  "hooks_untrusted",
  "interrupt_unavailable",
  "invalid_args",
  "invalid_transition",
  "kind_reserved",
  "lead_confined",
  "member_degraded",
  "member_gone",
  "members_active",
  "message_too_long",
  "mode_unavailable",
  "name_reserved",
  "name_taken",
  "nested_team_forbidden",
  "no_handler",
  "no_pending_request",
  "not_in_team",
  "not_lead",
  "not_owner",
  "nothing_to_resume",
  "op_blocked",
  "origin_denied",
  "owner_locked",
  "owner_not_lead",
  "plan_not_required",
  "playbook_too_long",
  "project_untrusted",
  "rate_limited",
  "prompt_file_unreadable",
  "reason_required",
  "resume_unsupported_in_process",
  "self_message",
  "skill_not_found",
  "skill_resolution_unavailable",
  "skills_outside_template",
  "skills_unavailable_in_process",
  "spawn_timeout",
  "spawn_vetoed",
  "subagents_extension_missing",
  "subagents_extension_outdated",
  "task_cap_reached",
  "team_cap_reached",
  "team_closed",
  "team_full",
  "template_invalid",
  "template_not_found",
  "tools_outside_template",
  "unknown_dependency",
  "unknown_op",
  "unknown_owner",
  "unknown_plan",
  "unknown_recipient",
  "unknown_task",
  "urgent_lead_only",
  "user_decision_required",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Stable codes a template or agent file is LISTED invalid with (`team.templates`, never an op
 * error: `team.start` on such a template answers `template_invalid` with these in `details`).
 * `name_reserved` and `mode_unavailable` are shared with `ERROR_CODES`.
 */
export const TEMPLATE_ERROR_CODES = [
  "duplicate_member",
  "field_invalid",
  "frontmatter_invalid",
  "hook_command_too_long",
  "mode_unavailable",
  "name_invalid",
  "name_mismatch",
  "name_reserved",
  "notify_out_of_range",
  "outside_source_dir",
  "playbook_too_long",
  "roster_exceeds_max",
  "roster_name_invalid",
  "template_too_large",
  "too_many_hooks",
] as const;
export type TemplateErrorCode = (typeof TEMPLATE_ERROR_CODES)[number];

/** Feedback tokens a `hook_blocked` call carries when a hook did not run to a verdict (not error codes). */
export const HOOK_FEEDBACK_CODES = ["hook_busy", "hook_pending"] as const;
export type HookFeedbackCode = (typeof HOOK_FEEDBACK_CODES)[number];
/** Op result envelope returned by the lane handlers. */
export type OpResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ErrorCode; message?: string; details?: Record<string, unknown> };

export interface CallRequest {
  op: string;
  args?: unknown;
}

// ── Tool args / results implemented by the core lifecycle (tasks 3.x) ──────────

export interface TeamCreateArgs {
  name: string;
  description?: string;
  maxTeammates?: number;
  skills?: string[];
  tools?: string[];
  mode?: string;
}
export interface TeamCreateResult {
  teamId: string;
  name: string;
  limits: { maxTeammates: number; maxTasks: number };
  role: "lead";
}

export interface TeammateSpawnArgs {
  name: string;
  prompt: string;
  role?: string;
  model?: string;
  cwd?: string;
  tools?: string[];
  skills?: string[];
  noMcp?: boolean;
  noContextFiles?: boolean;
  resume?: boolean;
  /** Teammate type (`.pi/agents/<agent>.md`); resolved by the templates-hooks change. */
  agent?: string;
  /** Plan-approval policy; may only strengthen a template floor (`false → true → "user"`). */
  requirePlanApproval?: PlanApprovalPolicy;
}
export interface TeammateSpawnResult {
  member: string;
  status: "spawning";
  /** In-process: the parallelism bound and the shared subagents slot pool, present when `maxTeammates` exceeds `maxConcurrent`. */
  note?: string;
}

export interface TeamStatusResult {
  team: { id: string; name: string; status: string; mode: string };
  members: Array<{ name: string; status: string; role?: string; taskIds: string[]; degraded?: string }>;
  counts: { members: number; tasks: { pending: number; in_progress: number; completed: number } };
}

export interface TeamDeleteArgs {
  force?: boolean;
}
export interface TeamDeleteResult {
  closed: true;
  shutdown: string[];
}

// ── Task list ops (tasks 4.x) ─────────────────────────────────────────────────

/** A task as returned to agents: the stored fields plus the DERIVED `blocked` / `claimable` flags. */
export interface TaskView extends Task {
  blocked: boolean;
  claimable: boolean;
}

export interface TaskDependency {
  id: string;
  title: string;
  status: TaskStatus;
  result?: string;
}

export interface TaskCreateArgs {
  title: string;
  description?: string;
  blockedBy?: string[];
  owner?: string;
}
export interface TaskCreateResult {
  task: TaskView;
}

export interface TaskListArgs {
  status?: TaskStatus;
  owner?: string;
  includeCompleted?: boolean;
}
export interface TaskListResult {
  tasks: TaskView[];
}

export interface TaskGetResult {
  task: TaskView;
  dependencies: TaskDependency[];
}

export interface TaskUpdateArgs {
  id: string;
  status?: TaskStatus;
  owner?: string | null;
  title?: string;
  description?: string;
  addBlockedBy?: string[];
  result?: string;
}
export interface TaskUpdateResult {
  task: TaskView;
  unblocked: string[];
  /** Present on a claim, as in `TaskGet`. */
  dependencies?: TaskDependency[];
}

// ── Messaging and shutdown ops (tasks 6.x / 7.x) ──────────────────────────────

export interface SendMessageArgs {
  to: string;
  message: string;
  summary?: string;
  priority?: MailPriority;
}
export interface SendMessageResult {
  mailIds: number[];
  delivered: string[];
  queued: string[];
  /** `urgent_as_steer` when the interrupt was unavailable and the mail went out as a normal steer. */
  degraded?: "urgent_as_steer";
  /** Text warning that goes with `degraded` (in-process: the interrupt feature is missing, the mail was only steered). */
  warning?: string;
}

export interface ShutdownRequestArgs {
  to: string;
  reason?: string;
}
export interface ShutdownResponseArgs {
  approve: boolean;
  reason?: string;
}
export interface ShutdownResponseResult {
  approved: boolean;
}

// ── Plan approval tools (templates-hooks change) ───────────────────────────────

export interface PlanSubmitArgs {
  plan: string;
}
export interface PlanSubmitResult {
  planId: string;
  status: "pending";
}
export interface PlanDecisionArgs {
  member: string;
  planId: string;
  approve: boolean;
  feedback?: string;
}
export interface PlanDecisionResult {
  planId: string;
  member: string;
  status: "approved" | "rejected";
}

// ── Template start ops (`team.start` / `team.templates`, bridge + REST callers only) ──

export type TemplateSource = "user" | "project" | "bundled";

/** One validation finding on a template: stable code plus the YAML path for `field_invalid`. */
export interface TemplateIssue {
  code: TemplateErrorCode | string;
  path?: string;
  message?: string;
}

export interface TemplateSummary {
  name: string;
  source: TemplateSource;
  description?: string;
  /** False for an untrusted project template (listed by stem only, never read). */
  trusted: boolean;
  /** `false` when `errors` is non-empty: listed but not startable. */
  valid: boolean;
  errors: TemplateIssue[];
  warnings: TemplateIssue[];
  /** Resolved mode (reflects the calling lead when known). */
  mode?: string;
  members?: Array<{ name: string; agent?: string }>;
  /** Whether the template declares hooks (commands are only shown in a `hooks_untrusted` answer). */
  hasHooks?: boolean;
}

export interface TeamTemplatesArgs {
  /** REST only; the lane payload never carries a cwd (it comes from the host session record). */
  cwd?: string;
}
export interface TeamTemplatesResult {
  templates: TemplateSummary[];
  warnings?: string[];
}

export interface TeamStartArgs {
  template: string;
  goal: string;
  /** The hash the user was shown in a prior `hooks_untrusted` answer. */
  trustHooks?: string;
}
/** Details of a `hooks_untrusted` answer. */
export interface HooksUntrustedDetails {
  hash: string;
  commands: Array<{ event: string; command: string; timeoutMs?: number }>;
}
export interface TeamStartResult {
  teamId: string;
  name: string;
  role: "lead";
  /** Rendered playbook text (command path: the bridge delivers it; REST path: sent as a `playbook` mail). */
  playbook?: string;
  /** Command path only: the template's `lead.model`, which does not apply (the session keeps its model); the bridge reports it once. */
  leadModelIgnored?: string;
  limits: { maxTeammates: number; maxTasks: number };
}

// ── Lifecycle reports (hello / busy / idle / ack) ──────────────────────────────

export interface HelloPayload {
  isIdle: boolean;
  toolsActive: boolean;
  guardActive: boolean;
  policyHash?: string;
  confined: boolean;
  sessionFile?: string;
  /**
   * Plan-mode members only: `true` when the bridge narrowed its tools and `PlanSubmit` is active.
   * Absent for a session not in plan mode. Read by the plans hello contributor (`planToolsActive === false`
   * on a plan-mode member ⇒ `degraded:"plan_tools_unavailable"`).
   */
  planToolsActive?: boolean;
}
/** Authoritative plan-mode state in the `hello` reply (design D8); the bridge never trusts a local snapshot. */
export interface PlanModeState {
  active: boolean;
  /** Tools to re-activate (with the registered team tools) once `active` is false. */
  restoreTools: string[];
}
export interface HelloReply {
  role: TeamRole;
  teamId?: string;
  member?: string;
  /** Present for a member whose plan approval is in play. */
  planMode?: PlanModeState;
}

export type BusyPayload = Record<string, never>;

export interface IdlePayload {
  settleId: number;
  finalText?: string;
  error?: string;
  aborted?: boolean;
}

export interface AckPayload {
  ids: number[];
}

// ── In-session mail event ──────────────────────────────────────────────────────

/** One mail as handed to the bridge listener over `agent-teams:mail`. */
export interface WireMail {
  id: number;
  from: string;
  to: string;
  kind: string;
  text: string;
  priority: MailPriority;
  wake: boolean;
  createdAt: number;
  details?: Record<string, unknown>;
}

export interface MailEventPayload {
  mails: WireMail[];
}

export function toWireMail(mail: Mail): WireMail {
  const { id, from, to, kind, text, priority, wake, createdAt, details } = mail;
  const wire: WireMail = { id, from, to, kind, text, priority, wake, createdAt };
  if (details !== undefined) wire.details = details;
  return wire;
}

// ── Env hint (`extensionConfig` → `PI_EXT_AGENT_TEAMS_*`) ──────────────────────

/** Spawn-time env hint: only selects the bridge's tool set; the server stays authoritative. */
export interface TeamEnvHint {
  teamId?: string;
  member?: string;
  policy?: string;
  committer?: Committer;
  /** `"1"` while the member is in plan mode (see `ENV_PLAN_MODE`). */
  planMode?: string;
}

export const ENV_PREFIX = "PI_EXT_AGENT_TEAMS_";
