/**
 * Single source of truth for resolving a session's group-key path and the
 * path-key folding used to host same-path entries in a Map/Set.
 *
 * Hoisted from the client `session-grouping.ts` so the server can key its
 * `sessionOrder` map by the *same* resolved-group-path the client groups
 * and reads by — eliminating the worktree keying drift where server
 * `insert`/`moveToFront` wrote to the raw `cwd` key the client never read.
 * See change: simplify-session-card-ordering.
 */
import type { DashboardSession } from "./types.js";
import { normalizePath } from "./platform/paths.js";

/**
 * Infer a platform from any path we've seen. The client has no
 * `process.platform`; rather than a protocol round trip just for grouping,
 * sniff: anything with a `\` or a `<letter>:` drive prefix is Windows,
 * otherwise POSIX. Exposed so tests can exercise both branches.
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
 * Build a key that collapses cosmetic path drift (trailing separator,
 * mixed separators, drive-letter case on Windows, case on macOS). The
 * original display path is retained on the group's `cwd` field.
 * Case folding: case-insensitive on win32/darwin, case-sensitive on linux.
 * See change: platform-path-normalization.
 */
export function pathKey(p: string, platform: NodeJS.Platform): string {
  const normalized = normalizePath(p, platform);
  if (platform === "linux") return normalized;
  return normalized.toLowerCase();
}

/**
 * Resolve a session's group-key path. Priority order (first match wins):
 *   1. Explicit pin wins — if `pathKey(cwd)` matches a pinned entry, the
 *      session groups under its own cwd.
 *   2. Else if `gitWorktree.mainPath` is set, group under the main worktree
 *      path (so `.worktrees/<slug>` sessions cluster with their parent repo).
 *   3. Else fall back to `cwd` (status quo for plain checkouts).
 *
 * The display path returned matches the chosen key.
 *
 * See changes: add-worktree-spawn-dialog, simplify-session-card-ordering.
 */
export function resolveSessionGroupPath(
  session: Pick<DashboardSession, "cwd" | "gitWorktree">,
  pinnedKeys: Set<string>,
  platform: NodeJS.Platform,
): string {
  const cwdKey = pathKey(session.cwd, platform);
  if (pinnedKeys.has(cwdKey)) return session.cwd;
  const wtMain = session.gitWorktree?.mainPath;
  if (wtMain && wtMain.length > 0) return wtMain;
  return session.cwd;
}
