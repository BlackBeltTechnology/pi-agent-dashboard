/**
 * Scope-aware write-authorization guard for the markdown editing surface.
 *
 * This is the single security boundary for `POST /api/file/write`. The dashboard
 * is tunnellable/remote, so the moment markdown editing exists there is a write
 * surface above project roots. cwd-containment alone cannot express "this
 * specific home subtree", so the global branch is an explicit allowlist root.
 *
 * Two branches:
 *   - Directory scope (`cwd` present): allow markdown files contained under
 *     `<cwd>` (covers `<cwd>/**` including the `<cwd>/.pi/**` tree). Reuses the
 *     `within()` containment compare from `path-containment`.
 *   - Global scope (`cwd` absent): allow markdown files only under
 *     `~/.pi/agent`. An explicit allowlist root, NOT cwd containment.
 *
 * Every target is realpath-normalized first (via `safeRealpath`), so symlink
 * and `..` traversal that escapes the allowed subtree is collapsed and rejected
 * before the containment check. The final on-disk target's extension must be
 * `.md` / `.mdx` — a same-dir symlink to a `.txt` is therefore rejected too.
 *
 * See change: directory-settings-page-and-scoped-md-editing.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { safeRealpath, within } from "./path-containment.js";

/** Writable markdown extensions. Mirrors `WRITABLE_MARKDOWN_EXTENSIONS` in shared `file-kind`. */
const WRITABLE_MD_EXTENSIONS = new Set([".md", ".mdx"]);

/** Lowercased extension including the leading dot, or `""` when none (dotfiles count as none). */
function extOf(p: string): string {
  const base = path.basename(p);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot).toLowerCase();
}

export interface WritableMdTargetOptions {
  /** Directory scope anchor. When omitted, the global `~/.pi/agent` allowlist applies. */
  cwd?: string;
  /**
   * Override the home dir used to derive the global `~/.pi/agent` root. Defaults
   * to `os.homedir()`. Injectable so tests need not touch the real home.
   */
  home?: string;
}

/**
 * Resolve the realpath-normalized markdown subtree the write may target, or
 * `null` when the scope cannot produce one.
 *
 * Uses STRICT `fs.realpath` (not `safeRealpath`): the scope root MUST exist on
 * disk. `safeRealpath` falls back to the nearest existing ancestor for a missing
 * path, which would silently WIDEN an absent `~/.pi/agent` to `~/.pi` (or `~`)
 * and authorize writes under the parent. A missing root therefore fails closed.
 */
async function allowedRoot(opts: WritableMdTargetOptions): Promise<string | null> {
  const raw = opts.cwd
    ? path.resolve(opts.cwd)
    : (() => {
        const home = opts.home ?? os.homedir();
        return home ? path.join(home, ".pi", "agent") : null;
      })();
  if (!raw) return null; // missing-home → fail closed
  try {
    return await fs.realpath(raw);
  } catch {
    return null; // missing / unresolvable scope root → fail closed
  }
}

/**
 * True iff `absPath` is an authorized markdown write target for the given scope.
 *
 * Realpath-normalizes both the target and the scope root before comparing, so
 * symlink / `..` escape is rejected. The resolved target's extension must be a
 * writable markdown extension. Never throws — any I/O failure resolves a
 * fail-closed `false`.
 */
export async function isWritableMdTarget(
  absPath: string,
  opts: WritableMdTargetOptions = {},
): Promise<boolean> {
  if (!path.isAbsolute(absPath)) return false;
  try {
    const root = await allowedRoot(opts);
    if (!root) return false;
    const real = await safeRealpath(path.resolve(absPath));
    // Extension is checked on the *resolved* target so a same-dir symlink to a
    // non-markdown file (e.g. notes.md → secret.txt) is rejected.
    if (!WRITABLE_MD_EXTENSIONS.has(extOf(real))) return false;
    return within(real, root);
  } catch {
    return false;
  }
}
