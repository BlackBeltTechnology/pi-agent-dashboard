/**
 * The ONE `.git`/`.pi` project-root test (change: add-access-provisioning, D8).
 * A directory is a project root when it holds an entry named `.git` (directory
 * or worktree file) or `.pi`. Node-only (`node:fs`); the browser client MUST NOT import it.
 */
import * as fs from "node:fs";
import path from "node:path";

/** True when `dir` holds an entry named `.git` or `.pi`. Never throws. */
export function hasProjectRootMarker(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, ".git")) || fs.existsSync(path.join(dir, ".pi"));
  } catch {
    return false;
  }
}
