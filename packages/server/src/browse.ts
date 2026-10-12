/**
 * Directory browsing logic for the browse API endpoint.
 *
 * Two responsibilities, kept deliberately separate:
 *   1. `listDirectories` — enumerate directory entries (cheap; one
 *      readdir call). Only probes `.git` / `.pi` when the caller
 *      explicitly opts in via `{ detect: true }`.
 *   2. `classifyPaths` — bulk-classify a list of absolute paths,
 *      returning `{ [path]: { isGit, isPi } }`. Used by the bulk
 *      `GET /api/browse/flags` endpoint and by the path picker's
 *      lazy second-phase fetch.
 *
 * See change: split-browse-flags.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isFilesystemRoot } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import { isPortableProjectName, projectNameProblem } from "@blackbelt-technology/pi-dashboard-shared/project-name.js";
import type { BrowseEntry, BrowseFlagEntry, BrowseResult, CreateProjectErrorReason } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { createSemaphore } from "@blackbelt-technology/pi-dashboard-shared/semaphore.js";

const MAX_ENTRIES = 200;

/** Hard cap on how many paths a single `/api/browse/flags` request may classify. */
export const MAX_FLAG_PATHS = 100;

/** Bound on in-flight `fs.access` calls inside a single `classifyPaths` invocation. */
const FLAG_PROBE_CONCURRENCY = 32;

/**
 * Probe a single absolute path for `.git` and `.pi` siblings using
 * `fs.access`. Any error — ENOENT, EACCES, ELOOP, race-on-deletion,
 * target removed mid-probe, anything — maps to `false` for that flag.
 * Worktree-safe: `.git` is a regular file in worktrees, and `fs.access`
 * accepts that just fine (no `readdir` shortcut, ever).
 */
async function probeFlags(absolutePath: string): Promise<BrowseFlagEntry> {
  const [isGit, isPi] = await Promise.all([
    fs.access(path.join(absolutePath, ".git")).then(() => true, () => false),
    fs.access(path.join(absolutePath, ".pi")).then(() => true, () => false),
  ]);
  return { isGit, isPi };
}
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
export async function listDirectories(
  dirPath?: string,
  q?: string,
  opts?: { detect?: boolean },
): Promise<BrowseResult> {
  const detect = opts?.detect === true;
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

  // Build entries. When `detect` is opt-in, probe `.git` / `.pi` for each
  // surviving entry; otherwise omit the flag fields entirely so the
  // single-syscall fast path stays a single syscall.
  const entries: BrowseEntry[] = detect
    ? await Promise.all(
        capped.map(async (d) => {
          const fullPath = path.join(resolved, d.name);
          const flags = await probeFlags(fullPath);
          return { name: d.name, path: fullPath, isGit: flags.isGit, isPi: flags.isPi };
        }),
      )
    : capped.map((d) => ({ name: d.name, path: path.join(resolved, d.name) }));

  // Parent: null for any filesystem root (`/`, `C:\`, `\\server\share\`).
  // Previously this was `resolved === "/"`, which only recognized the Unix
  // root — on Windows `path.dirname("B:\\")` returns `"B:\\"`, so the
  // picker showed a useless `..` entry at drive roots.
  // See change: platform-path-normalization.
  const parent = isFilesystemRoot(resolved) ? null : path.dirname(resolved);

  return { entries, parent, current: resolved, platform: process.platform };
}

/**
 * Bulk-classify a batch of absolute paths. Returns a map keyed by the
 * input paths whose values are `{ isGit, isPi }`. Probe failures (any
 * error) become `{ isGit: false, isPi: false }` for that key — the
 * function never throws on per-path failures. Caller is responsible for
 * bounding `paths.length` (the route does this via `parseFlagsQuery`).
 *
 * Internal `fs.access` fan-out is bounded via a tiny FIFO semaphore so
 * a single 100-path call cannot exhaust file descriptors.
 */
export async function classifyPaths(
  paths: string[],
): Promise<Record<string, BrowseFlagEntry>> {
  if (paths.length === 0) return {};
  const sem = createSemaphore(FLAG_PROBE_CONCURRENCY);
  const result: Record<string, BrowseFlagEntry> = {};
  await Promise.all(
    paths.map((p) =>
      sem.run(async () => {
        result[p] = await probeFlags(p);
      }),
    ),
  );
  return result;
}

/**
 * Result of parsing the `paths` query parameter for
 * `GET /api/browse/flags`. Pure / synchronous so route handlers can
 * map directly to HTTP 400 with the documented error string.
 */
export type ParseFlagsQueryResult =
  | { ok: true; paths: string[] }
  | { ok: false; error: "invalid paths" | "too many paths" };

/**
 * Parse the URL-encoded JSON-array `paths` query parameter. Validates:
 *   - present and non-empty string
 *   - parses as JSON
 *   - is an array
 *   - every element is a string
 *   - length ≤ MAX_FLAG_PATHS
 *
 * Note: an empty array (`paths=[]`) is valid and returns `{ ok: true,
 * paths: [] }` so the caller can short-circuit to `{ flags: {} }`.
 */
export function parseFlagsQuery(rawPaths: string | undefined): ParseFlagsQueryResult {
  if (typeof rawPaths !== "string" || rawPaths.length === 0) {
    return { ok: false, error: "invalid paths" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPaths);
  } catch {
    return { ok: false, error: "invalid paths" };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: "invalid paths" };
  if (!parsed.every((p) => typeof p === "string")) {
    return { ok: false, error: "invalid paths" };
  }
  if (parsed.length > MAX_FLAG_PATHS) {
    return { ok: false, error: "too many paths" };
  }
  return { ok: true, paths: parsed as string[] };
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

/** Stable machine codes for `createProjectDirectory` failures (see shared/rest-api.ts). */
export type CreateProjectReason = CreateProjectErrorReason;

export class CreateProjectError extends Error {
  readonly reason: CreateProjectReason;

  constructor(
    reason: CreateProjectReason,
    message: string,
  ) {
    super(message);
    this.reason = reason;
    this.name = "CreateProjectError";
  }
}

/** Default projects root directory name, inside the server user's home. */
const PROJECTS_ROOT_NAME = "Projects";
const errCode = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | undefined)?.code;

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Remove a directory this request created, never following a link. */
async function removeCreated(target: string): Promise<void> {
  try {
    if ((await fs.lstat(target)).isDirectory()) await fs.rmdir(target);
  } catch {
    /* best effort */
  }
}

/**
 * Create or reuse `<homeDir>/Projects/<name>` and return its real path.
 * Nothing above `<homeDir>` is ever created; the resolved directory must be
 * strictly inside the root's real path. Throws `CreateProjectError`.
 * See change: streamline-first-run (design D4).
 */
export async function createProjectDirectory(
  name: unknown,
  homeDir: string = os.homedir(),
): Promise<{ path: string; existed: boolean }> {
  // Boolean guard first (a CodeQL path-injection barrier); the reason is only computed on failure.
  if (!isPortableProjectName(name)) {
    const problem = projectNameProblem(name) ?? "invalid_name";
    throw new CreateProjectError(problem, problem === "reserved_name" ? "reserved name" : problem === "too_long" ? "name too long" : "invalid name");
  }

  if (!(await isDirectory(homeDir))) {
    throw new CreateProjectError("home_missing", "home directory not found");
  }

  const root = path.join(homeDir, PROJECTS_ROOT_NAME);
  try {
    await fs.mkdir(root, { recursive: false });
  } catch (err) {
    if (errCode(err) !== "EEXIST") throw new CreateProjectError("fs_error", "could not create projects root");
  }
  let rootReal: string;
  try {
    rootReal = await fs.realpath(root);
  } catch (err) {
    if (errCode(err) === "ENOENT") {
      throw new CreateProjectError("root_not_a_directory", "projects root is not a directory");
    }
    throw new CreateProjectError("fs_error", "could not resolve projects root");
  }
  if (!(await isDirectory(rootReal))) {
    throw new CreateProjectError("root_not_a_directory", "projects root is not a directory");
  }

  // Lexical containment before any disk access (belt and braces over the name guard;
  // the realpath check below covers links). `path.resolve` normalizes first.
  const rootPrefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  const target = path.resolve(rootReal, name);
  if (!target.startsWith(rootPrefix)) {
    throw new CreateProjectError("invalid_name", "invalid name");
  }
  let created = false;
  try {
    await fs.mkdir(target, { recursive: false });
    created = true;
  } catch (err) {
    const code = errCode(err);
    if (code === "ENAMETOOLONG") throw new CreateProjectError("too_long", "name too long");
    if (code !== "EEXIST") throw new CreateProjectError("fs_error", "could not create project directory");
  }

  let targetReal: string;
  try {
    targetReal = await fs.realpath(target);
  } catch (err) {
    if (created) await removeCreated(target);
    if (errCode(err) === "ENOENT") throw new CreateProjectError("not_a_directory", "target is not a directory");
    throw new CreateProjectError("fs_error", "could not resolve project directory");
  }
  if (!targetReal.startsWith(rootPrefix)) {
    if (created) await removeCreated(target);
    throw new CreateProjectError("outside_root", "project directory resolves outside the projects root");
  }
  if (!(await isDirectory(targetReal))) {
    throw new CreateProjectError("not_a_directory", "target is not a directory");
  }
  return { path: targetReal, existed: !created };
}
