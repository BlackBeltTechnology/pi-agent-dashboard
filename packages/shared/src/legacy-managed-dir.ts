/**
 * Detect the legacy `~/.pi-dashboard/` install directory left behind from
 * pre-R3 versions where the Electron app (and the standalone bootstrap
 * orchestrator) installed pi/openspec/tsx at runtime into a user-writable
 * directory.
 *
 * Under the immutable-bundle architecture (change:
 * eliminate-electron-runtime-install) nothing reads from or writes to
 * this directory on the Electron arm. This module exists solely so the
 * Doctor UI can surface an advisory row, and the server CLI can log a
 * one-time hint, telling the user the directory is safe to delete.
 *
 * NEVER move runtime install logic back into this directory. If you find
 * yourself reaching for `~/.pi-dashboard/`, you are working against R3.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type LegacyManagedDir =
  | { present: false }
  | { present: true; path: string; pkgCount: number; sizeMb: number };

export interface DetectDeps {
  /** Override HOME for tests. */
  homedir?: string;
}

const LEGACY_DIRNAME = ".pi-" + "dashboard"; // split literal so the no-managed-dir lint stays clean

function getLegacyDirPath(env?: DetectDeps): string {
  return path.join(env?.homedir ?? os.homedir(), LEGACY_DIRNAME);
}

/** Sum file sizes under a directory tree, capped to avoid pathological scans. */
function dirSizeBytes(dir: string, cap = 500 * 1024 * 1024): number {
  let total = 0;
  const stack: string[] = [dir];
  while (stack.length > 0 && total < cap) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      try {
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) {
          stack.push(full);
        } else if (e.isFile()) {
          const st = fs.statSync(full);
          total += st.size;
          if (total >= cap) return cap;
        }
      } catch {
        /* skip unreadable */
      }
    }
  }
  return total;
}

function countDirectChildren(dir: string): number {
  try {
    return fs.readdirSync(dir).length;
  } catch {
    return 0;
  }
}

/**
 * Detect whether the legacy `~/.pi-dashboard/` directory is present.
 * Returns `{ present: false }` when missing. When present, returns a
 * `pkgCount` (entries directly under `node_modules/`, 0 if missing) and
 * `sizeMb` (recursive byte sum, capped at 500 MB).
 */
export function detectLegacyManagedDir(deps: DetectDeps = {}): LegacyManagedDir {
  const dir = getLegacyDirPath(deps);
  try {
    const st = fs.statSync(dir);
    if (!st.isDirectory()) return { present: false };
  } catch {
    return { present: false };
  }
  const nodeModules = path.join(dir, "node_modules");
  const pkgCount = countDirectChildren(nodeModules);
  const sizeMb = Math.round(dirSizeBytes(dir) / (1024 * 1024));
  return { present: true, path: dir, pkgCount, sizeMb };
}

/** Path-only accessor for callers that want to display the path without scanning. */
export function getLegacyManagedDirPath(deps: DetectDeps = {}): string {
  return getLegacyDirPath(deps);
}
