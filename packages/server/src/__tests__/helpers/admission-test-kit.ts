/**
 * Shared fixtures for the core cwd-admission route tests (git / openspec / folder-project).
 * See change: core-cwd-admission.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as guard from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import type { GitProbeRunner, RealpathOutcome } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import { vi } from "vitest";

const made: string[] = [];

/** Remove every dir made through {@link tmpDir} / {@link makeGitRepo}. Call from `afterAll`. */
export function cleanupAdmissionDirs(): void {
  for (const p of made.splice(0)) rmSync(p, { recursive: true, force: true });
}

/** A fresh canonical temp dir. */
export function tmpDir(prefix = "adm-"): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(d);
  return d;
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", ["-c", "user.email=t@t.com", "-c", "user.name=T", ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

/** A temp git repo with one commit (and an `openspec/` dir when asked). */
export function makeGitRepo(opts: { openspec?: boolean; prefix?: string } = {}): string {
  const dir = tmpDir(opts.prefix ?? "adm-repo-");
  git(dir, ["-c", "init.defaultBranch=main", "init"]);
  writeFileSync(join(dir, "README.md"), "init");
  if (opts.openspec) mkdirSync(join(dir, "openspec", "changes", "x"), { recursive: true });
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "init"]);
  return dir;
}

/** A linked worktree of `repo` at a fresh path outside it. */
export function addLinkedWorktree(repo: string, branch: string): string {
  const path = join(tmpDir("adm-wt-"), "wt");
  git(repo, ["worktree", "add", "-b", branch, path]);
  return realpathSync(path);
}

/** A runner on which every git probe fails with a non-`exit` error → admission is `indeterminate`. */
export const failingRunner: GitProbeRunner = async () => ({ ok: false, error: { kind: "spawn-failure", message: "EAGAIN" } });

/** An errno-reporting realpath that fails with `code` for `bad`, real otherwise. */
export function realpathFailingFor(bad: string, code = "EACCES"): (p: string) => Promise<RealpathOutcome> {
  return async (p) => {
    if (p === bad) return { kind: "error", code };
    try {
      return { kind: "ok", path: realpathSync(p) };
    } catch {
      return { kind: "missing" };
    }
  };
}

/** Capture every admitted token the routes mint (the shared guard is the only minter). */
export function captureAdmissions(): { tokens: guard.AdmissionToken[]; calls: string[]; restore: () => void } {
  const tokens: guard.AdmissionToken[] = [];
  const calls: string[] = [];
  const original = guard.admitCwd;
  const spy = vi.spyOn(guard, "admitCwd").mockImplementation(async (...args) => {
    calls.push(args[0]);
    const result = await original(...args);
    if (result.kind === "admit") tokens.push(result.token);
    return result;
  });
  return { tokens, calls, restore: () => spy.mockRestore() };
}
