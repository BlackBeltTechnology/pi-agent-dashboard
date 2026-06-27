/**
 * Artifact-root allowlist for bridge image inlining (Fix B containment).
 *
 * The bridge inlines path-referenced image tool results at capture time. To
 * avoid turning "a tool echoed an absolute path" into arbitrary local-file
 * disclosure into the event stream (which matters for this project's
 * remote/shared dashboards), inlining is gated to recognized artifact roots —
 * the SAME roots Fix A (`serve-agent-artifact-previews`) serves over
 * `/api/file/raw`: the default `agent-browser` screenshot dir plus the
 * producer-configurable `AGENT_BROWSER_SCREENSHOT_DIR`.
 *
 * Pure: all fs/env access is injected so every branch is unit-testable.
 *
 * See change: inline-agent-screenshot-artifacts.
 */
import path from "node:path";

export interface ArtifactRootDeps {
  /** Home directory (`os.homedir()`). */
  homedir: string;
  /** Process environment (`process.env`). */
  env: Record<string, string | undefined>;
  /** Symlink-collapsing path resolver (`fs.realpathSync`). Throws if missing. */
  realpathSync: (p: string) => string;
}

/**
 * Resolve the allowlist of artifact roots. Each candidate is realpath-resolved
 * (collapsing symlinks); roots that do not exist / cannot resolve are dropped.
 * Returns an empty list when no root resolves — callers MUST treat empty as
 * "inline nothing", not "inline everything".
 */
export function resolveArtifactRoots(deps: ArtifactRootDeps): string[] {
  const candidates = [
    path.join(deps.homedir, ".agent-browser", "tmp"),
    deps.env.AGENT_BROWSER_SCREENSHOT_DIR,
  ].filter((p): p is string => typeof p === "string" && p.length > 0);

  const roots: string[] = [];
  for (const c of candidates) {
    try {
      const real = deps.realpathSync(c);
      if (!roots.includes(real)) roots.push(real);
    } catch {
      // Root does not exist yet / unreadable — skip it.
    }
  }
  return roots;
}

/**
 * True iff `absPath` resolves (after realpath, collapsing symlinks) inside one
 * of `roots`. Both sides are realpath'd so a path like `<root>/../etc/x.png`
 * cannot escape. A path whose realpath fails (missing file) is rejected. An
 * empty `roots` list rejects everything.
 */
export function isUnderArtifactRoot(
  absPath: string,
  roots: string[],
  realpathSync: (p: string) => string,
): boolean {
  if (roots.length === 0) return false;
  let real: string;
  try {
    real = realpathSync(absPath);
  } catch {
    return false;
  }
  return roots.some((root) => {
    const rel = path.relative(root, real);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}
