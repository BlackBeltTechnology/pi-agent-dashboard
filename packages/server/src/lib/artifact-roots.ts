/**
 * Artifact-root allowlist for `/api/file/raw` image previews (layer ③).
 *
 * Agent tools (e.g. the `browser` skill) write screenshots to a per-user,
 * cross-repo temp dir outside every session cwd and every git root. Those paths
 * fail cwd/git-root containment (layers ①/②), so the raw route gains these
 * roots as an additional, image-only containment anchor.
 *
 * Roots (realpath-resolved, cached for the server lifetime):
 *   - join(os.homedir(), ".agent-browser", "tmp")        (default)
 *   - process.env.AGENT_BROWSER_SCREENSHOT_DIR           (when set — the SAME
 *     env var the `agent-browser` CLI honors; NOT a dashboard-invented
 *     `AGENT_BROWSER_TMP`)
 *
 * A root whose realpath throws (missing dir) is dropped, not fatal.
 *
 * Best-effort scope (A1): `agent-browser --screenshot-dir <path>` (CLI flag)
 * writes elsewhere and is invisible to the server, so it stays UNCOVERED. The
 * complete fix is inline transport (Fix B); see change proposal.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeRealpath, within } from "./path-containment.js";

// Mirrors the client's IMAGE_EXTS (FilePreviewOverlay.tsx). Extensions WITHOUT
// the leading dot. Layer ③ serves ONLY these from an artifact root.
export const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);

let cached: string[] | null = null;

/**
 * Real-path-resolved artifact roots. Cached for the server lifetime (realpath
 * is a syscall and the raw route is hot). Entries whose realpath throws
 * (missing dir) are dropped.
 */
export function artifactRoots(): string[] {
  if (cached) return cached;
  const candidates = [
    path.join(os.homedir(), ".agent-browser", "tmp"),
    process.env.AGENT_BROWSER_SCREENSHOT_DIR,
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  const roots: string[] = [];
  for (const c of candidates) {
    try {
      roots.push(fs.realpathSync(c));
    } catch {
      // missing dir → drop, not fatal
    }
  }
  cached = roots;
  return cached;
}

/** Test-only: clear the cached roots so a test can vary env / dirs. */
export function resetArtifactRootsCache(): void {
  cached = null;
}

/**
 * Layer ③ containment: true when `resolved` is an image (by extension) whose
 * REAL path lies within an artifact root. Real-path collapses `..` and
 * symlinks (D4), so an escape out of the root fails containment. A missing /
 * deleted file resolves its nearest existing ancestor (via `safeRealpath`),
 * stays contained, and is allowed through so the route's `fs.stat` yields the
 * normal 404 rather than a 500 (A3, D7).
 */
export async function isImageUnderArtifactRoot(resolved: string): Promise<boolean> {
  const ext = path.extname(resolved).slice(1).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) return false;
  const roots = artifactRoots();
  if (roots.length === 0) return false;
  const real = await safeRealpath(resolved);
  return roots.some((root) => within(real, root));
}
