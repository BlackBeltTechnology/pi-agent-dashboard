/**
 * Held ended-session count per GROUP key (the key space `endedTotals` uses).
 * The ended-list “more” affordance compares it with the group's full ended
 * count. Rows merged by a deep-link lookup (`lookupOnlyIds`) are excluded so a
 * looked-up session never makes a group look fully held and suppress paging;
 * an id leaves the set when a page or snapshot delivers it.
 * See change: add-session-ui-deep-links-for-agents (D3).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { inferPlatform, pathKey, resolveSessionGroupPath } from "./session-grouping.js";

export function heldEndedByGroup(
  sessions: DashboardSession[],
  pinnedDirectories: string[] | undefined,
  lookupOnlyIds?: ReadonlySet<string>,
): Map<string, number> {
  const m = new Map<string, number>();
  const pinned = pinnedDirectories ?? [];
  const platform = inferPlatform([...sessions.map((s) => s.cwd), ...pinned]);
  const pinnedKeys = new Set(pinned.map((d) => pathKey(d, platform)));
  for (const s of sessions) {
    if (s.status !== "ended") continue;
    if (lookupOnlyIds?.has(s.id)) continue;
    const key = resolveSessionGroupPath(s, pinnedKeys, platform);
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return m;
}
