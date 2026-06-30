/**
 * Bounded enumerator for the Instructions file picker.
 *
 * Produces the scope-bounded set of writable markdown candidates the picker may
 * offer. Every candidate is filtered through `isWritableMdTarget`, so the picker
 * is a strict subset of what the write guard authorizes (picker ⊆ guard) — the
 * UI can never present a target the server would reject.
 *
 * Scope:
 *   - Directory (`cwd` present): bounded walk of `<cwd>` for `.md`/`.mdx`,
 *     including the `.pi/` tree. Heavy / irrelevant dirs are skipped.
 *   - Global (`cwd` absent): bounded walk of `~/.pi/agent` for `.md`/`.mdx`.
 *
 * Not the `pi-resource-scanner` (which enumerates skills/extensions/prompts, not
 * arbitrary instruction markdown). A dedicated walk matches the spec's "markdown
 * files under the folder cwd and its `.pi/` tree".
 *
 * See change: directory-settings-page-and-scoped-md-editing.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isWritableMdTarget } from "./writable-md-target.js";

const MD_EXTENSIONS = new Set([".md", ".mdx"]);
/** Dirs never worth walking for instruction markdown. */
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage",
  ".venv", "__pycache__", ".worktrees", ".cache", "vendor",
]);
const MAX_DEPTH = 6;
const MAX_CANDIDATES = 500;

export interface MdCandidate {
  /** Absolute, on-disk path. */
  path: string;
  /** Path relative to the scope root, for display in the picker. */
  relPath: string;
}

export interface MdCandidateOptions {
  cwd?: string;
  /** Override home for the global scope root. Defaults to `os.homedir()`. */
  home?: string;
}

/** Resolve the scope root, or `null` when it cannot be derived. */
function scopeRoot(opts: MdCandidateOptions): string | null {
  if (opts.cwd) return path.resolve(opts.cwd);
  const home = opts.home ?? os.homedir();
  if (!home) return null;
  return path.join(home, ".pi", "agent");
}

function extOf(p: string): string {
  const base = path.basename(p);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

/**
 * Enumerate writable markdown candidates for the given scope. Never throws;
 * unreadable dirs are skipped. Results are sorted by relPath and capped.
 */
/**
 * Recursive bounded markdown walk. Appends absolute `.md`/`.mdx` paths into
 * `found` (mutated). Skips heavy dirs, honors depth + count caps. Never throws.
 */
async function walkMd(dir: string, depth: number, found: string[]): Promise<void> {
  if (depth > MAX_DEPTH || found.length >= MAX_CANDIDATES) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (found.length >= MAX_CANDIDATES) return;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walkMd(abs, depth + 1, found);
    } else if (entry.isFile() && MD_EXTENSIONS.has(extOf(entry.name))) {
      found.push(abs);
    }
  }
}

export async function enumerateMdCandidates(opts: MdCandidateOptions = {}): Promise<MdCandidate[]> {
  const root = scopeRoot(opts);
  if (!root) return [];

  const found: string[] = [];
  await walkMd(root, 0, found);

  // Filter through the write guard so picker ⊆ guard (symlink-escape etc. pruned).
  const allowed: MdCandidate[] = [];
  for (const abs of found) {
    if (await isWritableMdTarget(abs, opts)) {
      allowed.push({ path: abs, relPath: path.relative(root, abs) });
    }
  }
  allowed.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return allowed;
}
