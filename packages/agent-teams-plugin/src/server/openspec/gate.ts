/**
 * `not_shipped` completion gate of `openspec-group` (design D3 "Completion"). A `TaskUpdate completed` of a
 * launcher-owned task passes only when the change is SHIPPED, judged on repository state, never on agent text:
 *   (a) worktree `<repo>/.worktrees/os-<change>` present: an archive DIRECTORY `YYYY-MM-DD-<change>` (exact
 *       `archivedChangeName()` match, never a suffix glob; a file or symlink does not count) exists under
 *       `openspec/changes/archive/` AND `openspec/changes/<change>/` is gone there;
 *   (b) worktree gone (`ship-change` step 10 removed it): `git fetch origin <merge>` (bounded by
 *       `openspecFetchTimeoutMs`, child killed on expiry) and `git ls-tree` of `origin/<merge>` lists such a tree.
 * FAIL CLOSED: any throw, timeout, unexpected shape or missing state answers `not_shipped`; the gate never
 * allows by accident and never throws into the op. It acts only on the completion of a launcher-owned task of
 * a group team; every other call is untouched (no git, no fs). The block uses core's `op_blocked` code with a
 * `not_shipped (<reason>): …` feedback token (like the hook feedback tokens), a refusal of the lead carries the
 * relaunch / `TeamDelete` advice (v1 has no abandon route).
 * See change: add-agent-teams-openspec.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { archivedChangeName } from "@blackbelt-technology/pi-dashboard-shared/openspec-dependencies.js";
import { execFile } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import type { Task, Team } from "../../shared/types.js";
import type { OpGate, OpGateBlock, OpGateInput } from "../extension-points.js";
import { isValidBranchRef } from "./config.js";
import { isChangeName } from "./inputs.js";
import { OPENSPEC_COUNTERS } from "./log.js";
import type { OpenspecApi } from "./profiles.js";

type NotShippedReason = "change_dir_present" | "not_archived" | "not_on_merge_base" | "fetch_failed" | "check_failed" | "state_unavailable";
export type ShippedVerdict = { ok: true; mode: "worktree" | "remote" } | { ok: false; reason: NotShippedReason };

interface DirEntry {
  name: string;
  /** `dir` only for a real directory; a symlink or file is `other`. */
  kind: "dir" | "other";
}

/** The side-effecting seams of the gate (replaceable in tests). Every method may throw or reject. */
export interface GateIo {
  /** `dir` (real directory), `absent` (ENOENT/ENOTDIR), `other` (file, symlink, …); throws on any other error. */
  stat(p: string): Promise<"dir" | "absent" | "other">;
  /** Entries of a directory; throws (ENOENT included) on error. */
  list(dir: string): Promise<DirEntry[]>;
  /** One git invocation in `repo`; resolves with the exit code and stdout, rejects on a spawn error or abort. */
  git(args: readonly string[], opts: { cwd: string; signal: AbortSignal; timeoutMs: number }): Promise<{ code: number; stdout: Uint8Array }>;
}

const GIT_MAX_BUFFER = 8 * 1024 * 1024;
const LS_TREE_TIMEOUT_MS = 3000;

export const nodeGateIo: GateIo = {
  async stat(p) {
    try {
      const st = await fs.lstat(p);
      return st.isDirectory() ? "dir" : "other";
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return "absent";
      throw err;
    }
  },
  async list(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, kind: e.isDirectory() ? ("dir" as const) : ("other" as const) }));
  },
  git(args, { cwd, signal, timeoutMs }) {
    return new Promise((resolve, reject) => {
      execFile(
        "git",
        [...args],
        { cwd, signal, timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: GIT_MAX_BUFFER, encoding: "buffer", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
        (err, stdout) => {
          const out = stdout as Buffer; // encoding: "buffer"
          if (!err) return resolve({ code: 0, stdout: out });
          const code = (err as NodeJS.ErrnoException & { code?: unknown }).code;
          if (typeof code === "number") return resolve({ code, stdout: out ?? Buffer.alloc(0) });
          reject(err);
        },
      );
    });
  },
};

/** Where the worktree of `change` lives (the launcher's explicit path). */
const worktreeOf = (repo: string, change: string): string => path.join(repo, ".worktrees", `os-${change}`);

const ARCHIVE_REL = ["openspec", "changes", "archive"] as const;

/** State (a): archive entry in the worktree and the change directory gone. */
async function inWorktree(io: GateIo, worktree: string, change: string): Promise<ShippedVerdict> {
  let entries: DirEntry[];
  try {
    entries = await io.list(path.join(worktree, ...ARCHIVE_REL));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { ok: false, reason: code === "ENOENT" || code === "ENOTDIR" ? "not_archived" : "check_failed" };
  }
  if (!entries.some((e) => e.kind === "dir" && archivedChangeName(e.name) === change)) return { ok: false, reason: "not_archived" };
  const dir = await io.stat(path.join(worktree, "openspec", "changes", change));
  if (dir !== "absent") return { ok: false, reason: "change_dir_present" };
  // the worktree itself vanishing mid-check proves nothing about the change: fail closed
  return (await io.stat(worktree)) === "dir" ? { ok: true, mode: "worktree" } : { ok: false, reason: "check_failed" };
}

/** Tree entries (`mode type sha\tpath`, NUL separated) whose type is `tree`, as archive directory names. */
function treeNames(stdout: Uint8Array): string[] {
  const out: string[] = [];
  for (const rec of Buffer.from(stdout.buffer, stdout.byteOffset, stdout.byteLength).toString("utf8").split("\u0000")) {
    const tab = rec.indexOf("\t");
    if (tab < 0) continue;
    const [, type] = rec.slice(0, tab).split(" ");
    if (type === "tree") out.push(rec.slice(tab + 1).split("/").pop() ?? "");
  }
  return out;
}

/** Race `work` against a clock timer; the child is aborted on expiry. `undefined` = timed out. */
async function bounded<T>(api: OpenspecApi, ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
  const ctl = new AbortController();
  let timer: unknown;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = api.deps.clock.setTimeout(() => resolve("timeout"), ms);
  });
  const run = work(ctl.signal);
  run.catch(() => undefined); // an aborted child rejects after the race was settled
  try {
    const res = await Promise.race([run, timeout]);
    if (res === "timeout") {
      ctl.abort();
      return undefined;
    }
    return res;
  } finally {
    api.deps.clock.clearTimeout(timer);
  }
}

/** State (b): the worktree is gone, judge `origin/<merge>` after a bounded fetch. */
async function onMergeBase(api: OpenspecApi, io: GateIo, repo: string, change: string, merge: string, fetchTimeoutMs: number): Promise<ShippedVerdict> {
  if (!isValidBranchRef(merge)) return { ok: false, reason: "check_failed" };
  let fetched: { code: number } | undefined;
  try {
    fetched = await bounded(api, fetchTimeoutMs, (signal) => io.git(["fetch", "--no-tags", "--quiet", "--", "origin", merge], { cwd: repo, signal, timeoutMs: fetchTimeoutMs + 1000 }));
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }
  if (!fetched || fetched.code !== 0) return { ok: false, reason: "fetch_failed" };
  let listed: { code: number; stdout: Uint8Array } | undefined;
  try {
    listed = await bounded(api, LS_TREE_TIMEOUT_MS, (signal) =>
      io.git(["ls-tree", "-z", `refs/remotes/origin/${merge}`, "--", `${ARCHIVE_REL.join("/")}/`], { cwd: repo, signal, timeoutMs: LS_TREE_TIMEOUT_MS + 1000 }),
    );
  } catch {
    return { ok: false, reason: "check_failed" };
  }
  if (!listed || listed.code !== 0) return { ok: false, reason: "check_failed" };
  return treeNames(listed.stdout).some((n) => archivedChangeName(n) === change) ? { ok: true, mode: "remote" } : { ok: false, reason: "not_on_merge_base" };
}

/**
 * Is `change` shipped? Never throws. `merge` / `fetchTimeoutMs` come from the validated config; the
 * worktree path is derived, never read from agent input.
 */
export async function verifyShipped(api: OpenspecApi, input: { repo: string; change: string; merge: string; fetchTimeoutMs: number }, io: GateIo = nodeGateIo): Promise<ShippedVerdict> {
  try {
    if (!isChangeName(input.change)) return { ok: false, reason: "check_failed" };
    const worktree = worktreeOf(input.repo, input.change);
    const present = await io.stat(worktree);
    if (present === "dir") return await inWorktree(io, worktree, input.change);
    if (present === "absent") return await onMergeBase(api, io, input.repo, input.change, input.merge, input.fetchTimeoutMs);
    return { ok: false, reason: "check_failed" };
  } catch {
    return { ok: false, reason: "check_failed" };
  }
}

const ADVICE_LEAD = " A launcher task cannot be force-completed and v1 has no abandon route: fix the cause and relaunch it (POST /api/plugins/agent-teams/openspec-relaunch), or TeamDelete the team.";
const ADVICE_MEMBER = " Finish the ship skill (archive + merge); if it handed back, message the lead and leave the task in_progress.";

const FEEDBACK: Readonly<Record<NotShippedReason, string>> = {
  change_dir_present: "the change directory still exists in the worktree",
  not_archived: "no archive entry for the change was found",
  not_on_merge_base: "the merge target does not list an archive entry for the change",
  fetch_failed: "the merge target could not be fetched in time",
  check_failed: "the shipped state could not be verified",
  state_unavailable: "the launcher state of this change is unavailable",
};

const block = (change: string, reason: NotShippedReason, caller: string): OpGateBlock => ({
  block: true,
  feedback: `not_shipped (${reason}): ${FEEDBACK[reason]} for change "${change}".${caller === "lead" ? ADVICE_LEAD : ADVICE_MEMBER}`,
});

/** The launcher-owned task of a group team the gate acts on, with its change (`undefined` change ⇒ state lost). */
function scopeOf(api: OpenspecApi, input: OpGateInput): { team: Team; task: Task; change: string | undefined } | undefined {
  if (input.op !== "TaskUpdate") return undefined;
  const args = (input.args ?? {}) as Record<string, unknown>;
  if (args.status !== "completed") return undefined;
  if (api.profileOf(input.team) !== "group") return undefined;
  const task = input.team.tasks.find((t) => t.id === String(args.id));
  if (!task || task.status === "completed") return undefined; // core fails or no-ops it
  const ref = api.sidecar.get(input.team.id)?.refs[task.id] as { kind?: unknown; change?: unknown } | undefined;
  const isGroupRef = ref !== undefined && ref !== null && typeof ref === "object" && ref.kind === "group";
  if (!isGroupRef && task.ownerLocked !== true) return undefined;
  return { team: input.team, task, change: isGroupRef && typeof ref?.change === "string" ? ref.change : undefined };
}

/**
 * Register the gate on core's `TaskUpdate` op; `io` is a test seam. `current` resolves the live module handle
 * at call time, so a registry that outlives one runtime (tests, plugin re-enable) always judges with the newest.
 */
export function registerShippedGate(current: () => OpenspecApi, io: GateIo = nodeGateIo): void {
  const gate: OpGate = async (input) => {
    const api = current();
    let scope: ReturnType<typeof scopeOf>;
    try {
      scope = scopeOf(api, input);
    } catch {
      return block("?", "check_failed", input.callerName);
    }
    if (!scope) return undefined;
    const { team, change } = scope;
    let verdict: ShippedVerdict;
    const d = api.sidecar.get(team.id);
    if (change === undefined || !d || d.lost) verdict = { ok: false, reason: "state_unavailable" };
    else {
      const group = typeof d.ext.group === "object" && d.ext.group !== null ? (d.ext.group as Record<string, unknown>) : {};
      let cfg: ReturnType<OpenspecApi["config"]> | undefined;
      try {
        cfg = api.config({ effectiveMaxTeammates: api.deps.config().maxTeammates });
      } catch {
        cfg = undefined;
      }
      if (!cfg?.ok) verdict = { ok: false, reason: "check_failed" };
      else {
        const merge = typeof group.merge === "string" && group.merge !== "" ? group.merge : cfg.config.mergeBase;
        verdict = await verifyShipped(api, { repo: d.repo, change, merge, fetchTimeoutMs: cfg.config.fetchTimeoutMs }, io);
      }
    }
    if (verdict.ok) {
      api.log.record("info", "completion_verified", OPENSPEC_COUNTERS.completionVerified, team.id, { mode: verdict.mode });
      return undefined;
    }
    api.log.record("warn", "not_shipped", OPENSPEC_COUNTERS.completionRefused, team.id, { reason: verdict.reason });
    return block(change ?? "?", verdict.reason, input.callerName);
  };
  current().deps.ext.registerOpGate("TaskUpdate", gate);
}
