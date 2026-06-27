/**
 * Shared path-containment helper for the localhost file routes.
 *
 * Containment anchors at the **git common root**, not the leaf session cwd, so
 * a git-worktree (or any repo-subdir) session can read sibling trees within the
 * same repository. Evaluated in two layers per anchor:
 *
 *   ① logical: resolved under `anchor` (pure string op, no spawn — the hot path).
 *   ② git-root: `gitRoot(anchor) !== anchor` AND the **real** resolved path
 *      (`fs.realpath`) under the real git common root. git is spawned only on a
 *      layer-① miss (cwd-escape), which is rare.
 *
 * The widening is **unconditional** (no loopback gate, D6): the repo is one
 * shared trust domain; `networkGuard` stays the gate for reaching the route.
 * A degraded git environment fails closed to cwd-only containment (D2) — it can
 * never widen the allowed set, only narrow it.
 *
 * Known limitations (fail closed in every case):
 *   - Submodule session: `dirname(--git-common-dir)` is `<super>/.git/modules/<name>`,
 *     a path inside `.git` with no working-tree files. Layer ② matches nothing →
 *     degrades to cwd-only. The widening simply does not apply to submodules.
 *   - `git init --separate-git-dir`: when `.git` is not directly under the
 *     worktree root, `dirname(--git-common-dir)` ≠ worktree root → layer ② may
 *     under-contain (never over-contain). Rare; accepted.
 */
import path from "node:path";
import fs from "node:fs/promises";
// Real node execFile + promisify (returns {stdout,stderr} via the custom
// promisify symbol). The platform/exec wrapper's execFileAsync lacks that
// symbol and resolves with the bare stdout string, so it is unsuitable here.
// Mirrors pi-core-checker.ts's precedent.
import { execFile } from "node:child_process"; // ban:child_process-ok git-root probe needs promisify({stdout,stderr}); platform/exec wrapper loses the custom promisify shape
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Logical containment compare. `p` is contained by `base` when it equals `base`
 * or sits under it. Uses `path.relative` rather than a prefix `startsWith`:
 * `path.resolve` does NOT canonicalize drive-letter case on Windows, so a raw
 * prefix compare wrongly rejects `c:\repo\f` against `C:\repo` (G2). A relative
 * path that is empty, or that does not climb out (`..`) and is not absolute,
 * means `p` sits under `base`.
 */
export function within(p: string, base: string): boolean {
  const rel = path.relative(base, p);
  return rel === "" || (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel));
}

/**
 * Resolve symlinks in `p`. When `p` does not exist, resolve the nearest existing
 * ancestor and re-append the non-existent tail, so a probe path still gets its
 * real (symlink-collapsed) prefix without throwing.
 */
async function safeRealpath(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p; // filesystem root
    const realParent = await safeRealpath(parent);
    return path.join(realParent, path.basename(p));
  }
}

/**
 * Git common root of `cwd` = `dirname(git -C cwd rev-parse
 * --path-format=absolute --git-common-dir)`. Returns `cwd` itself on ANY error
 * (not a repo, git absent, spawn failure, empty output, probe timeout) so layer
 * ② collapses to a no-op. Result is normalized via `path.resolve` (native
 * separators + drive case, G2) before returning. Not cached — layer ② is a cold
 * path (D5). The probe is bounded by a 2 s timeout so a stuck `git` process
 * cannot hang the route — a timeout throws, is caught, and degrades to `cwd`.
 *
 * Fails closed unless the common dir basename is exactly `.git` — i.e. a normal
 * checkout or a linked worktree (both report `<root>/.git`). This rejects:
 *   - bare repos (`<x>/bare.git` → `dirname` would widen to `<x>`, the parent
 *     directory of unrelated files),
 *   - submodules (`<super>/.git/modules/<name>` → `dirname` inside `.git`),
 *   - `--separate-git-dir` (external `.git` dir, basename ≠ `.git`).
 * Each of these would otherwise mis-widen or leak git internals; degrading to
 * `cwd` keeps containment safe (never wider than cwd-only).
 */
export async function gitRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { timeout: 2_000, windowsHide: true },
    );
    const gitCommonDir = stdout.trim();
    if (!gitCommonDir) return cwd;
    const normalized = path.resolve(gitCommonDir);
    if (path.basename(normalized) !== ".git") return cwd; // bare / submodule / separate-git-dir → fail closed
    return path.dirname(normalized);
  } catch {
    return cwd;
  }
}

/**
 * Allow `resolved` if it is contained by ANY anchor's cwd-subtree (layer ①) or
 * that anchor's git-common-root subtree (layer ②). All anchors are checked
 * against layer ① first so the git spawn only fires when every fast path misses.
 */
export async function isAllowed(
  resolved: string,
  { anchors }: { anchors: string[] },
): Promise<boolean> {
  // Layer ① — logical, no spawn. Catches ~every real read.
  for (const anchor of anchors) {
    if (within(resolved, anchor)) return true;
  }
  // Layer ② — git common root, real-path'd (symlink-safe). Cold path.
  for (const anchor of anchors) {
    const root = await gitRoot(anchor);
    if (root === anchor) continue; // fail-closed: no widening
    const realResolved = await safeRealpath(resolved);
    const realRoot = await safeRealpath(root);
    if (within(realResolved, realRoot)) return true;
  }
  return false;
}
