/**
 * Pure lane logic for the session-list Group-by modes. The render pipeline
 * only consumes these outputs; lanes are a client-side view over the
 * unchanged stored session order (design D1).
 * See change: session-list-group-by.
 */
import {
  type GroupByMode,
  type GroupByPrefs,
  type LaneId,
  LOCATION_LANE_ORDER,
  type LocationLaneId,
  laneCollapseKey,
  STATUS_LANE_ORDER,
  type StatusLaneId,
} from "@blackbelt-technology/pi-dashboard-shared/session-group-by.js";
import { pathKey } from "@blackbelt-technology/pi-dashboard-shared/session-group-path.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { sortSessionsByOrder } from "./session-grouping.js";
import { deriveStatusShape } from "./session-status-visuals.js";

type Platform = NodeJS.Platform;

export interface StatusLaneFlags {
  hasError?: boolean;
  isRetrying?: boolean;
  hasWidgetBarPrompt?: boolean;
  hasNotice?: boolean;
}

/**
 * Status lane via `deriveStatusShape` so lanes, card shapes and the folder
 * capsule never disagree (design D2). `compacting` adds to `working`; an
 * unread idle session and a notice go to `review`. Ended → `null` (the ended
 * bucket owns it).
 */
export function classifyStatusLane(s: DashboardSession, flags: StatusLaneFlags = {}): StatusLaneId | null {
  if (s.status === "ended") return null;
  const shape = deriveStatusShape(s, flags);
  switch (shape) {
    case "error":
      return "error";
    case "needs-you":
      return "needs-you";
    case "working":
      return "working";
    case "notice":
      return "review";
    case "idle":
      if (s.compacting) return "working";
      return s.unread ? "review" : "idle";
    default:
      return null;
  }
}

export function classifyLocationLane(s: DashboardSession): LocationLaneId {
  return s.gitWorktree ? "worktrees" : "main";
}

export interface Lane {
  /** `null` for the single `none`-mode list. */
  laneId: LaneId | null;
  sessions: DashboardSession[];
}

/**
 * Split a folder's non-ended sessions into lanes, each a stable partition of
 * the stored order (`sortSessionsByOrder`). Empty lanes omitted. `none` ⇒ one
 * lane with `laneId: null`. `assign` overrides the default classifier (used
 * for hysteresis-adjusted assignments); returning `null` drops the session.
 */
export function partitionIntoLanes(
  sessions: DashboardSession[],
  mode: GroupByMode,
  order: string[] | undefined,
  assign?: (s: DashboardSession) => LaneId | null,
): Lane[] {
  if (mode === "none") return [{ laneId: null, sessions: sortSessionsByOrder(sessions, order) }];
  const laneOrder: readonly LaneId[] = mode === "status" ? STATUS_LANE_ORDER : LOCATION_LANE_ORDER;
  const classify = assign ?? (mode === "status" ? (s: DashboardSession) => classifyStatusLane(s) : classifyLocationLane);
  const buckets = new Map<LaneId, DashboardSession[]>();
  for (const s of sessions) {
    const lane = classify(s);
    if (lane === null) continue;
    const arr = buckets.get(lane);
    if (arr) arr.push(s);
    else buckets.set(lane, [s]);
  }
  const out: Lane[] = [];
  for (const laneId of laneOrder) {
    const members = buckets.get(laneId);
    if (members && members.length > 0) out.push({ laneId, sessions: sortSessionsByOrder(members, order) });
  }
  return out;
}

/**
 * Slot-preserving merge (design D4): the positions the lane's ids occupy in
 * `storedOrder` are refilled, in order, with `newLaneOrder`; every other id
 * keeps its position. Lane ids absent from the stored order are appended in
 * lane order.
 */
export function mergeLaneOrder(storedOrder: string[], laneIds: string[], newLaneOrder: string[]): string[] {
  const laneSet = new Set(laneIds);
  const queue = [...new Set(newLaneOrder)].filter((id) => laneSet.has(id));
  const out: string[] = [];
  let qi = 0;
  for (const id of storedOrder) {
    // Refill only as many slots as the lane already held in the stored order.
    if (!laneSet.has(id)) out.push(id);
    else if (qi < queue.length) out.push(queue[qi++]);
  }
  // The lane's ids beyond its stored slots (absent from the stored order).
  out.push(...queue.slice(qi));
  return out;
}

export type LaneDropDecision =
  | { kind: "reject" }
  | { kind: "reorder"; order: string[] }
  /** Not a lane-internal move (ended bucket involved / no lanes): legacy flat path. */
  | { kind: "flat" };

/**
 * Drop resolution when a folder renders lanes (design D4): different alive
 * lanes → reject; same lane → slot-preserving merge of the moved lane order
 * into `storedIds`; anything touching the ended bucket (lane `undefined`) →
 * the legacy flat path (drag-to-resume).
 */
export function resolveLaneDrop(args: {
  storedIds: string[];
  activeId: string;
  overId: string;
  activeLane: LaneId | undefined;
  overLane: LaneId | undefined;
  laneIds: string[];
}): LaneDropDecision {
  const { storedIds, activeId, overId, activeLane, overLane, laneIds } = args;
  if (!activeLane || !overLane) return { kind: "flat" };
  if (activeLane !== overLane) return { kind: "reject" };
  const from = laneIds.indexOf(activeId);
  const to = laneIds.indexOf(overId);
  if (from === -1 || to === -1) return { kind: "reject" };
  const moved = [...laneIds];
  const [item] = moved.splice(from, 1);
  moved.splice(to, 0, item);
  return { kind: "reorder", order: mergeLaneOrder(storedIds, laneIds, moved) };
}

/** Canonicalize every key of the stored prefs map with `platform`. */
function canonicalFolderMap(prefs: GroupByPrefs, platform: Platform): Map<string, GroupByMode> {
  const m = new Map<string, GroupByMode>();
  for (const [k, v] of Object.entries(prefs.folderGroupBy)) m.set(pathKey(k, platform), v);
  return m;
}

/** Explicit per-folder override, or `undefined` when the folder follows the default. */
export function explicitGroupBy(folderKey: string, prefs: GroupByPrefs, platform: Platform): GroupByMode | undefined {
  return canonicalFolderMap(prefs, platform).get(pathKey(folderKey, platform));
}

/** Effective mode: per-folder override > global default > `none`. */
export function resolveEffectiveGroupBy(folderKey: string, prefs: GroupByPrefs | undefined, platform: Platform): GroupByMode {
  if (!prefs) return "none";
  return explicitGroupBy(folderKey, prefs, platform) ?? prefs.defaultGroupBy ?? "none";
}

export function isLaneCollapsed(folderKey: string, lane: LaneId, prefs: GroupByPrefs | undefined, platform: Platform): boolean {
  if (!prefs) return false;
  const want = laneCollapseKey(pathKey(folderKey, platform), lane);
  return prefs.collapsedLanes.some((e) => {
    const i = e.lastIndexOf("::");
    return i > 0 && laneCollapseKey(pathKey(e.slice(0, i), platform), e.slice(i + 2) as LaneId) === want;
  });
}

/** Stable fingerprint of the lane-relevant fields — memo key so token/cost ticks don't re-partition. */
export function laneFingerprint(sessions: DashboardSession[], flagsFor: (id: string) => StatusLaneFlags): string {
  let fp = "";
  for (const s of sessions) {
    const f = flagsFor(s.id);
    const bits = [
      s.currentTool === "ask_user",
      s.compacting,
      s.resuming,
      s.unread,
      s.gitWorktree,
      f.hasError,
      f.isRetrying,
      f.hasWidgetBarPrompt,
      f.hasNotice,
    ]
      .map((b) => (b ? 1 : 0))
      .join("");
    fp += `${s.id}:${s.status}:${bits}|`;
  }
  return fp;
}
