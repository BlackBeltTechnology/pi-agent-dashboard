/**
 * Pure utility functions for grouping, sorting, and filtering sessions.
 * Extracted from SessionList.tsx for reuse and testability.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import { normalizePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";

/**
 * Infer the server's platform from any path we've seen. Client doesn't
 * have `process.platform`; rather than adding a separate protocol round
 * trip just for grouping, we sniff: anything with a `\` or a
 * `<letter>:` drive prefix is Windows, otherwise POSIX.
 *
 * Exposed for tests so they can exercise both branches deterministically.
 */
export function inferPlatform(
  samples: Array<string | undefined>,
  override?: NodeJS.Platform,
): NodeJS.Platform {
  if (override) return override;
  for (const s of samples) {
    if (!s) continue;
    if (/^[A-Za-z]:[\\/]/.test(s) || s.includes("\\")) return "win32";
    if (s.startsWith("/")) return "linux";
  }
  return "linux";
}

/**
 * Build a key suitable for Map/Set lookup that collapses
 * cosmetic path drift (trailing separator, mixed separators,
 * drive-letter case on Windows, case on macOS). The original
 * display path is retained on the group's `cwd` field.
 *
 * Case folding for Windows/macOS happens here so a naive
 * string-keyed Map can host same-path entries.
 *
 * See change: platform-path-normalization.
 */
function pathKey(p: string, platform: NodeJS.Platform): string {
  const normalized = normalizePath(p, platform);
  // Match samePath's folding: case-insensitive on win32/darwin,
  // case-sensitive on linux.
  if (platform === "linux") return normalized;
  return normalized.toLowerCase();
}

export interface DirectoryGroup {
  cwd: string;
  sessions: DashboardSession[];
  pinned: boolean;
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
 * Resolve a session's group-key path. Priority order (see Decision 15 in
 * `add-jj-workspace-plugin`):
 *   1. Explicit pin wins — if `pathKey(cwd)` matches a pinned entry, the
 *      session groups under its own cwd.
 *   2. Else if `jjState.workspaceRoot` is set, the session collapses
 *      under the parent repo's group key (so `.shadow/<name>/` workspaces
 *      cluster with their parent).
 *   3. Else falls back to `cwd` (status quo for non-jj sessions).
 *
 * The display path returned matches the chosen key — pinned uses cwd,
 * collapsed uses workspaceRoot, default uses cwd.
 *
 * Exported for tests; consumed by `groupSessionsByDirectory`.
 */
export function resolveSessionGroupPath(
  session: DashboardSession,
  pinnedKeys: Set<string>,
  platform: NodeJS.Platform,
): string {
  // Worktree sessions group under their parent repo (groupCwd)
  const cwd = session.groupCwd ?? session.cwd;
  const cwdKey = pathKey(cwd, platform);
  if (pinnedKeys.has(cwdKey)) return cwd;
  const wsRoot = session.jjState?.workspaceRoot;
  if (wsRoot && wsRoot.length > 0) return wsRoot;
  return cwd;
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
 * pin > `jjState.workspaceRoot` > `cwd`. Within a group, sessions are
 * pre-sorted so all rows sharing the same `(jjState?.workspaceName ?? "")`
 * cluster adjacently (main-tree then ws-A then ws-B, etc.); existing
 * `sortSessionsByOrder` ranking applies inside each cluster.
 *
 * See change: add-jj-workspace-plugin (Decision 15).
 */
export function groupSessionsByDirectory(
  sessions: DashboardSession[],
  orderMap?: Map<string, string[]>,
  pinnedDirectories?: string[],
  platform?: NodeJS.Platform,
): { pinned: DirectoryGroup[]; unpinned: DirectoryGroup[] } {
  // Infer platform from observed paths (session cwds + pinned entries +
  // jj workspace roots) when not explicitly supplied. Callers can still
  // pass `platform` to force a value.
  const plat = inferPlatform(
    [
      ...sessions.map((s) => s.cwd),
      ...sessions.map((s) => s.jjState?.workspaceRoot),
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

  // Pre-sort sessions inside each group so workspace clusters stay
  // adjacent. Stable sort preserves prior recency/order tiers within
  // each (workspaceName ?? "") bucket.
  for (const g of groups.values()) {
    g.sessions = clusterByWorkspaceName(g.sessions);
  }

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
      sessions: clusterByWorkspaceName(ordered),
      pinned: true,
    });
  }

  // Build unpinned groups sorted by most recent activity
  const unpinned = Array.from(groups.entries())
    .filter(([key]) => !pinnedKeys.has(key))
    .map(([, g]) => ({
      cwd: g.cwd,
      sessions: clusterByWorkspaceName(sortSessionsByOrder(g.sessions, orderMap?.get(g.cwd))),
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
 * Stable cluster sort by `(jjState?.workspaceName ?? "")`. Sessions
 * sharing a workspace name end up adjacent without losing the relative
 * ordering established by the prior sort step.
 *
 * Empty workspace name (i.e. plain main-tree sessions) sorts first so
 * the parent-repo cluster appears before its workspace clusters inside
 * a collapsed group.
 */
function clusterByWorkspaceName(sessions: DashboardSession[]): DashboardSession[] {
  // Map.values() iteration is insertion-ordered, so we walk the input
  // once and bucket by name; concatenation order is name-order.
  const buckets = new Map<string, DashboardSession[]>();
  for (const s of sessions) {
    const name = s.jjState?.workspaceName ?? "";
    const bucket = buckets.get(name);
    if (bucket) bucket.push(s);
    else buckets.set(name, [s]);
  }
  // Sort bucket keys alphabetically with empty-string first.
  const keys = Array.from(buckets.keys()).sort((a, b) => {
    if (a === b) return 0;
    if (a === "") return -1;
    if (b === "") return 1;
    return a.localeCompare(b);
  });
  return keys.flatMap((k) => buckets.get(k)!);
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
