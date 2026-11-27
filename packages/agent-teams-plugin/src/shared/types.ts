/**
 * Team / member / task / mail data model (task 2.2). `Team` is the persisted
 * shape (`schemaVersion: 1`); the mail log is stored separately
 * (`<teamId>.mail.jsonl`) and is therefore NOT a field of `Team`.
 * See change: add-agent-teams-core (design.md "Data model").
 */

export type TeamStatus = "starting" | "active" | "orphaned" | "closing" | "closed";

export type CloseReason =
  | "orphan_ttl"
  | "team_delete"
  | "user"
  | "lead_spawn_failed"
  | "lead_ended"
  | "lead_reloaded"
  | "mode_unavailable";

export type MemberStatus = "spawning" | "idle" | "busy" | "shutdown_pending" | "disconnected" | "gone" | "failed";

/** Terminal member statuses: the name is free for a fresh spawn. */
export const RELEASED_MEMBER_STATUSES: readonly MemberStatus[] = ["gone", "failed"];

export type MemberDegraded =
  | "team_tools_unavailable"
  | "guard_unavailable"
  | "guard_mismatch"
  | "plan_tools_unavailable"
  | (string & {});

export type TaskStatus = "pending" | "in_progress" | "completed";

export type MailPriority = "normal" | "urgent";

export type Committer = "lead" | "member";

export interface TeamOverrides {
  autoDispatch?: boolean;
  notifyCoalesceMs?: number;
}

// ── Templates, hooks and plan approval (add-agent-teams-templates-hooks) ───────
// Every field below is OPTIONAL and additive: `schemaVersion` stays 1, a core-only
// team file loads unchanged and an older loader ignores these keys.

/** Plan-approval policy: `false` none, `true` the lead decides, `"user"` only the user decides. */
export type PlanApprovalPolicy = boolean | "user";

/** Member plan state: `planning` (read-only, may submit) → `pending` (submitted) → `approved`; a rejection returns to `planning`. */
export type PlanApprovalState = "planning" | "pending" | "approved";

export type PlanStatus = "pending" | "approved" | "rejected" | "superseded" | "cancelled";

/** A stored plan (`Team.plans`, ids `p<N>` per team); pending plans are never dropped, oldest decided first. */
export interface PlanRequest {
  id: string;
  member: string;
  plan: string;
  status: PlanStatus;
  createdAt: number;
  decidedAt?: number;
  /** `lead` or a principal key; server-verified, never from message text. */
  decidedBy?: string;
  feedback?: string;
}

export type HookEvent = "TeammateIdle" | "TaskCreated" | "TaskCompleted";

export interface HookCommand {
  command: string;
  /** Effective per-command timeout (ms), already defaulted at start. */
  timeoutMs?: number;
}

/** Hooks frozen on the team at start; no op, tool or route edits them afterwards. */
export type TeamHooks = Partial<Record<HookEvent, HookCommand[]>>;

/** One validated, post-`count`-expansion template member (`{{goal}}`/`{{cwd}}` already substituted into `prompt`). */
export interface TemplateMember {
  name: string;
  agent?: string;
  role?: string;
  model?: string;
  /** Present ⇒ a ceiling a lead-supplied list is intersected with (`[]` allows no optional tool). */
  tools?: string[];
  skills?: string[];
  cwd?: string;
  requirePlanApproval?: PlanApprovalPolicy;
  prompt?: string;
}

/** Snapshot persisted at start; the only source for later spawns, resume and post-restart eager start. */
export interface TeamTemplateSnapshot {
  name: string;
  source: "user" | "project" | "bundled";
  /** SHA-256 of the template content (identity, not trust). */
  hash: string;
  goal: string;
  /** Rendered lead playbook text (body, goal, roster summary, notes). */
  playbook: string;
  members: TemplateMember[];
  /** `eager` (default) spawns the roster at bind; `lead` only lists it in the playbook. */
  spawn?: "eager" | "lead";
  /** Team default for members without their own policy; also the floor a spawn arg may only strengthen. */
  requirePlanApproval?: PlanApprovalPolicy;
  defaultModel?: string;
  /** Template-declared team defaults (ceiling when present). */
  defaultTools?: string[];
  defaultSkills?: string[];
  /** Model for a server-started lead (REST path); ignored on the command path. */
  lead?: { model?: string };
  /** Template `maxTeammates`: caps roster plus lead-spawned members. */
  maxTeammates?: number;
  /** Set (before it runs) once the registered start profile's `seed` ran: a restart never seeds twice. */
  seeded?: boolean;
}

export interface Member {
  name: string;
  role?: string;
  sessionId?: string;
  spawnToken: string;
  sessionFile?: string;
  cwd: string;
  model?: string;
  status: MemberStatus;
  goneReason?: string;
  degraded?: MemberDegraded;
  /** Member-level committer override (`TrustedSpawnOptions`); `Team.committer` stays `lead`. */
  committer?: Committer;
  /** Dispatch hold reason set by extensions. */
  hold?: string;
  /** Teammate type resolved at spawn (`.pi/agents/<agent>.md`). */
  agent?: string;
  /** Resolved plan-approval policy; `planApproval` is set only when it is `true` or `"user"`. */
  requirePlanApproval?: PlanApprovalPolicy;
  planApproval?: PlanApprovalState;
  guardActive: boolean;
  /** Hash of the spawn-time policy the member must report in `hello` (set by the spawn flow). */
  policyHash?: string;
  tools?: string[];
  skills?: string[];
  noMcp: boolean;
  noContextFiles: boolean;
  lastSettleId: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  owner?: string;
  blockedBy: string[];
  result?: string;
  createdBy: string;
  createdAt: number;
  claimedAt?: number;
  completedAt?: number;
  /** Launcher-owned (server actor): the owner is immutable for lead/teammate callers (`owner_locked`). */
  ownerLocked?: boolean;
  /** Why the task last returned to `pending` (member exit / failed spawn / approved shutdown); cleared on the next claim. */
  note?: string;
}

export interface Mail {
  id: number;
  from: string;
  to: string;
  kind: string;
  text: string;
  priority: MailPriority;
  wake: boolean;
  createdAt: number;
  ackedAt?: number;
  details?: Record<string, unknown>;
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  /** Unset while `status === "starting"` (lead not yet bound). */
  leadSessionId?: string;
  /** Whether the lead's socket is currently believed connected (false after a restart). */
  leadConnected: boolean;
  /** Stored explicitly at create/start, never re-derived. */
  leadCwd: string;
  mode: string;
  status: TeamStatus;
  closeReason?: CloseReason;
  committer: Committer;
  overrides?: TeamOverrides;
  /** createTeam owner (REST principal), else the lead's `principalOwner`. */
  owner?: string;
  maxTeammates: number;
  defaultSkills?: string[];
  defaultTools?: string[];
  /** Template snapshot (started from a template only). */
  template?: TeamTemplateSnapshot;
  /** Hooks frozen at start (template only; absent = none). */
  hooks?: TeamHooks;
  /** Stored plan requests, newest last, at most `MAX_STORED_PLANS`. */
  plans?: PlanRequest[];
  /** Spawn token of a server-started lead (abort-by-token at the bind deadline). */
  leadSpawnToken?: string;
  /** Epoch ms after which a still-`starting` team is closed `lead_spawn_failed`. */
  leadBindDeadline?: number;
  members: Member[];
  tasks: Task[];
  nextTaskId: number;
  nextMailId: number;
  createdAt: number;
  /** Set when the team enters `orphaned` (drives the TTL check). */
  orphanedAt?: number;
  /** Set when the team becomes `closed` (drives retention pruning). */
  closedAt?: number;
  schemaVersion: number;
}

/** `sessionId → binding` index entry (memory only, rebuilt on load). */
export interface SessionBinding {
  teamId: string;
  /** `"lead"` or a member name. */
  who: string;
}
