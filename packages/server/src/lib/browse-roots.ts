/**
 * Shared-root confinement for the directory-browse endpoints
 * (`/api/browse`, `/api/browse/flags`, `/api/browse/mkdir`).
 *
 * Applied ONLY to requests that are not genuinely local (tunnel, LAN, relayed
 * loopback): those carry `networkGuard` alone, so before this module
 * `/api/browse?path=/` enumerated the whole filesystem and
 * `/api/browse/mkdir` created a directory anywhere. A local caller keeps the
 * unrestricted picker (it already has a shell).
 *
 * The allowed set is every place the dashboard already "shares": `$HOME`,
 * pinned directories, session cwds, workspace folders, worktree-init trust
 * roots and project-scope access-grant subjects. Both sides are compared on
 * REAL paths, so a symlink inside a root pointing out of it is refused.
 *
 * See change: harden-server-capability-bounds (B8, D1, D2).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type ForbiddenSubjectsEnv,
  forbiddenGrantSubjects,
} from "@blackbelt-technology/pi-dashboard-shared/forbidden-subjects.js";
import { safeRealpath, within } from "./path-containment.js";

/** Stable client-facing message for a refused browse/mkdir path. */
export const BROWSE_OUTSIDE_ROOTS_ERROR = "path outside allowed roots";

/**
 * Where roots come from. Each source is a lazy reader so one that throws (store
 * read error) contributes no roots for that request instead of failing it open.
 */
export interface BrowseRootSources {
  pinned(): readonly string[];
  sessionCwds(): readonly string[];
  workspaceFolders(): readonly string[];
  worktreeRoots(): readonly string[];
  /** Project-scope access-grant subjects (session-scope grants are transient: excluded). */
  projectGrants(): readonly string[];
}

/**
 * The resolved allowed set for ONE request. `sensitive` (`~/.ssh`, `~/.pi`) is
 * computed once here: `forbiddenGrantSubjects` does ~18 sync realpaths, which
 * must not be repeated per candidate root or per checked path.
 */
export interface BrowseRoots {
  roots: string[];
  sensitive: string[];
}

const warnedSources = new Set<string>();
function warnOnce(source: string, err: unknown): void {
  if (warnedSources.has(source)) return;
  warnedSources.add(source);
  console.warn(`[browse-roots] source "${source}" failed; contributing no roots:`, err instanceof Error ? err.message : err);
}

/**
 * The allowed set: real paths of `$HOME` and every shared root, deduplicated. Candidates from the
 * non-home sources that are ungrantable (`/`, `$HOME` itself, system roots, any
 * ancestor of those or of `~/.ssh` / `~/.pi`) are dropped, so a remote pin of
 * `/` can never become a root. `$HOME` is the one explicit exception.
 */
export async function resolveBrowseRoots(
  sources: BrowseRootSources,
  env?: ForbiddenSubjectsEnv,
): Promise<BrowseRoots> {
  const home = env?.homedir ?? os.homedir();
  const sets = forbiddenGrantSubjects(env);
  const roots = new Set<string>([await safeRealpath(path.resolve(home))]);

  const named: Array<[string, () => readonly string[]]> = [
    ["pinned", sources.pinned],
    ["sessionCwds", sources.sessionCwds],
    ["workspaceFolders", sources.workspaceFolders],
    ["worktreeRoots", sources.worktreeRoots],
    ["projectGrants", sources.projectGrants],
  ];
  // `forbidden` = every subject a root may neither BE nor CONTAIN (`/`, `$HOME`, system roots,
  // `~/.ssh`, `~/.pi`). Evaluated here on the already-real path against the sets built once above:
  // `isUngrantableSubject` would re-canonicalise (sync realpath) per candidate, ~2 sync fs calls per
  // root on every request. Same rule: a root is dropped when it IS a whole-subject, is at/under a
  // sensitive dir, or is an ancestor of any forbidden subject.
  const forbidden = [...sets.whole, ...sets.sensitive];
  const ungrantable = (real: string): boolean =>
    forbidden.some((f) => within(f, real)) || // real equals or contains a forbidden subject
    sets.sensitive.some((f) => within(real, f)); // real is at/under a sensitive dir

  const candidates: string[] = [];
  for (const [name, read] of named) {
    try {
      candidates.push(...read());
    } catch (err) {
      warnOnce(name, err);
    }
  }
  // Strict realpath (deleted / EACCES -> dropped), in parallel: one slow volume must not serialise the rest.
  const resolved = await Promise.all(
    candidates.map((dir) => fs.realpath(path.resolve(dir)).catch(() => null)),
  );
  for (const real of resolved) if (real !== null && !ungrantable(real)) roots.add(real);
  return { roots: [...roots], sensitive: sets.sensitive };
}

/**
 * True when `target` (symlinks resolved) sits at or under one of `roots` (real
 * paths) and is not inside a sensitive subtree (`~/.ssh`, `~/.pi`) — those stay
 * refused even though `$HOME` is a root.
 */
export async function isWithinBrowseRoots(target: string, allowed: BrowseRoots): Promise<boolean> {
  const real = await safeRealpath(path.resolve(target));
  if (allowed.sensitive.some((s) => within(real, s))) return false;
  return allowed.roots.some((root) => within(real, root));
}

/**
 * The root sources, built once from the stores the server already owns and shared
 * by the browse routes and the remote pin/workspace gate, so "what is shared" has
 * ONE definition. `worktreeRoots` / `projectGrants` are readers only server.ts can
 * supply (project-scope grants only; session-scope grants are transient).
 */
export function buildBrowseRootSources(deps: {
  preferencesStore: { getPinnedDirectories(): string[]; getWorkspaces(): Array<{ folders: string[] }> };
  sessionManager: { listAll(): Array<{ cwd: string }> };
  worktreeRoots?: () => readonly string[];
  projectGrants?: () => readonly string[];
}): BrowseRootSources {
  return {
    pinned: () => deps.preferencesStore.getPinnedDirectories(),
    sessionCwds: () => deps.sessionManager.listAll().map((s) => s.cwd),
    workspaceFolders: () => deps.preferencesStore.getWorkspaces().flatMap((w) => w.folders),
    worktreeRoots: deps.worktreeRoots ?? (() => []),
    projectGrants: deps.projectGrants ?? (() => []),
  };
}
