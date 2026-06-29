/**
 * Pure utility functions for grouping, sorting, and filtering sessions.
 * Extracted from SessionList.tsx for reuse and testability.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import {
  inferPlatform,
  pathKey,
  resolveSessionGroupPath,
} from "@blackbelt-technology/pi-dashboard-shared/session-group-path.js";

// `inferPlatform`, `pathKey`, and `resolveSessionGroupPath` now live in
// packages/shared so the server keys its order map by the SAME resolved
// path the client reads. Re-exported here for existing client importers
// and tests. See change: simplify-session-card-ordering.
export { inferPlatform, pathKey, resolveSessionGroupPath };

export interface DirectoryGroup {
  cwd: string;
  sessions: DashboardSession[];
  pinned: boolean;
}

/**
 * A workspace tier in the sidebar: a named, collapsible container whose
 * `folders` are rendered using the same per-folder shape as top-level
 * groups. Membership is authoritative — every folder in a workspace's
 * `folders[]` appears here regardless of pin state or session count, and
 * is excluded from the top-level area. See change: folder-workspaces.
 */
export interface WorkspaceGroup {
  id: string;
  name: string;
  collapsed: boolean;
  folders: DirectoryGroup[];
}

/** Sort sessions within a group by server order, then by startedAt descending for unordered ones. */
export function sortSessionsByOrder(sessions: DashboardSession[], order?: string[]): DashboardSession[] {
  if (!order || order.length === 0) {
    return [...sessions].sort((a, b) => b.startedAt - a.startedAt);
  }
  const orderIndex = new Map(order.map((id, i) => [id, i]));
  const ordered: DashboardSession[] = [];
  const unordered: DashboardSession[] = [];
  for (const s of sessions) {
    if (orderIndex.has(s.id)) {
      ordered.push(s);
    } else {
      unordered.push(s);
    }
  }
  ordered.sort((a, b) => orderIndex.get(a.id)! - orderIndex.get(b.id)!);
  unordered.sort((a, b) => b.startedAt - a.startedAt);
  return [...ordered, ...unordered];
}

/** Get unified order of session + terminal IDs for a group. */
export function getUnifiedOrder(sessions: DashboardSession[], terminals: TerminalSession[], order?: string[]): string[] {
  const allIds = new Set([...sessions.map((s) => s.id), ...terminals.map((t) => t.id)]);
  if (!order || order.length === 0) {
    // Default: terminals first (newest first), then sessions (newest first)
    return [
      ...terminals.sort((a, b) => b.createdAt - a.createdAt).map((t) => t.id),
      ...sessions.sort((a, b) => b.startedAt - a.startedAt).map((s) => s.id),
    ];
  }
  const ordered = order.filter((id) => allIds.has(id));
  const unordered = [...allIds].filter((id) => !new Set(ordered).has(id));
  return [...ordered, ...unordered];
}

/**
 * Group sessions by cwd, with pinned directories first (in pinned order),
 * then unpinned sorted by recency.
 *
 * Keyed by `pathKey(cwd)` to collapse cosmetic drift (trailing separator,
 * separator style, case on Windows/macOS). The `cwd` field on each group
 * keeps the original path for display. Pass `platform` (from
 * `BrowseResult.platform` or a session event) for OS-correct matching;
 * falls back to `process.platform` when absent.
 *
 * Per-session group-key precedence (see `resolveSessionGroupPath`):
 * pin > `gitWorktree.mainPath` > `cwd`. Within a
 * group, sessions are ordered solely by the flat `sessionOrder`
 * (`sortSessionsByOrder` + the status-partition in SessionList) — NO
 * workspace-cluster adjacency.
 * See change: simplify-session-card-ordering (Decision D8).
 */
export function groupSessionsByDirectory(
  sessions: DashboardSession[],
  orderMap?: Map<string, string[]>,
  pinnedDirectories?: string[],
  platform?: NodeJS.Platform,
): { pinned: DirectoryGroup[]; unpinned: DirectoryGroup[] } {
  // Infer platform from observed paths (session cwds + pinned entries +
  // git worktree main paths) when not explicitly
  // supplied. Callers can still pass `platform` to force a value.
  const plat = inferPlatform(
    [
      ...sessions.map((s) => s.cwd),
      ...sessions.map((s) => s.gitWorktree?.mainPath),
      ...(pinnedDirectories ?? []),
    ],
    platform,
  );

  // Pinned set is computed first so the per-session resolver can honour
  // the pin-wins rule.
  const pinnedKeys = new Set((pinnedDirectories ?? []).map((d) => pathKey(d, plat)));

  // groups keyed by canonical key; value carries original-display cwd + sessions
  const groups = new Map<string, { cwd: string; sessions: DashboardSession[] }>();
  for (const session of sessions) {
    const groupPath = resolveSessionGroupPath(session, pinnedKeys, plat);
    const key = pathKey(groupPath, plat);
    const existing = groups.get(key);
    if (existing) {
      existing.sessions.push(session);
    } else {
      groups.set(key, { cwd: groupPath, sessions: [session] });
    }
  }

  // No workspace-cluster adjacency: order within a folder is governed
  // solely by the flat status-partitioned `sessionOrder` (applied by
  // `sortSessionsByOrder` below + the per-tier partition in SessionList).
  // A worktree session can therefore surface at the top of its tier
  // ahead of the main checkout. Grouping-under-parent (collapse) stays;
  // only cluster ordering is dropped.
  // See change: simplify-session-card-ordering (Decision D8).

  // Build pinned groups in pinned order (including zero-session groups).
  // Uses the pinned path as the display cwd so the header matches what the
  // user pinned, not what some session happened to report.
  const pinned: DirectoryGroup[] = [];
  for (const dir of pinnedDirectories ?? []) {
    const key = pathKey(dir, plat);
    const group = groups.get(key);
    const ordered = sortSessionsByOrder(
      group?.sessions ?? [],
      orderMap?.get(dir) ?? orderMap?.get(group?.cwd ?? ""),
    );
    pinned.push({
      cwd: dir,
      sessions: ordered,
      pinned: true,
    });
  }

  // Build unpinned groups sorted by most recent activity
  const unpinned = Array.from(groups.entries())
    .filter(([key]) => !pinnedKeys.has(key))
    .map(([, g]) => ({
      cwd: g.cwd,
      sessions: sortSessionsByOrder(g.sessions, orderMap?.get(g.cwd)),
      pinned: false,
    }))
    .sort((a, b) => {
      const aMax = Math.max(...a.sessions.map((s) => s.startedAt));
      const bMax = Math.max(...b.sessions.map((s) => s.startedAt));
      return bMax - aMax;
    });

  return { pinned, unpinned };
}

/**
 * Workspace-aware grouping. Returns:
 *   - `workspaces`: one tier per workspace, in workspace-array order, each
 *      containing its folders in `folders[]` order; every folder rendered
 *      regardless of pin state or session count.
 *   - `topLevel`: pinned-first-then-session-driven flat list restricted
 *      to folders that are NOT in any workspace.
 *
 * Folders in a workspace are EXCLUDED from the top-level area entirely
 * (even if also pinned). Pin state has no effect on intra-workspace order.
 *
 * See change: folder-workspaces (spec session-grouping).
 */
export function groupSessionsByDirectoryWithWorkspaces(
  sessions: DashboardSession[],
  workspaces: ReadonlyArray<{ id: string; name: string; collapsed: boolean; folders: string[] }>,
  orderMap?: Map<string, string[]>,
  pinnedDirectories?: string[],
  platform?: NodeJS.Platform,
): { workspaces: WorkspaceGroup[]; topLevel: DirectoryGroup[] } {
  const plat = inferPlatform(
    [
      ...sessions.map((s) => s.cwd),
      ...(pinnedDirectories ?? []),
      ...workspaces.flatMap((w) => w.folders),
    ],
    platform,
  );

  // Build the canonical "folder → workspace" map so we can exclude
  // workspace-owned folders from the top level. Single-membership
  // invariant is enforced server-side; if it's ever violated client-side
  // we honor the FIRST workspace that claims a folder.
  const folderToWs = new Map<string, { wsIdx: number; folderIdx: number }>();
  workspaces.forEach((w, wsIdx) => {
    w.folders.forEach((p, folderIdx) => {
      const key = pathKey(p, plat);
      if (!folderToWs.has(key)) folderToWs.set(key, { wsIdx, folderIdx });
    });
  });

  // Reuse the existing grouper to compute pinned + unpinned. Then we
  // partition each into "in a workspace" vs "top level" buckets.
  const { pinned, unpinned } = groupSessionsByDirectory(
    sessions, orderMap, pinnedDirectories, platform,
  );

  // Build a path → DirectoryGroup index covering pinned + unpinned. Then
  // any workspace-listed folder NOT yet in either list (no sessions and
  // not pinned) gets a synthetic empty group so it still renders.
  const groupByKey = new Map<string, DirectoryGroup>();
  for (const g of pinned) groupByKey.set(pathKey(g.cwd, plat), g);
  for (const g of unpinned) groupByKey.set(pathKey(g.cwd, plat), g);

  const wsTiers: WorkspaceGroup[] = workspaces.map((w) => {
    const folders: DirectoryGroup[] = w.folders.map((p) => {
      const key = pathKey(p, plat);
      const existing = groupByKey.get(key);
      if (existing) return existing;
      // Synthetic: a workspace-owned folder with no sessions and no pin.
      // The pin flag mirrors `pinnedDirectories` membership so the
      // unpin/pin toggle continues to render correctly inside the workspace.
      const pinnedSet = new Set((pinnedDirectories ?? []).map((d) => pathKey(d, plat)));
      return { cwd: p, sessions: [], pinned: pinnedSet.has(key) };
    });
    return { id: w.id, name: w.name, collapsed: w.collapsed, folders };
  });

  // Top-level: everything NOT claimed by a workspace, preserving the
  // original pinned-first-then-recency ordering produced by
  // `groupSessionsByDirectory`.
  const topLevel: DirectoryGroup[] = [...pinned, ...unpinned].filter(
    (g) => !folderToWs.has(pathKey(g.cwd, plat)),
  );

  return { workspaces: wsTiers, topLevel };
}

/** Apply filter pipeline: active-only → hidden → visible sessions */
export function filterSessions(
  sessions: DashboardSession[],
  activeOnly: boolean,
  showHidden: boolean,
): DashboardSession[] {
  return sessions.filter((s) => {
    if (activeOnly && s.status === "ended") return false;
    if (s.hidden && !showHidden) return false;
    // Automation runs are off-board unless their effective visibility is
    // "shown" (per-automation field ?? settings default, default hidden).
    // The Automation view reads sessions directly, so hidden runs stay
    // watchable there. Revealed via the same "show hidden" toggle.
    // See change: add-automation-plugin.
    if (s.kind === "automation" && s.automationRun?.visibility !== "shown" && !showHidden) {
      return false;
    }
    return true;
  });
}

/**
 * Case-insensitive substring search over a folder's session list.
 * Matches against the same string the user actually sees on the card:
 *   1. `name` (if non-empty)
 *   2. `firstMessage` (if no name)
 *   3. last segment of `cwd` (if neither, e.g. fresh sessions where
 *      the display falls back to the folder basename — this is what
 *      `getSessionDisplayName` does, so search must mirror it)
 * Empty/whitespace queries return the input unchanged.
 *
 * Mirrors `getSessionDisplayName` to keep "what you see is what you
 * search" — a session showing as "pi-shodh" must match a `pi-sho` query
 * even when its underlying `name` and `firstMessage` are empty.
 *
 * The caller is responsible for applying `showHidden` filtering before
 * search (typically via the standard `filterSessions` pipeline).
 *
 * See change: pin-and-search-sessions §8.
 */
export function filterByQuery<
  T extends { name?: string; firstMessage?: string; cwd?: string },
>(sessions: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [...sessions];
  return sessions.filter((s) => {
    const name = s.name?.trim();
    if (name) return name.toLowerCase().includes(q);
    const fm = s.firstMessage?.trim();
    if (fm) return fm.toLowerCase().includes(q);
    const basename = s.cwd?.split("/").pop() ?? "";
    return basename.toLowerCase().includes(q);
  });
}

/**
 * Stable rank: alive sessions (status ≠ "ended") above ended sessions,
 * preserving relative order within each tier. Used to order session
 * cards inside a folder so the user always sees their currently-active
 * work at the top, regardless of when ended sessions were last updated.
 *
 * The previous "Active only" toggle is replaced by this universal sort
 * (see design D1 revised): rather
 * than hiding ended sessions outright, we keep them visible but ranked
 * below active ones, so search and exploration both see the same set.
 *
 * See change: pin-and-search-sessions (design D1 revised).
 */
export function rankActiveFirst<T extends { status?: string }>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => {
    const aEnded = a.status === "ended" ? 1 : 0;
    const bEnded = b.status === "ended" ? 1 : 0;
    return aEnded - bEnded;
  });
}
