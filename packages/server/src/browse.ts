/**
 * Directory browsing logic for the browse API endpoint.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { BrowseEntry, BrowseResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { isFilesystemRoot } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";

const MAX_ENTRIES = 200;
const WORD_BOUNDARY_CHARS = new Set(["-", "_", ".", " ", "/"]);

/**
 * Compute the rank tier for a name against a lowercase query.
 * Lower tier = better match.
 *   0: exact match
 *   1: prefix match
 *   2: word-boundary substring (preceded by -, _, ., space, /)
 *   3: plain substring
 *   4: no match (filter out)
 */
function rankTier(name: string, qLower: string): number {
  const nameLower = name.toLowerCase();
  if (nameLower === qLower) return 0;
  if (nameLower.startsWith(qLower)) return 1;
  const idx = nameLower.indexOf(qLower);
  if (idx < 0) return 4;
  const prev = nameLower[idx - 1];
  if (idx === 0 || (prev !== undefined && WORD_BOUNDARY_CHARS.has(prev))) return 2;
  return 3;
}

/**
 * List subdirectories of a given path.
 * Excludes hidden directories (starting with ".").
 * Detects .git and .pi subdirectories for visual hints.
 * When `q` is non-empty, filters by case-insensitive substring and ranks
 * (exact → prefix → word-boundary → substring), alphabetical within tier.
 * Caps at 200 entries AFTER filtering/ranking.
 */
export async function listDirectories(dirPath?: string, q?: string): Promise<BrowseResult> {
  const resolved = dirPath ?? os.homedir();

  // Verify the directory exists and is a directory
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    throw new Error("not a directory");
  }

  const rawEntries = await fs.readdir(resolved, { withFileTypes: true });

  // Filter: directories only, no hidden dirs
  let dirs = rawEntries.filter(
    (e) => e.isDirectory() && !e.name.startsWith(".")
  );

  // Apply optional substring filter + tiered ranking
  const qTrim = (q ?? "").trim();
  if (qTrim) {
    const qLower = qTrim.toLowerCase();
    const ranked = dirs
      .map((d) => ({ d, tier: rankTier(d.name, qLower) }))
      .filter((x) => x.tier < 4);
    ranked.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return a.d.name.toLowerCase().localeCompare(b.d.name.toLowerCase());
    });
    dirs = ranked.map((x) => x.d);
  } else {
    // Alphabetical, case-insensitive
    dirs.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }

  // Cap at MAX_ENTRIES (AFTER filtering/ranking)
  const capped = dirs.slice(0, MAX_ENTRIES);

  // Build entries with isGit/isPi detection
  const entries: BrowseEntry[] = await Promise.all(
    capped.map(async (d) => {
      const fullPath = path.join(resolved, d.name);
      const [isGit, isPi] = await Promise.all([
        fs.access(path.join(fullPath, ".git")).then(() => true, () => false),
        fs.access(path.join(fullPath, ".pi")).then(() => true, () => false),
      ]);
      return { name: d.name, path: fullPath, isGit, isPi };
    })
  );

  // Parent: null for any filesystem root (`/`, `C:\`, `\\server\share\`).
  // Previously this was `resolved === "/"`, which only recognized the Unix
  // root — on Windows `path.dirname("B:\\")` returns `"B:\\"`, so the
  // picker showed a useless `..` entry at drive roots.
  // See change: platform-path-normalization.
  const parent = isFilesystemRoot(resolved) ? null : path.dirname(resolved);

  return { entries, parent, current: resolved, platform: process.platform };
}

/**
 * Validate a directory name for mkdir.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateMkdirName(name: string): string | null {
  if (typeof name !== "string") return "invalid name";
  if (name.length === 0) return "invalid name";
  // No leading/trailing whitespace (also rejects whitespace-only)
  if (name !== name.trim()) return "invalid name";
  if (name === "." || name === "..") return "invalid name";
  if (name.includes("/") || name.includes("\\")) return "invalid name";
  if (name.includes("\0")) return "invalid name";
  return null;
}

/**
 * Create a new directory under `parent` named `name`.
 * Validates inputs, verifies parent exists and is a directory,
 * and creates the target non-recursively (fails if it already exists).
 * Returns the absolute path of the created directory.
 *
 * Throws Error with one of these messages:
 *   - "invalid name"
 *   - "parent not found"
 *   - "parent is not a directory"
 *   - "already exists"
 *   - or an OS error message for other failures.
 */
export async function createDirectory(parent: string, name: string): Promise<string> {
  const nameErr = validateMkdirName(name);
  if (nameErr) throw new Error(nameErr);

  if (typeof parent !== "string" || parent.length === 0 || !path.isAbsolute(parent)) {
    throw new Error("parent not found");
  }

  let parentStat;
  try {
    parentStat = await fs.stat(parent);
  } catch {
    throw new Error("parent not found");
  }
  if (!parentStat.isDirectory()) {
    throw new Error("parent is not a directory");
  }

  const target = path.join(parent, name);
  try {
    await fs.mkdir(target, { recursive: false });
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "EEXIST") throw new Error("already exists");
    throw err;
  }
  return target;
}
