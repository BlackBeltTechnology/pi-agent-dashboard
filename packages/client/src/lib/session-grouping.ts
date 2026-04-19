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
 * Group sessions by cwd, with pinned directories first (in pinned order),
 * then unpinned sorted by recency.
 *
 * Keyed by `pathKey(cwd)` to collapse cosmetic drift (trailing separator,
 * separator style, case on Windows/macOS). The `cwd` field on each group
 * keeps the original path for display. Pass `platform` (from
 * `BrowseResult.platform` or a session event) for OS-correct matching;
 * falls back to `process.platform` when absent.
 */
export function groupSessionsByDirectory(
  sessions: DashboardSession[],
  orderMap?: Map<string, string[]>,
  pinnedDirectories?: string[],
  platform?: NodeJS.Platform,
): { pinned: DirectoryGroup[]; unpinned: DirectoryGroup[] } {
  // Infer platform from observed paths (session cwds + pinned entries)
  // when not explicitly supplied. Covers 99% of cases without a protocol
  // round trip. Callers can still pass `platform` to force a value.
  const plat = inferPlatform(
    [...sessions.map((s) => s.cwd), ...(pinnedDirectories ?? [])],
    platform,
  );

  // groups keyed by canonical key; value carries original-display cwd + sessions
  const groups = new Map<string, { cwd: string; sessions: DashboardSession[] }>();
  for (const session of sessions) {
    const key = pathKey(session.cwd, plat);
    const existing = groups.get(key);
    if (existing) {
      existing.sessions.push(session);
    } else {
      groups.set(key, { cwd: session.cwd, sessions: [session] });
    }
  }

  const pinnedKeys = new Set((pinnedDirectories ?? []).map((d) => pathKey(d, plat)));

  // Build pinned groups in pinned order (including zero-session groups).
  // Uses the pinned path as the display cwd so the header matches what the
  // user pinned, not what some session happened to report.
  const pinned: DirectoryGroup[] = [];
  for (const dir of pinnedDirectories ?? []) {
    const key = pathKey(dir, plat);
    const group = groups.get(key);
    pinned.push({
      cwd: dir,
      sessions: sortSessionsByOrder(group?.sessions ?? [], orderMap?.get(dir) ?? orderMap?.get(group?.cwd ?? "")),
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
