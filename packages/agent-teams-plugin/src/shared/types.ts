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

export type MemberDegraded = "team_tools_unavailable" | "guard_unavailable" | "guard_mismatch" | (string & {});

export type TaskStatus = "pending" | "in_progress" | "completed";

export type MailPriority = "normal" | "urgent";

export type Committer = "lead" | "member";

export interface TeamOverrides {
  autoDispatch?: boolean;
  notifyCoalesceMs?: number;
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
  guardActive: boolean;
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
