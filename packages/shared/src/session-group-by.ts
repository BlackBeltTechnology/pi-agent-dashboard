/**
 * Session-list Group-by vocabulary shared by server (preferences validation)
 * and client (lane partition). See change: session-list-group-by.
 */

export type GroupByMode = "none" | "status" | "location";

export type StatusLaneId = "needs-you" | "error" | "working" | "review" | "idle";
export type LocationLaneId = "main" | "worktrees";
export type LaneId = StatusLaneId | LocationLaneId;

export const GROUP_BY_MODES: readonly GroupByMode[] = ["none", "status", "location"];

/** Render order of status lanes (capsule segment order + review before idle). */
export const STATUS_LANE_ORDER: readonly StatusLaneId[] = ["needs-you", "error", "working", "review", "idle"];

export const LOCATION_LANE_ORDER: readonly LocationLaneId[] = ["main", "worktrees"];

const LANE_IDS: ReadonlySet<string> = new Set<string>([...STATUS_LANE_ORDER, ...LOCATION_LANE_ORDER]);

export function isGroupByMode(v: unknown): v is GroupByMode {
  return typeof v === "string" && (GROUP_BY_MODES as readonly string[]).includes(v);
}

export function isLaneId(v: unknown): v is LaneId {
  return typeof v === "string" && LANE_IDS.has(v);
}

/** Separator between a folder's canonical key and a lane id in `collapsedLanes`. */
export const LANE_KEY_SEPARATOR = "::";

export function laneCollapseKey(folderKey: string, lane: LaneId): string {
  return `${folderKey}${LANE_KEY_SEPARATOR}${lane}`;
}

/** Split a `<folderKey>::<lane>` entry; null when malformed or the lane id is unknown. */
export function parseLaneCollapseKey(entry: string): { folderKey: string; lane: LaneId } | null {
  const i = entry.lastIndexOf(LANE_KEY_SEPARATOR);
  if (i <= 0) return null;
  const lane = entry.slice(i + LANE_KEY_SEPARATOR.length);
  if (!isLaneId(lane)) return null;
  return { folderKey: entry.slice(0, i), lane };
}

/** Aggregate grouping preferences (server-owned, shared across browsers). */
export interface GroupByPrefs {
  defaultGroupBy: GroupByMode;
  folderGroupBy: Record<string, GroupByMode>;
  collapsedLanes: string[];
}
