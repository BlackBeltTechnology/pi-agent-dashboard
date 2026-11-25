/**
 * Pure builders for the REST read views (`shared/snapshot.ts`): a bounded mail
 * list, derived `blocked`, counters and the `persist_degraded` flag. Internal
 * fields (spawn token, session file, principal owner, policy hash) are never
 * copied.
 * See change: add-agent-teams-core.
 */
import { SNAPSHOT_MAIL_LIMIT, SNAPSHOT_MAIL_TEXT_MAX } from "../shared/constants.js";
import type { SnapshotMail, SnapshotMember, SnapshotStats, SnapshotTask, TeamListResponse, TeamSnapshot, TeamSummary } from "../shared/snapshot.js";
import { codePointLength, truncateCodePoints } from "../shared/text.js";
import type { Mail, Member, Task, Team } from "../shared/types.js";
import type { TeamStore } from "./store.js";
import type { Telemetry } from "./telemetry.js";

function summaryOf(store: TeamStore, team: Team): TeamSummary {
  return {
    id: team.id,
    name: team.name,
    status: team.status,
    leadConnected: team.leadConnected,
    members: team.members.length,
    tasks: team.tasks.length,
    rev: store.rev(team.id),
    createdAt: team.createdAt,
  };
}

export function listOf(store: TeamStore, visible: readonly Team[]): TeamListResponse {
  return {
    teams: visible.map((t) => summaryOf(store, t)),
    unavailable: store.unavailableTeams.map((u) => ({ id: u.id, reason: u.reason })),
    persist_degraded: store.persistDegraded,
  };
}

function memberView(m: Member): SnapshotMember {
  return {
    name: m.name,
    ...(m.role !== undefined ? { role: m.role } : {}),
    ...(m.sessionId !== undefined ? { sessionId: m.sessionId } : {}),
    cwd: m.cwd,
    ...(m.model !== undefined ? { model: m.model } : {}),
    status: m.status,
    ...(m.goneReason !== undefined ? { goneReason: m.goneReason } : {}),
    ...(m.degraded !== undefined ? { degraded: m.degraded } : {}),
    ...(m.hold !== undefined ? { hold: m.hold } : {}),
    ...(m.committer !== undefined ? { committer: m.committer } : {}),
  };
}

function taskView(store: TeamStore, team: Team, t: Task): SnapshotTask {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    ...(t.owner !== undefined ? { owner: t.owner } : {}),
    blockedBy: [...t.blockedBy],
    blocked: store.isBlocked(team, t),
    ...(t.result !== undefined ? { result: t.result } : {}),
    createdBy: t.createdBy,
    createdAt: t.createdAt,
    ...(t.claimedAt !== undefined ? { claimedAt: t.claimedAt } : {}),
    ...(t.completedAt !== undefined ? { completedAt: t.completedAt } : {}),
    ...(t.note !== undefined ? { note: t.note } : {}),
  };
}

function mailView(m: Mail): SnapshotMail {
  const truncated = m.text.length > SNAPSHOT_MAIL_TEXT_MAX && codePointLength(m.text) > SNAPSHOT_MAIL_TEXT_MAX;
  return {
    id: m.id,
    from: m.from,
    to: m.to,
    kind: m.kind,
    text: truncated ? truncateCodePoints(m.text, SNAPSHOT_MAIL_TEXT_MAX) : m.text,
    truncated,
    priority: m.priority,
    wake: m.wake,
    createdAt: m.createdAt,
    ...(m.ackedAt !== undefined ? { ackedAt: m.ackedAt } : {}),
  };
}

export function snapshotOf(store: TeamStore, telemetry: Telemetry, team: Team): TeamSnapshot {
  const log = store.mailLog(team.id);
  const stats: SnapshotStats = { ...telemetry.stats(team.id) };
  return {
    id: team.id,
    name: team.name,
    ...(team.description !== undefined ? { description: team.description } : {}),
    status: team.status,
    ...(team.closeReason !== undefined ? { closeReason: team.closeReason } : {}),
    mode: team.mode,
    committer: team.committer,
    leadConnected: team.leadConnected,
    leadCwd: team.leadCwd,
    rev: store.rev(team.id),
    createdAt: team.createdAt,
    ...(team.orphanedAt !== undefined ? { orphanedAt: team.orphanedAt } : {}),
    ...(team.closedAt !== undefined ? { closedAt: team.closedAt } : {}),
    members: team.members.map(memberView),
    tasks: team.tasks.map((t) => taskView(store, team, t)),
    mail: log.slice(-SNAPSHOT_MAIL_LIMIT).map(mailView),
    mailTotal: log.length,
    stats,
    persist_degraded: store.persistDegraded,
  };
}
