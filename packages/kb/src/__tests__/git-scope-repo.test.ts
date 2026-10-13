// Repo resolution, shared index, privacy (change: add-kb-git-forge-scope,
// test-plan #E6–#E11, #E21, #E25, #E43).
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GitScopeDeps } from "../git-scope/deps.js";
import { defaultDeps } from "../git-scope/deps.js";
import { FakeForge, fakeItem, git, scopeFor, useGitFixture } from "./helpers/git-fixture.js";

const fx = useGitFixture();
const search = (scope: ReturnType<typeof scopeFor>, cwd: string, query = "initial") => scope.search({ query }, { cwd });

/** Count `git log` spawns (the ingest seam) while delegating to real git. */
function spyDeps(): { deps: Partial<GitScopeDeps>; spawns: string[][] } {
  const real = defaultDeps();
  const spawns: string[][] = [];
  return { spawns, deps: { spawnGit: (args, cwd) => (spawns.push(args), real.spawnGit(args, cwd)) } };
}

describe("repo resolution", () => {
  it("E6: not a git repository → message, no throw", async () => {
    const dir = join(fx.tmp, "plain");
    mkdirSync(dir);
    const r = await search(scopeFor(fx), dir, "q");
    expect(r.text).toContain("not a git repository");
    expect(r.details.untrusted).toBe(true);
  });

  it("E8: removed working directory → message, nothing recreated", async () => {
    const dir = fx.repo();
    const scope = scopeFor(fx);
    expect((await search(scope, dir)).text).toContain("initial");
    const { rmSync } = await import("node:fs");
    rmSync(dir, { recursive: true, force: true });
    const r = await search(scope, dir);
    expect(r.text).toContain("directory removed");
    expect(existsSync(dir)).toBe(false);
  });

  it("E9: worktrees share one index — second search does no re-index", async () => {
    const main = fx.repo();
    const wt = join(fx.tmp, "wt");
    git(main, "worktree", "add", "-q", wt, "-b", "wtbranch");
    const { deps, spawns } = spyDeps();
    const scope = scopeFor(fx, deps);
    const a = await search(scope, main);
    expect(a.text).toContain("initial commit");
    const walks = spawns.length;
    expect(walks).toBeGreaterThan(0);
    const b = await search(scope, wt);
    expect(b.text).toContain("initial commit");
    expect(spawns.length).toBe(walks); // 0 new commits walked
    expect(readdirSync(fx.baseDir)).toHaveLength(1); // one repoKey directory
  });

  it("E10: nothing is written into the repository", async () => {
    const dir = fx.repo({ remote: "https://github.com/a/r.git" });
    const snapshot = () => ({ status: git(dir, "status", "--porcelain"), gitFiles: readdirSync(join(dir, ".git"), { recursive: true }).map(String).sort() });
    const before = snapshot();
    const forge = new FakeForge();
    forge.items = [fakeItem("pr", 5, "Add cache")];
    await search(scopeFor(fx, { adapterFor: () => forge }), dir, "cache");
    expect(snapshot()).toEqual(before);
    expect(forge.requests.length).toBeGreaterThan(0); // the sync really ran
  });

  it.skipIf(process.platform === "win32")("E11: index directory 0700, database 0600", async () => {
    const dir = fx.repo();
    await search(scopeFor(fx), dir);
    const [key] = readdirSync(fx.baseDir);
    expect(statSync(join(fx.baseDir, key)).mode & 0o777).toBe(0o700);
    expect(statSync(join(fx.baseDir, key, "index.db")).mode & 0o777).toBe(0o600);
  });

  it("E21: unsupported forge → commits still returned, footer says forge unsupported", async () => {
    for (const remote of ["https://bitbucket.org/o/r.git", "https://git.corp.example/o/r.git", null]) {
      const dir = fx.repo({ remote: remote ?? undefined, name: `u${Math.random().toString(36).slice(2, 6)}` });
      const r = await search(scopeFor(fx), dir);
      expect(r.text).toContain("initial commit");
      expect(r.text).toMatch(/forge unsupported/);
    }
  });

  it("E25: owner/repo validation — hostile segments never reach an adapter", async () => {
    let calls = 0;
    const adapterFor = () => (calls++, new FakeForge());
    for (const remote of ["https://github.com/o/../x.git", "git@github.com:o/r?x.git", "https://github.com/o/r%2e", "git@github.com:o/..", "https://github.com/o/r/extra/more"]) {
      const dir = fx.repo({ remote, name: `v${Math.random().toString(36).slice(2, 6)}` });
      const r = await search(scopeFor(fx, { adapterFor }), dir);
      expect(r.text).toMatch(/forge unsupported/);
    }
    expect(calls).toBe(0);
  });

  it("E43: remote changes forge identity → old PRs gone, commits kept, fresh first sync", async () => {
    const dir = fx.repo({ remote: "https://github.com/a/r.git" });
    const forge = new FakeForge();
    forge.items = [fakeItem("pr", 12, "Quokka feature")];
    const scope = scopeFor(fx, { adapterFor: () => forge });
    expect((await search(scope, dir, "quokka")).text).toContain("Quokka feature");
    git(dir, "remote", "set-url", "origin", "https://github.com/b/r.git");
    const other = new FakeForge();
    const scope2 = scopeFor(fx, { adapterFor: () => other });
    const r = await search(scope2, dir, "quokka");
    expect(r.text).not.toContain("Quokka feature");
    expect((await search(scope2, dir, "initial")).text).toContain("initial commit");
    expect(other.requests.length).toBe(1);
    expect(other.requests[0].page).toBe(1);
  });

  it("disabled via config: no git command executes", async () => {
    const dir = fx.repo();
    const { deps, spawns } = spyDeps();
    let execs = 0;
    const real = defaultDeps();
    const scope = scopeFor(fx, { ...deps, git: (a, c) => (execs++, real.git(a, c)), gitConfig: { enabled: false } });
    const r = await search(scope, dir);
    expect(r.text).toContain("disabled");
    expect(execs + spawns.length).toBe(0);
    writeFileSync(join(fx.tmp, "keep"), "");
  });
});
