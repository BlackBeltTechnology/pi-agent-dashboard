/**
 * Boundary-correct path containment. Relocated here from
 * `packages/server/src/session/active-sessions-in-cwd.ts` so `packages/shared`
 * (which cannot depend on `packages/server`) can use it inside the OpenSpec
 * activity detector's cwd-locality guard.
 *
 * Behaviour-preserving move — the `cwd-session-containment` scenarios still
 * exercise it through the server re-export.
 *
 * See change: scope-openspec-auto-attach-to-session-cwd.
 */
import { normalizePath } from "./platform/paths.js";

/**
 * True when `child` is `parent` itself or any descendant. Operates on
 * normalised paths so separator drift between `\` and `/` on Windows
 * is tolerated. Case-folding matches `samePath` semantics
 * (case-insensitive on win32/darwin, sensitive on linux).
 *
 * A sibling prefix (`/repo-other` vs `/repo`) is NOT containment — the
 * boundary separator check is the whole point of this helper.
 */
export function isPathInside(
  parent: string,
  child: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!parent || !child) return false;
  const np = normalizePath(parent, platform);
  const nc = normalizePath(child, platform);
  if (!np || !nc) return false;
  // Choose the platform-correct separator for the boundary check.
  const sep = platform === "win32" ? "\\" : "/";
  // Strip a trailing separator from `parent` so "/foo/" + "/foo" still match.
  const parentTrimmed = np.endsWith(sep) && np.length > 1 ? np.slice(0, -1) : np;
  const caseFold = platform !== "linux";
  const a = caseFold ? parentTrimmed.toLowerCase() : parentTrimmed;
  const b = caseFold ? nc.toLowerCase() : nc;
  if (a === b) return true;
  return b.startsWith(a + sep);
}
