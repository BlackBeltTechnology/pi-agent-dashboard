/**
 * Pure, browser-safe resolution of the tree a file link should target.
 *
 * Two concerns live here, both string-only (no `node:path`, no fetch):
 *  - `resolveAgainstCwd`: join a relative token to the session cwd (tooltip).
 *  - `resolveLinkOrigin`: for a worktree session, re-root an ABSOLUTE token
 *    rooted in the parent checkout (`<parentRoot>`) onto the worktree's own
 *    tree, so the link points at the worktree copy — not the parent's.
 *
 * See change: fix-worktree-link-origin (spec: tool-output-linkification —
 * "Worktree link-origin re-rooting").
 */

/** `\` → `/`, drop a trailing slash, lowercase a leading drive letter. */
function norm(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .replace(/^([A-Za-z]):/, (_m, d: string) => `${d.toLowerCase()}:`);
}

function under(p: string, base: string): boolean {
  return p === base || p.startsWith(`${base}/`);
}

/**
 * Resolve a possibly-relative path against `cwd` using string ops only
 * (browser-safe; no `node:path`). Absolute paths (POSIX `/` or Windows
 * drive) are returned unchanged. Good enough for the link tooltip — the
 * server still does the authoritative `path.resolve` for actual reads.
 */
export function resolveAgainstCwd(cwd: string | undefined, p: string): string {
  if (!cwd) return p;
  if (p.startsWith("/")) return p;
  if (/^[A-Za-z]:[\\/]/.test(p)) return p; // Windows drive-absolute
  const base = cwd.replace(/\/+$/, "");
  if (p.startsWith("./")) return `${base}/${p.slice(2)}`;
  if (p.startsWith("../")) {
    const parts = base.split("/");
    let rel = p;
    while (rel.startsWith("../")) {
      parts.pop();
      rel = rel.slice(3);
    }
    return `${parts.join("/")}/${rel}`;
  }
  return `${base}/${p}`;
}

/**
 * Derive the parent-checkout root from a dashboard worktree cwd by stripping a
 * trailing `/.worktrees/<slug>` (POSIX or Windows) segment. Returns the
 * normalized parent root, or `undefined` when `cwd` is not a worktree path.
 */
export function stripWorktreeSegment(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  const c = norm(cwd);
  const m = c.match(/^(.*)\/\.worktrees\/[^/]+$/);
  return m ? m[1] : undefined;
}

/**
 * Resolve the tree a file link should target.
 *
 * - Relative token → join against `cwd` (unchanged behavior).
 * - Absolute token in a worktree session whose path is under the parent
 *   checkout root → re-root onto the worktree (`<parentRoot>` prefix → cwd).
 * - Every other absolute case (non-worktree cwd, already under the worktree,
 *   foreign path) → returned verbatim (fail-open, never widening the target).
 */
export function resolveLinkOrigin(
  cwd: string | undefined,
  path: string,
  absolute: boolean | undefined,
): string {
  if (!absolute) return resolveAgainstCwd(cwd, path);
  if (!cwd) return path;
  const parentRoot = stripWorktreeSegment(cwd);
  if (parentRoot === undefined) return path; // not a worktree
  const wt = norm(cwd);
  const p = norm(path);
  if (under(p, wt)) return path; // already worktree-rooted
  if (under(p, parentRoot)) return wt + p.slice(parentRoot.length);
  return path; // foreign absolute
}
