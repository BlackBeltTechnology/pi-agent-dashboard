/**
 * Client test fixtures: a typed `TeamUiSnapshot` builder with the usual fields.
 * See change: add-agent-teams-ui.
 */
import type { MemberStatus, TaskStatus, TeamStatus } from "../../shared/types.js";
import type { TeamUiSnapshot } from "../../shared/ui-protocol.js";

export interface SnapshotSpec {
  id?: string;
  epoch?: string;
  rev?: number;
  status?: TeamStatus;
  members?: Array<[name: string, status: MemberStatus]>;
  tasks?: Array<[id: string, status: TaskStatus]>;
  viewerCanControl?: boolean;
}

export function makeSnapshot(spec: SnapshotSpec = {}): TeamUiSnapshot {
  const { id = "t1", epoch = "E", rev = 1, status = "active", members = [["alice", "idle"]], tasks = [["3", "in_progress"]], viewerCanControl = true } = spec;
  return {
    id,
    name: "SECRET-7f3a team",
    status,
    mode: "default",
    committer: "lead",
    leadConnected: true,
    leadCwd: "/w",
    rev,
    createdAt: 0,
    epoch,
    viewerCanControl,
    mailTotal: 1,
    mail: [{ id: 1, from: "alice", to: "lead", kind: "message", text: "SECRET-7f3a mail text", truncated: false, priority: "normal", wake: true, createdAt: 1 }],
    members: members.map(([name, st]) => ({ name, cwd: "/w", status: st })),
    tasks: tasks.map(([tid, st]) => ({ id: tid, title: "SECRET-7f3a title", description: "", status: st, blockedBy: [], blocked: false, createdBy: "lead", createdAt: 0 })),
    stats: { spawns: 0, claims: 0, claimConflicts: 0, deliveries: 0, queued: 0, urgentAborts: 0, rateLimited: 0 },
    persist_degraded: false,
  };
}
