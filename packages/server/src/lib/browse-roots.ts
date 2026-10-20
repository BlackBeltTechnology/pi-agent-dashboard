/**
 * Allowed-root confinement for the directory-browse endpoints
 * (`/api/browse`, `/api/browse/flags`, `/api/browse/mkdir`).
 *
 * These routes carry only `networkGuard`, so before this module
 * `/api/browse?path=/` enumerated the whole filesystem and
 * `/api/browse/mkdir` created a directory anywhere — over a tunnel that is a
 * filesystem-enumeration + write primitive outside the containment model.
 *
 * The allowed set is `$HOME` plus the pinned directories. Both sides are
 * compared on REAL paths (`safeRealpath`), so a symlink inside an allowed root
 * that points out of it is refused rather than followed.
 *
 * See change: harden-server-capability-bounds (B8).
 */
import os from "node:os";
import path from "node:path";
import { safeRealpath, within } from "./path-containment.js";

/** Stable client-facing message for a refused browse/mkdir path. */
export const BROWSE_OUTSIDE_ROOTS_ERROR = "path outside allowed roots";

/** Real paths of `$HOME` and every pinned directory, deduplicated. */
export async function resolveBrowseRoots(
  pinnedDirs: readonly string[],
  home: string = os.homedir(),
): Promise<string[]> {
  const real = await Promise.all([home, ...pinnedDirs].map((d) => safeRealpath(path.resolve(d))));
  return [...new Set(real)];
}

/** True when `target` (symlinks resolved) sits at or under one of `roots` (already real paths). */
export async function isWithinBrowseRoots(target: string, roots: readonly string[]): Promise<boolean> {
  const real = await safeRealpath(path.resolve(target));
  return roots.some((root) => within(real, root));
}
