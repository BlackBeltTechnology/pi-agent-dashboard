/**
 * Pure helpers of the Team view's in-process touch points: the subagent-view route of a member, its
 * slot-queue position and the header's parallelism bound. Defensive by design: a malformed server
 * value (0, negative, fractional, non-numeric) yields `undefined`, never a nonsense label.
 * See change: add-agent-teams-in-process (tasks 10.1–10.2).
 */
import type { SnapshotMember, TeamSnapshot } from "../shared/snapshot.js";

const positiveInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;

/** `/session/:leadSession/subagent/:agentId` (the route of the subagents popout), or `undefined` when either id is missing. */
export function subagentHref(parentSessionId: string | undefined, childAgentId: string | undefined): string | undefined {
  if (!parentSessionId || !childAgentId) return undefined;
  return `/session/${encodeURIComponent(parentSessionId)}/subagent/${encodeURIComponent(childAgentId)}`;
}

/** 1-based slot-queue position of a member still `spawning`; otherwise `undefined`. */
export function queuePositionOf(m: Pick<SnapshotMember, "status" | "queuePosition">): number | undefined {
  return m.status === "spawning" && positiveInt(m.queuePosition) ? m.queuePosition : undefined;
}

/** The parallelism bound to state in the header: `maxConcurrent` when `maxTeammates` exceeds it (in-process teams only). */
export function parallelBound(snap: Pick<TeamSnapshot, "maxTeammates" | "maxConcurrent">): number | undefined {
  const { maxTeammates, maxConcurrent } = snap;
  return positiveInt(maxTeammates) && positiveInt(maxConcurrent) && maxTeammates > maxConcurrent ? maxConcurrent : undefined;
}
