/**
 * Shared path-containment helper for the localhost file routes.
 *
 * Containment anchors at the **resolved, repository-BOUND checkout roots** of
 * each anchor — not the leaf session cwd, and not `dirname(--git-common-dir)`
 * — so a git-worktree (or any repo-subdir) session can read sibling trees
 * within the same repository, and a submodule / `--separate-git-dir` /
 * worktree-of-bare session can read its OWN checkout. Evaluated in two layers
 * per anchor:
 *
 *   ① logical: resolved under `anchor` (pure string op, no spawn — the hot path).
 *   ② checkout roots: the anchor's `thisCheckout` / `mainCheckout` from the
 *      shared resolver, each kept only when BOUND to the anchor's repository,
 *      deduplicated, and compared on real paths (`fs.realpath`). git is spawned
 *      only on a layer-① miss (cwd-escape), which is rare.
 *
 * The widening is **unconditional** (no loopback gate; `git-root-file-containment`
 * D6, the superseded change that introduced this helper): the repo is one
 * shared trust domain; `networkGuard` stays the gate for reaching the route.
 * A degraded git environment fails closed to cwd-only containment (D2) — it can
 * never widen the allowed set, only narrow it.
 *
 * Resolution is ASYNC. A remote caller can force layer ② at will by requesting
 * an out-of-cwd path, so probing git synchronously here would let one caller
 * stall every other request; every probe is bounded and `await`ed instead.
 *
 * No checkout root reaches beyond the checkouts its repository owns. A submodule
 * session never reaches its superproject, a worktree of a bare hub never
 * reaches the directory holding the hub, and a `--separate-git-dir` session
 * never reaches the directory holding its git dir. A repository-local
 * `core.worktree` naming an unrelated directory does not widen either: the
 * resolver returns that value verbatim, so every root is bound back to the
 * repository before use. Each of those is a test.
 *
 * See change: widen-containment-to-resolved-checkout (was: git-root-file-containment).
 */
import path from "node:path";
import fs from "node:fs/promises";
import { checkoutRootsAsync, isBoundCheckoutAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import { samePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";

/** Per-probe budget for the async resolver and for each binding re-resolution. */
const PROBE_TIMEOUT_MS = 2_000;

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
export async function safeRealpath(p: string): Promise<string> {
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
 * The BOUND checkout roots of `anchor`: the resolver's `thisCheckout` and
 * `mainCheckout`, each kept only when it is bound to the anchor's repository,
 * deduplicated by `samePath` BEFORE binding so a non-worktree state (where the
 * two are equal) binds once rather than twice.
 *
 * Returns `[]` on ANY failure — not a repository, `git` absent, spawn failure,
 * probe timeout, no bound root — which makes layer ② a no-op for that anchor and
 * degrades containment to the anchor subtree alone. Never throws. Not cached:
 * layer ② is a cold path.
 */
export async function checkoutAnchors(anchor: string): Promise<string[]> {
  const roots = await checkoutRootsAsync({ cwd: anchor, timeout: PROBE_TIMEOUT_MS });
  if (!roots) return [];

  const candidates: string[] = [];
  for (const candidate of [roots.thisCheckout, roots.mainCheckout]) {
    if (!candidate) continue;
    if (candidates.some((seen) => samePath(seen, candidate))) continue;
    candidates.push(candidate);
  }

  const bound: string[] = [];
  for (const candidate of candidates) {
    if (await isBoundCheckoutAsync(candidate, roots.commonDir, { timeout: PROBE_TIMEOUT_MS })) {
      bound.push(candidate);
    }
  }
  return bound;
}

/**
 * Allow `resolved` if it is contained by ANY anchor's cwd-subtree (layer ①) or
 * by that anchor's bound checkout roots (layer ②). All anchors are checked
 * against layer ① first so git is spawned only when every fast path misses.
 */
export async function isAllowed(
  resolved: string,
  { anchors }: { anchors: string[] },
): Promise<boolean> {
  // Layer ① — logical, no spawn. Catches ~every real read.
  for (const anchor of anchors) {
    if (within(resolved, anchor)) return true;
  }
  // Layer ② — bound checkout roots, real-path'd (symlink-safe). Cold path.
  const realResolved = await safeRealpath(resolved);
  for (const anchor of anchors) {
    for (const root of await checkoutAnchors(anchor)) {
      if (samePath(root, anchor)) continue; // no widening: that subtree is layer ①
      if (within(realResolved, await safeRealpath(root))) return true;
    }
  }
  return false;
}
