/**
 * Bridge ↔ server protocol (task 2.1, design D3/D5/D7): the request-lane type
 * names, the tool/op table, stable error codes, event and report payloads, the
 * mail-event payload and the single `TEAM_TOOLS_BY_ROLE` table that later
 * changes extend. The caller is identified by the lane socket's `sessionId`,
 * never by a field defined here.
 * See change: add-agent-teams-core.
 */
import type { Committer, Mail, MailPriority, Task, TaskStatus } from "./types.js";

/** Request-lane message types (`agent-teams/<type>`). One call type + four lifecycle types. */
export const LANE_CALL = "agent-teams/call";
export const LANE_HELLO = "agent-teams/hello";
export const LANE_BUSY = "agent-teams/busy";
export const LANE_IDLE = "agent-teams/idle";
export const LANE_ACK = "agent-teams/ack";
export const LANE_TYPES = [LANE_CALL, LANE_HELLO, LANE_BUSY, LANE_IDLE, LANE_ACK] as const;

/** Every agent tool is a thin client of `agent-teams/call {op, args}`. */
export const TEAM_OPS = [
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
export type TeamOp = (typeof TEAM_OPS)[number];

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
  ],
  member: [...TASK_TOOLS, "SendMessage", "TeamStatus", "ShutdownResponse"],
};

/** Ops only the lead may call: a teammate gets `not_lead` before the op runs (nested teams are impossible). */
export const LEAD_ONLY_OPS: readonly TeamOp[] = ["TeammateSpawn", "ShutdownRequest", "TeamDelete"];

/** Tools a session gains when it becomes lead and loses when its team closes. */
export const LEAD_ONLY_TOOLS: readonly TeamOp[] = TEAM_TOOLS_BY_ROLE.lead.filter(
  (t) => !TEAM_TOOLS_BY_ROLE.plain.includes(t),
);

/** Stable lowercase error codes surfaced as `details.error` (design "Tool contract"). */
export const ERROR_CODES = [
  "already_in_team",
  "already_claimed",
  "blocked",
  "broadcast_lead_only",
  "cwd_outside_lead",
  "dependency_cycle",
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
  "rate_limited",
  "reason_required",
  "self_message",
  "skill_not_found",
  "skill_resolution_unavailable",
  "task_cap_reached",
  "team_cap_reached",
  "team_closed",
  "team_full",
  "unknown_dependency",
  "unknown_op",
  "unknown_owner",
  "unknown_recipient",
  "unknown_task",
  "urgent_lead_only",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

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
}
export interface TeammateSpawnResult {
  member: string;
  status: "spawning";
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

// ── Lifecycle reports (hello / busy / idle / ack) ──────────────────────────────

export interface HelloPayload {
  isIdle: boolean;
  toolsActive: boolean;
  guardActive: boolean;
  policyHash?: string;
  confined: boolean;
  sessionFile?: string;
}
export interface HelloReply {
  role: TeamRole;
  teamId?: string;
  member?: string;
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
}

export const ENV_PREFIX = "PI_EXT_AGENT_TEAMS_";
