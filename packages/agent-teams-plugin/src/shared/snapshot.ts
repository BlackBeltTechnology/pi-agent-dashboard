/**
 * REST wire shapes (`GET /api/plugins/agent-teams/teams[/:id]`), shared so a
 * later UI change types its fetches against the server. Read-only views: no
 * spawn token, session file or principal owner ever appears here.
 * See change: add-agent-teams-core.
 */
import type { CloseReason, Committer, MailPriority, MemberStatus, TaskStatus, TeamStatus } from "./types.js";

/** Counters in the snapshot `stats` (numbers only; restart with the server). */
export interface SnapshotStats {
  spawns: number;
  claims: number;
  claimConflicts: number;
  deliveries: number;
  queued: number;
  urgentAborts: number;
  rateLimited: number;
  /**
   * Templates-hooks counters, present only once non-zero (a core-only team's `stats` keeps its seven keys):
   * template starts, hook outcomes and plan transitions. See change: add-agent-teams-templates-hooks.
   */
  templateStarts?: number;
  hook_runs?: number;
  hook_blocks?: number;
  hook_errors?: number;
  hook_timeouts?: number;
  hook_overflow?: number;
  hook_busy?: number;
  plansSubmitted?: number;
  plansApproved?: number;
  plansRejected?: number;
  plansCancelled?: number;
}

export interface TeamSummary {
  id: string;
  name: string;
  status: TeamStatus;
  leadConnected: boolean;
  /** The lead's session id (viewers that may see the team only); frames are scoped to it. */
  leadSessionId?: string;
  members: number;
  tasks: number;
  rev: number;
  createdAt: number;
}

/** A team file that could not be read (quarantined at load). */
interface UnavailableTeamView {
  id: string;
  reason: "corrupt" | "future";
}

export interface TeamListResponse {
  teams: TeamSummary[];
  unavailable: UnavailableTeamView[];
  persist_degraded: boolean;
}

export interface SnapshotMember {
  name: string;
  role?: string;
  sessionId?: string;
  cwd: string;
  model?: string;
  status: MemberStatus;
  goneReason?: string;
  degraded?: string;
  hold?: string;
  committer?: Committer;
}

export interface SnapshotTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  owner?: string;
  blockedBy: string[];
  /** Derived: an unfinished dependency remains. */
  blocked: boolean;
  result?: string;
  createdBy: string;
  createdAt: number;
  claimedAt?: number;
  completedAt?: number;
  note?: string;
}

export interface SnapshotMail {
  id: number;
  from: string;
  to: string;
  kind: string;
  /** At most `SNAPSHOT_MAIL_TEXT_MAX` characters. */
  text: string;
  truncated: boolean;
  priority: MailPriority;
  wake: boolean;
  createdAt: number;
  ackedAt?: number;
}

export interface TeamSnapshot {
  id: string;
  name: string;
  description?: string;
  status: TeamStatus;
  closeReason?: CloseReason;
  mode: string;
  committer: Committer;
  leadConnected: boolean;
  /** The lead's session id (viewers that may see the team only); frames are scoped to it. */
  leadSessionId?: string;
  leadCwd: string;
  rev: number;
  createdAt: number;
  orphanedAt?: number;
  closedAt?: number;
  members: SnapshotMember[];
  tasks: SnapshotTask[];
  /** The latest `SNAPSHOT_MAIL_LIMIT` entries, oldest first. */
  mail: SnapshotMail[];
  /** The real mail count (the list above is bounded). */
  mailTotal: number;
  stats: SnapshotStats;
  /** True after a failed team-file write until a later write succeeds. */
  persist_degraded: boolean;
}
