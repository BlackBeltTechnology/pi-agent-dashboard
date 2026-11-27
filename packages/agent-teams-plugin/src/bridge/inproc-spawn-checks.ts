/**
 * Host-side admission of a spawn command before any upstream call (design D8/D9; tasks 6.7, 6.8, 6.10). A refusal creates NO child and
 * becomes the spawn ack's stable error code:
 *  - `skills_unavailable_in_process`: a non-empty `skills` grant without feature `loader_skills` (the child loads no project or user
 *    skills, so the grant could not be honoured); an EMPTY grant is fine (layers 2–4 of the child guard remove every skill)
 *  - `prompt_file_unreadable`: a resolved prompt file that is missing, unreadable or not valid text (no NUL, valid UTF-8)
 *  - `cwd_outside_scope`: a directory the package's `cwdScope:"repo"` would refuse, unless feature `cwd_scope` exists (then the request
 *    carries `cwdScope:"any"`, and ONLY in that case); core's `cwd_outside_lead` confinement already ran on the server
 * The cwd classification mirrors the package's own `resolveSubagentCwd` (`extensions/cwd.ts`): real paths, the lead cwd subtree, the lead's
 * git top-level, or a worktree sharing the lead's git common dir. Errors name the FIELD, never file contents.
 * See change: add-agent-teams-in-process.
 */
import { execFileSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { InProcSpawnSpec } from "../shared/inproc-protocol.js";
import type { SubagentsFeature } from "../shared/subagents-contract.js";

export interface SpawnRefusal {
  error: "skills_unavailable_in_process" | "prompt_file_unreadable" | "cwd_outside_scope";
  message: string;
}

/** A non-empty skill grant needs the loader pass-through. */
export function checkSkills(spec: Pick<InProcSpawnSpec, "skills">, features: readonly SubagentsFeature[]): SpawnRefusal | undefined {
  if (!spec.skills || spec.skills.length === 0 || features.includes("loader_skills")) return undefined;
  return { error: "skills_unavailable_in_process", message: "a skill allowlist needs the subagents feature loader_skills; spawn the teammate without skills or use session mode" };
}

/** Prompt files are appended to a system prompt: a bigger one than this is not a prompt file. */
const PROMPT_FILE_MAX_BYTES = 8 * 1024 * 1024;

export type ReadFileFn = (path: string) => Promise<Uint8Array>;

/** Every file must be readable valid UTF-8 text without NUL (empty is valid). */
export async function checkPromptFiles(files: readonly string[], read: ReadFileFn = readFile): Promise<SpawnRefusal | undefined> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let i = 0; i < files.length; i++) {
    const unreadable = (why: string): SpawnRefusal => ({ error: "prompt_file_unreadable", message: `prompt file #${i + 1} ${why}` });
    let bytes: Uint8Array;
    try {
      bytes = await read(files[i] as string);
    } catch {
      return unreadable("is missing or unreadable");
    }
    if (bytes.byteLength > PROMPT_FILE_MAX_BYTES) return unreadable("is too large");
    if (bytes.includes(0)) return unreadable("is not valid text");
    try {
      decoder.decode(bytes);
    } catch {
      return unreadable("is not valid text");
    }
  }
  return undefined;
}

// ── cwd scope ────────────────────────────────────────────────────────────────────────────────

export type CwdVerdict = { kind: "in_scope"; cwd: string } | { kind: "outside"; cwd: string } | { kind: "invalid"; reason: "cwd_not_found" | "cwd_not_dir" };

export interface CwdDeps {
  realpath(path: string): Promise<string>;
  isDirectory(path: string): Promise<boolean>;
  /** `git rev-parse <flag>` in `cwd` as a real path; `undefined` outside git. */
  gitPath(cwd: string, flag: "--show-toplevel" | "--git-common-dir"): Promise<string | undefined>;
}

const realDeps: CwdDeps = {
  realpath: (p) => realpath(p),
  isDirectory: async (p) => (await stat(p)).isDirectory(),
  async gitPath(cwd, flag) {
    try {
      const out = execFileSync("git", ["rev-parse", flag], { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).trim();
      return out ? await realpath(resolve(cwd, out)) : undefined;
    } catch {
      return undefined;
    }
  },
};

/** `child` equals `parent` or lies below it (both real paths). */
function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Where `cwd` stands relative to the lead's `cwdScope:"repo"` scope (symlinks followed; nothing is trusted lexically). */
export async function classifyCwd(leadCwd: string, cwd: string, deps: CwdDeps = realDeps): Promise<CwdVerdict> {
  if (cwd.includes("\u0000")) return { kind: "invalid", reason: "cwd_not_found" };
  let real: string;
  try {
    real = await deps.realpath(resolve(leadCwd, cwd));
  } catch {
    return { kind: "invalid", reason: "cwd_not_found" };
  }
  try {
    if (!(await deps.isDirectory(real))) return { kind: "invalid", reason: "cwd_not_dir" };
  } catch {
    return { kind: "invalid", reason: "cwd_not_found" };
  }
  let leadReal: string;
  try {
    leadReal = await deps.realpath(leadCwd);
  } catch {
    leadReal = resolve(leadCwd);
  }
  if (isWithin(leadReal, real)) return { kind: "in_scope", cwd: real };
  const top = await deps.gitPath(leadReal, "--show-toplevel");
  if (top && isWithin(top, real)) return { kind: "in_scope", cwd: real };
  const leadCommon = await deps.gitPath(leadReal, "--git-common-dir");
  if (leadCommon && (await deps.gitPath(real, "--git-common-dir")) === leadCommon) return { kind: "in_scope", cwd: real };
  return { kind: "outside", cwd: real };
}

export interface CwdDecision {
  refusal?: SpawnRefusal;
  /** `"any"` ⇒ the request carries `cwdScope:"any"` (outside the repo scope with feature `cwd_scope`); absent otherwise. */
  cwdScope?: "any";
}

/** The rules of a spawn cwd: refuse, send `cwdScope:"any"` (only outside the scope and only with the feature), or send nothing. */
export async function decideCwd(
  leadCwd: string,
  cwd: string,
  opts: { features: readonly SubagentsFeature[]; globalScope?: "repo" | "any" },
  deps?: CwdDeps,
): Promise<CwdDecision> {
  const verdict = await classifyCwd(leadCwd, cwd, deps);
  if (verdict.kind === "invalid") return { refusal: { error: "cwd_outside_scope", message: verdict.reason === "cwd_not_dir" ? "the member cwd is not a directory" : "the member cwd does not exist" } };
  if (verdict.kind === "in_scope" || opts.globalScope === "any") return {};
  if (!opts.features.includes("cwd_scope")) return { refusal: { error: "cwd_outside_scope", message: "the member cwd is outside the lead's repository and the subagents extension has no cwd_scope feature" } };
  return { cwdScope: "any" };
}
