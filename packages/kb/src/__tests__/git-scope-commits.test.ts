// Local commit indexing (change: add-kb-git-forge-scope, test-plan #E12–#E19, #X12, #P2, #P3).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultDeps } from "../git-scope/deps.js";
import { SqliteFtsStore } from "../sqlite-store.js";
import { fastImport, git, instrumentedStore, type StoreStats, scopeFor, useGitFixture } from "./helpers/git-fixture.js";

const fx = useGitFixture();
const q = (scope: ReturnType<typeof scopeFor>, cwd: string, query: string, extra: { limit?: number; kind?: "commit" | "pr" | "issue" } = {}) => scope.search({ query, ...extra }, { cwd });
const stats = (): StoreStats => ({ replaced: [], txMs: [] });

function spyGit() {
  const real = defaultDeps();
  const calls = { spawns: [] as string[][], execs: [] as string[][] };
  return {
    calls,
    deps: {
      spawnGit: (a: string[], c: string) => (calls.spawns.push(a), real.spawnGit(a, c)),
      git: (a: string[], c: string) => (calls.execs.push(a), real.git(a, c)),
    },
  };
}

describe("commit indexing", () => {
  it("E12: a new commit is searchable by subject AND by changed path", async () => {
    const dir = fx.repo();
    const scope = scopeFor(fx);
    await q(scope, dir, "initial");
    fx.commit(dir, "add widget", { files: { "src/widget.ts": "export {}\n" } });
    const byPath = await q(scope, dir, "widget.ts");
    expect(byPath.text).toContain("add widget");
    const bySubject = await q(scope, dir, "widget");
    expect(bySubject.text).toContain("add widget");
  });

  it("E13: unchanged refs do no work — only the fingerprint execs run", async () => {
    const dir = fx.repo();
    const spy = spyGit();
    const scope = scopeFor(fx, spy.deps);
    await q(scope, dir, "initial");
    spy.calls.spawns.length = 0;
    spy.calls.execs.length = 0;
    const r = await q(scope, dir, "initial");
    expect(r.text).toContain("commits fresh");
    expect(spy.calls.spawns).toHaveLength(0);
    expect(spy.calls.execs.every((a) => ["rev-parse", "remote", "for-each-ref", "worktree"].includes(a[0]))).toBe(true);
  });

  it("E14: incremental walk negates the old tips — one new commit parses one record", async () => {
    const dir = fx.repo({ commits: 50 });
    const st = stats();
    const scope = scopeFor(fx, { openStore: instrumentedStore(st) });
    await q(scope, dir, "commit");
    expect(st.replaced.filter((p) => p.startsWith("commit/"))).toHaveLength(50);
    st.replaced.length = 0;
    fx.commit(dir, "one more");
    await q(scope, dir, "more");
    expect(st.replaced.filter((p) => p.startsWith("commit/"))).toHaveLength(1);
  });

  it("E15: author e-mail is not indexed", async () => {
    const dir = fx.repo();
    fx.commit(dir, "feature work", { author: "Jonathan Doe", email: "jdoe@mail.invalid" });
    const scope = scopeFor(fx);
    const r = await q(scope, dir, "jdoe@mail.invalid");
    expect(r.text).not.toContain("feature work");
    expect((await q(scope, dir, "Jonathan")).text).toContain("feature work"); // the author NAME is indexed
  });

  it("E16: a commit on a detached worktree HEAD is indexed", async () => {
    const dir = fx.repo();
    const wt = join(fx.tmp, "detached");
    git(dir, "worktree", "add", "-q", "--detach", wt);
    fx.commit(wt, "orphan detached work");
    const r = await q(scopeFor(fx), dir, "orphan detached");
    expect(r.text).toContain("orphan detached work");
  });

  it("E17: first index is capped to the newest maxInitial commits", async () => {
    const dir = fx.repo({ commits: 30 });
    const r = await q(scopeFor(fx, { gitConfig: { commits: { maxInitial: 25 } } }), dir, "commit", { limit: 100 });
    const lines = r.text.split("\n").filter((l) => /^\d+ {2}\[git\] commit /.test(l));
    expect(lines).toHaveLength(25);
    expect(r.text).toContain("commit 29");
    expect(r.text).not.toContain("initial commit");
  });

  it("E18: maxPathsPerCommit caps the stored path list", async () => {
    const dir = fx.repo();
    const files: Record<string, string> = {};
    for (let i = 0; i < 210; i++) files[`bulk/f${i}.txt`] = String(i);
    const sha = fx.commit(dir, "many files", { files });
    const scope = scopeFor(fx, { gitConfig: { commits: { maxPathsPerCommit: 200 } } });
    await q(scope, dir, "many");
    const got = await scope.get({ path: `commit/${sha.slice(0, 8)}` }, { cwd: dir });
    expect(got.text).toContain("Changed paths (200):");
  });

  it("E19: a non-UTF-8 commit message is indexed as valid UTF-8, no throw", async () => {
    const dir = fx.repo();
    git(dir, "config", "i18n.commitEncoding", "ISO-8859-1");
    writeFileSync(join(dir, "x.txt"), "x");
    git(dir, "add", "-A");
    const msgFile = join(fx.tmp, "msg.bin");
    writeFileSync(msgFile, Buffer.concat([Buffer.from("caf"), Buffer.from([0xe9]), Buffer.from(" au lait\n\nbody with "), Buffer.from([0xfc]), Buffer.from("ber text\n")]));
    git(dir, "commit", "-q", "-F", msgFile);
    const scope = scopeFor(fx);
    const r = await q(scope, dir, "lait");
    expect(r.text).toContain("lait");
    const sha = git(dir, "rev-parse", "HEAD").trim();
    const got = await scope.get({ path: `commit/${sha.slice(0, 7)}` }, { cwd: dir });
    expect(got.text).toContain("café au lait");
    expect(got.text).not.toContain("\u0000");
  });

  it("X12: a garbage-collected recorded tip is recovered from the current tips", async () => {
    const dir = fx.repo({ commits: 3 }); // c0 c1 c2
    const scope = scopeFor(fx);
    await q(scope, dir, "commit");
    git(dir, "reset", "-q", "--hard", "HEAD~2");
    git(dir, "reflog", "expire", "--expire=now", "--all");
    git(dir, "gc", "-q", "--prune=now");
    fx.commit(dir, "fresh after rewrite");
    const r = await q(scope, dir, "fresh rewrite");
    expect(r.text).toContain("fresh after rewrite");
    expect((await q(scope, dir, "commit 2")).text).toContain("commit 2"); // previously indexed, now unreachable
    await scope.shutdown();
    const [key] = (await import("node:fs")).readdirSync(fx.baseDir);
    const store = new SqliteFtsStore(join(fx.baseDir, key, "index.db"));
    const err = store.read((db) => (db.prepare("SELECT value FROM git_meta WHERE key='lastError'").get() as { value: string } | undefined)?.value);
    store.close();
    expect(err).toMatch(/reset/);
  });
});

describe("bounded latency (commits)", () => {
  it("P2/P3: 5 000-commit first index returns within budget; transactions stay short; completes later", async () => {
    const dir = fx.repo();
    fastImport(dir, 5000);
    const st = stats();
    const scope = scopeFor(fx, { openStore: instrumentedStore(st), gitConfig: { searchWaitMs: 50 } });
    const t0 = Date.now();
    const first = await q(scope, dir, "marker42");
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(first.text).toContain("commits indexing");
    await scope.idle();
    const done = await q(scope, dir, "marker4999");
    expect(done.text).toContain("commits fresh");
    expect(done.text).toContain("bulk commit 4999");
    expect(st.replaced.filter((p) => p.startsWith("commit/")).length).toBeGreaterThanOrEqual(5000);
    expect(Math.max(...st.txMs)).toBeLessThan(1000);
  }, 120_000);
});

// keep the helpers referenced for tooling that tree-shakes imports
void [execFileSync, mkdirSync];
