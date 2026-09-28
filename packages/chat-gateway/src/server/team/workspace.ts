/**
 * Working-directory → workspace resolution.
 *
 * Matches on whole path SEGMENTS after resolving symlinks, and selects the most
 * specific (longest) matching folder when several match. A same-folder-in-two-
 * workspaces conflict is unreachable: the preferences store enforces single
 * folder membership.
 *
 * The same containment test is the scope boundary for authorization: a command
 * in a bound channel may only reach sessions whose cwd lies inside that
 * binding's workspace.
 *
 * See change: add-chat-gateway-team-controls (D8).
 */
import fs from "node:fs";
import path from "node:path";

/** A workspace as the host seam exposes it (`listWorkspaces()`). */
export interface WorkspaceView {
  id: string;
  name: string;
  folders: string[];
}

export interface WorkspaceMatch {
  workspaceId: string;
  /** The canonical folder that matched. */
  folder: string;
}

/**
 * Real path of `p`, symlink-resolved, with a nearest-existing-ancestor
 * fallback so a not-yet-created path is still checkable (a symlinked ancestor
 * cannot be used to escape a containment check).
 */
function realOrResolved(p: string): string {
  let abs = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(abs), ...rest);
    } catch {
      const parent = path.dirname(abs);
      if (parent === abs) return path.resolve(p);
      rest.unshift(path.basename(abs));
      abs = parent;
    }
  }
}

/** Path-segment-aware containment: `/a/foo` is NOT inside `/a/fo`. */
function contains(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return candidate.startsWith(prefix);
}

/** True when `cwd` is a path-segment descendant of `folder` (symlinks resolved). */
function isWithinFolder(cwd: string, folder: string): boolean {
  if (!cwd || !folder) return false;
  return contains(realOrResolved(folder), realOrResolved(cwd));
}

/** True when `cwd` lies within any of `folders`. */
export function isWithinWorkspace(cwd: string, folders: string[]): boolean {
  if (!cwd || !folders || folders.length === 0) return false;
  return folders.some((f) => isWithinFolder(cwd, f));
}

/**
 * The longest folder in `ws` containing `canonicalCwd`, or null. Longest match
 * wins so a nested folder does not shadow its parent's more specific sibling.
 */
function bestFolderIn(
  ws: WorkspaceView,
  canonicalCwd: string,
): { folder: string; length: number } | null {
  if (!ws || !Array.isArray(ws.folders)) return null;
  let best: { folder: string; length: number } | null = null;
  for (const folder of ws.folders) {
    if (typeof folder !== "string" || folder === "") continue;
    const canonicalFolder = realOrResolved(folder);
    if (!contains(canonicalFolder, canonicalCwd)) continue;
    if (best === null || canonicalFolder.length > best.length) {
      best = { folder: canonicalFolder, length: canonicalFolder.length };
    }
  }
  return best;
}

/**
 * Resolve `cwd` to at most one workspace: longest matching folder wins, and a
 * cwd outside every folder resolves to `null` (not surfaced anywhere).
 */
export function resolveWorkspaceForCwd(
  cwd: string,
  workspaces: WorkspaceView[],
): WorkspaceMatch | null {
  if (!cwd || !Array.isArray(workspaces)) return null;
  const canonicalCwd = realOrResolved(cwd);
  let best: { workspaceId: string; folder: string; length: number } | null = null;

  for (const ws of workspaces) {
    const match = bestFolderIn(ws, canonicalCwd);
    if (!match) continue;
    if (best === null || match.length > best.length) {
      best = { workspaceId: ws.id, folder: match.folder, length: match.length };
    }
  }

  return best ? { workspaceId: best.workspaceId, folder: best.folder } : null;
}
