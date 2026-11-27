/**
 * Sole-writer guard of `openspec-apply` teams (design D9, spec "Teammates do not edit tasks.md or spec deltas",
 * "Guard resists case and hardlink aliases"): blocks the `write` and `edit` tools for MEMBERS of an apply team
 * when the target is `<lead cwd>/openspec/changes/<name>/tasks.md` or anything under
 * `<lead cwd>/openspec/changes/<name>/specs/`. The runtime ticks checkboxes; spec deltas are the lead's.
 *
 * The decision is made on the path the tool will really open:
 *  - pi's own path normalisation (`resolveToolPath`: `@`, `~`, unicode spaces, `..`), then
 *  - `realpath.native` of the nearest existing ancestor with the missing tail re-appended (a symlinked file or
 *    directory, or a not-yet-existing target below a symlinked parent, resolves to its real place),
 *  - component-wise comparison under the canonical `openspec/changes` root, case-folded when the volume is
 *    case-insensitive (`TASKS.MD` on APFS/NTFS is the same file),
 *  - for an EXISTING target with more than one link: `dev` + `ino` against every protected file (a hardlink has
 *    a different path and the same inode).
 * `changes/archive/**` and `openspec/specs/**` (main specs) are not protected. Any failure to resolve a path
 * blocks the call (fail closed). `bash` is NOT covered (advisory hole, stated in the briefing).
 * Switched on by the spawn contributor env `PI_EXT_AGENT_TEAMS_OPENSPEC_PROFILE=apply`; never by an agent argument.
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import path from "node:path";
import { canonicalizeTarget, defaultResolveEnv, defaultVolumeProbe, type ResolveEnv, resolveToolPath } from "@blackbelt-technology/pi-dashboard-shared/tool-path-resolve.js";

export const OPENSPEC_SOLE_WRITER_REASON = "openspec_sole_writer: tasks.md and spec deltas under openspec/changes/<name>/specs/ are written by the runtime only (sole-writer rule); do not edit them";

const PATH_KEYS = ["path", "file_path"] as const;
const MAX_PROTECTED_FILES = 5000;

/** Real host environment with `fs.realpath.native` (the OS answer, including on-disk case on a case-insensitive volume). */
export function nativeResolveEnv(): ResolveEnv {
  return { ...defaultResolveEnv(), realpathSync: (p) => fs.realpathSync.native(p) };
}

export interface OpenspecGuardOptions {
  env?: ResolveEnv;
  /** Force the volume case sensitivity (tests); default: probed from the volume of the changes root. */
  caseInsensitive?: boolean;
}

const fold = (s: string, ci: boolean): string => (ci ? s.normalize("NFC").toLowerCase() : s.normalize("NFC"));

/** Whether `rel` (relative to the canonical changes root, already folded) names `<name>/tasks.md` or lies under `<name>/specs`. */
function protectedRelative(parts: readonly string[]): boolean {
  const [name, second] = parts;
  if (parts.length < 2 || name === ".." || name === "archive") return false;
  return (parts.length === 2 && second === "tasks.md") || second === "specs";
}

/** Regular files below `root` (bounded walk): `budget.left` counts the entries that may still be listed. */
function* filesBelow(root: string, budget: { left: number }): Generator<string> {
  const stack = [root];
  while (stack.length > 0 && budget.left > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (--budget.left < 0) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else yield p;
    }
  }
}

/** Files whose inode is protected: `<name>/tasks.md` and the files under `<name>/specs` (bounded walk). */
function* protectedFiles(changesRoot: string): Generator<string> {
  const budget = { left: MAX_PROTECTED_FILES };
  let names: string[];
  try {
    names = fs.readdirSync(changesRoot);
  } catch {
    return;
  }
  for (const name of names.filter((n) => n !== "archive")) {
    yield path.join(changesRoot, name, "tasks.md");
    yield* filesBelow(path.join(changesRoot, name, "specs"), budget);
  }
}

/** `dev:ino` of an existing target with several links that is one of the protected files. */
function isHardlinkOfProtected(target: string, changesRoot: string): boolean {
  let st: fs.Stats;
  try {
    st = fs.statSync(target);
  } catch {
    return false; // does not exist (yet): no inode to compare
  }
  if (!st.isFile() || st.nlink < 2) return false;
  for (const file of protectedFiles(changesRoot)) {
    try {
      const other = fs.statSync(file);
      if (other.dev === st.dev && other.ino === st.ino) return true;
    } catch {
      // absent protected file
    }
  }
  return false;
}

/** Is `rawPath` (as the tool received it, relative to `cwd`) a protected OpenSpec file? Throws when it cannot be resolved. */
export function isProtectedOpenspecPath(rawPath: string, cwd: string, opts: OpenspecGuardOptions = {}): boolean {
  const env = opts.env ?? nativeResolveEnv();
  const target = canonicalizeTarget(resolveToolPath(rawPath, cwd, env), env);
  const changesRoot = canonicalizeTarget(path.resolve(cwd, "openspec", "changes"), env);
  const ci = opts.caseInsensitive ?? defaultVolumeProbe(changesRoot, env);
  const rel = path.relative(fold(changesRoot, ci), fold(target, ci));
  if (rel !== "" && !path.isAbsolute(rel) && protectedRelative(rel.split(path.sep))) return true;
  return isHardlinkOfProtected(target, changesRoot);
}

/** The guard decision for one tool call of an apply-team member; `undefined` = no opinion (allow). */
export function openspecWriteBlock(toolName: unknown, input: unknown, cwd: string, opts: OpenspecGuardOptions = {}): string | undefined {
  if (toolName !== "write" && toolName !== "edit") return undefined;
  const args = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  for (const key of PATH_KEYS) {
    const v = args[key];
    if (typeof v !== "string") continue;
    try {
      if (isProtectedOpenspecPath(v, cwd, opts)) return OPENSPEC_SOLE_WRITER_REASON;
    } catch {
      return `${OPENSPEC_SOLE_WRITER_REASON} (the path could not be resolved)`;
    }
  }
  return undefined;
}
