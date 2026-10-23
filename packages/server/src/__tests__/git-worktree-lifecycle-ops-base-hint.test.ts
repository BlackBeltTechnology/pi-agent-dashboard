/**
 * SE9 (test-plan #SE9): a stored base hint that reaches the git command builders (bypassing the
 * WS handler) is re-validated at use — an option-like hint is ignored, default base resolution
 * applies, and the value never reaches git as an argument.
 *
 * See change: harden-git-terminal-plugin-boundaries (B1r).
 */
import { execSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as platformExec from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addWorktree, mergeWorktree, resolveDefaultBase, resolveRemoteBase, worktreeDiffStat } from "../git-worktree/git-operations.js";

function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, { cwd, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" }).trim();
}

function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "git-base-hint-")));
  git("-c init.defaultBranch=main init", dir);
  git("config user.email test@test.com", dir);
  git("config user.name Test", dir);
  writeFileSync(join(dir, "README.md"), "init\n");
  git("add .", dir);
  git("commit -m init", dir);
  return dir;
}

describe("stored base hint is re-validated at use (SE9)", () => {
  let repo: string;
  let argvs: string[][];
  let spies: Array<ReturnType<typeof vi.spyOn>>;
  beforeEach(() => {
    repo = makeRepo();
    argvs = [];
    const realExecFile = platformExec.execFileSync as (...a: any[]) => unknown;
    const realSpawnSync = platformExec.spawnSync as (...a: any[]) => unknown;
    spies = [
      vi.spyOn(platformExec, "execFileSync").mockImplementation(((file: any, args: any, opts: any) => {
        if (file === "git") argvs.push([...(args ?? [])]);
        return realExecFile(file, args, opts);
      }) as any),
      vi.spyOn(platformExec, "spawnSync").mockImplementation(((file: any, args: any, opts: any) => {
        if (file === "git") argvs.push([...(args ?? [])]);
        return realSpawnSync(file, args, opts);
      }) as any),
    ];
  });
  afterEach(() => {
    for (const s of spies) s.mockRestore();
    rmSync(repo, { recursive: true, force: true });
  });

  const everyArgv = () => argvs.flat();

  it.each(["-x", "--detach", "--upload-pack=x"])("worktreeDiffStat ignores hint %j and uses the default base", (hint) => {
    const wt = addWorktree({ cwd: repo, base: "main", newBranch: "feat/h" });
    expect(wt.ok).toBe(true);
    if (!wt.ok) return;
    argvs.length = 0;
    const result = worktreeDiffStat({ cwd: wt.path, baseHint: hint });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.base).toBe("main");
    expect(everyArgv()).not.toContain(hint);
    expect(argvs.some((a) => a[0] === "rev-parse" && a.includes("--verify") && a.includes(hint))).toBe(false);
  });

  it.each(["-x", "--detach"])("mergeWorktree ignores hint %j: merges into the default base, never passes it to git", (hint) => {
    const wt = addWorktree({ cwd: repo, base: "main", newBranch: "feat/m" });
    expect(wt.ok).toBe(true);
    if (!wt.ok) return;
    writeFileSync(join(wt.path, "a.txt"), "a\n");
    git("add . && git commit -m a", wt.path);
    argvs.length = 0;
    const result = mergeWorktree({ cwd: wt.path, baseHint: hint });
    expect(result.ok).toBe(true);
    expect(everyArgv()).not.toContain(hint);
    expect(argvs.some((a) => a[0] === "checkout" && a[1] === "main")).toBe(true);
  });

  it("resolveDefaultBase / resolveRemoteBase never verify an option-like hint", () => {
    expect(resolveDefaultBase(repo, "-x")).toBe("main");
    resolveRemoteBase(repo, "--x");
    expect(everyArgv()).not.toContain("-x");
    expect(everyArgv().some((a) => a.includes("--x"))).toBe(false);
  });

  it("a valid hint is still honoured", () => {
    git("branch develop", repo);
    expect(resolveDefaultBase(repo, "develop")).toBe("develop");
  });
});
