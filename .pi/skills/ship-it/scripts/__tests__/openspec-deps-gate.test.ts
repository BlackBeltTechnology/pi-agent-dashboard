/**
 * Dependency gate at ship-it entry (design D9): online verdicts (#X9), the
 * offline parser path (#X10) and origin/develop archives counting as satisfied
 * (#X11). Real files, a real throwaway HTTP server and real git repos.
 * See change: add-openspec-change-dependencies.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { runGate } from "../openspec-deps-gate.ts";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deps-gate-"));
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const servers: http.Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections?.();
    await new Promise((r) => s.close(r));
  }
});

function write(root: string, rel: string, body: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}
const mkRepoDir = (name: string) => {
  const d = path.join(tmpRoot, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

const entry = (over: Record<string, unknown> = {}) => ({
  hasFile: true, blocks: [], related: [], overlaps: [], wave: 2, issues: [],
  blockedBy: [{ change: "a", source: "declared", state: "open", reason: "api" }],
  ...over,
});
const ok = (e: unknown) => ({ code: 200, body: { success: true, data: { dependencies: e, declared: null, declaredError: null, file: null } } });

async function serve(handler: (n: number, req: http.IncomingMessage, res: http.ServerResponse) => void) {
  let n = 0;
  const server = http.createServer((req, res) => handler(++n, req, res));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, count: () => n };
}
const json = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

describe("#X9 online", () => {
  const base = { cwd: "/p", change: "foo", skipDevelop: true, retryDelayMs: 5 };

  it("an open blocker warns and is reported", async () => {
    let seenUrl = "";
    const s = await serve((_n, req, res) => {
      seenUrl = req.url ?? "";
      const r = ok(entry());
      json(res, r.code, r.body);
    });
    const v = await runGate({ ...base, baseUrl: s.url });
    expect(v).toMatchObject({ status: "warn", mode: "online" });
    expect(v.blockers).toEqual([{ change: "a", state: "open", source: "declared", reason: "api" }]);
    expect(seenUrl).toBe("/api/openspec/dependencies?cwd=%2Fp&change=foo");
  });

  it("no open blockers and no errors → ok; an error issue → blocked", async () => {
    const s1 = await serve((_n, _q, res) => { const r = ok(entry({ blockedBy: [{ change: "a", source: "declared", state: "satisfied" }] })); json(res, r.code, r.body); });
    expect(await runGate({ ...base, baseUrl: s1.url })).toMatchObject({ status: "ok", mode: "online" });
    const s2 = await serve((_n, _q, res) => { const r = ok(entry({ issues: [{ severity: "error", code: "cycle", message: "a → b → a" }] })); json(res, r.code, r.body); });
    expect(await runGate({ ...base, baseUrl: s2.url })).toMatchObject({ status: "blocked", mode: "online" });
  });

  it("503 pending twice then 200 → two retries, then the online verdict", async () => {
    const s = await serve((n, _q, res) => {
      if (n <= 2) return json(res, 503, { success: false, reason: "pending" });
      const r = ok(entry());
      json(res, r.code, r.body);
    });
    const v = await runGate({ ...base, baseUrl: s.url });
    expect(s.count()).toBe(3);
    expect(v.mode).toBe("online");
  });

  it("503 forever stops after 3 retries and falls back offline", async () => {
    const repo = mkRepoDir("x9-pending");
    const s = await serve((_n, _q, res) => json(res, 503, { success: false, reason: "pending" }));
    const v = await runGate({ ...base, cwd: repo, baseUrl: s.url });
    expect(s.count()).toBe(4);
    expect(v.mode).toBe("offline");
  });

  it("a hanging server → offline after the per-request timeout", async () => {
    const repo = mkRepoDir("x9-hang");
    const s = await serve(() => undefined);
    const t0 = Date.now();
    const v = await runGate({ ...base, cwd: repo, baseUrl: s.url, requestTimeoutMs: 300 });
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(v.mode).toBe("offline");
  });

  it("a 403 cwd-not-tracked → offline", async () => {
    const repo = mkRepoDir("x9-403");
    const s = await serve((_n, _q, res) => json(res, 403, { success: false, reason: "cwd-not-tracked" }));
    const v = await runGate({ ...base, cwd: repo, baseUrl: s.url });
    expect(v.mode).toBe("offline");
    expect(v.notes.join(" ")).toMatch(/403/);
  });
});

describe("#X10 offline", () => {
  it("a satisfied, b unknown (SHELVED), c dropped by not_blocked_by, self-reference → blocked; cycles not checked", async () => {
    const repo = mkRepoDir("x10");
    write(repo, "openspec/changes/foo/proposal.md", "# foo\n");
    write(repo, "openspec/changes/foo/dependencies.yaml", "blocked_by: [a, b, c, foo]\nnot_blocked_by: [c]\n");
    write(repo, "openspec/changes/archive/2026-10-01-a/proposal.md", "# a\n");
    write(repo, "openspec/changes/archive/2026-05-28-SHELVED-b/proposal.md", "# b\n");
    const v = await runGate({ cwd: repo, change: "foo", baseUrl: "http://127.0.0.1:1", skipDevelop: true });
    expect(v.mode).toBe("offline");
    expect(v.status).toBe("blocked");
    // a satisfied (archived), b unknown (a SHELVED archive entry does not satisfy), c dropped by not_blocked_by.
    expect(v.blockers.map((b) => [b.change, b.state])).toEqual([["a", "satisfied"], ["b", "unknown"]]);
    const codes = v.issues.map((i) => `${i.code}:${(i.with ?? []).join(",")}`);
    expect(codes).toEqual(expect.arrayContaining(["self-reference:", "unknown-change:b", "conflicting-entry:c"]));
    expect(v.notes.join(" ")).toMatch(/cycles and inferred edges were not checked/);
  });

  it("an open active blocker warns; no file means ok; an invalid file blocks", async () => {
    const repo = mkRepoDir("x10-b");
    write(repo, "openspec/changes/foo/dependencies.yaml", "blocked_by: [bar]\n");
    write(repo, "openspec/changes/bar/proposal.md", "# bar\n");
    write(repo, "openspec/changes/solo/proposal.md", "# solo\n");
    write(repo, "openspec/changes/broken/dependencies.yaml", "blocks: [x]\n");
    const run = (change: string) => runGate({ cwd: repo, change, baseUrl: "http://127.0.0.1:1", skipDevelop: true });
    expect(await run("foo")).toMatchObject({ status: "warn", blockers: [{ change: "bar", state: "open" }] });
    expect(await run("solo")).toMatchObject({ status: "ok" });
    expect(await run("broken")).toMatchObject({ status: "blocked", issues: [{ code: "invalid-file" }] });
  });

  it("a symlinked dependencies.yaml is invalid and never read through", async () => {
    const repo = mkRepoDir("x10-link");
    write(repo, "openspec/changes/foo/proposal.md", "# foo\n");
    fs.symlinkSync("/dev/zero", path.join(repo, "openspec/changes/foo/dependencies.yaml"));
    const t0 = Date.now();
    const v = await runGate({ cwd: repo, change: "foo", baseUrl: "http://127.0.0.1:1", skipDevelop: true });
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(v).toMatchObject({ status: "blocked", issues: [{ code: "invalid-file" }] });
  });

  it("an invalid change name is reported, never used to build a path", async () => {
    const repo = mkRepoDir("x10-name");
    const v = await runGate({ cwd: repo, change: "../../etc", baseUrl: "http://127.0.0.1:1", skipDevelop: true });
    expect(v.notes.join(" ")).toMatch(/not a valid change name/);
  });
});

describe("#X11 origin/develop", () => {
  const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: GIT_ENV, stdio: "ignore" });

  /** A bare origin whose `develop` already archived `x`, and a work repo where `x` is still active. */
  function setup(name: string): { work: string; origin: string } {
    const origin = path.join(tmpRoot, `${name}-origin.git`);
    git(tmpRoot, "init", "--bare", "-b", "develop", origin);
    const seed = mkRepoDir(`${name}-seed`);
    git(seed, "init", "-b", "develop");
    write(seed, "openspec/changes/archive/2026-10-20-x/proposal.md", "# x\n");
    git(seed, "add", "-A");
    git(seed, "commit", "-m", "archive x");
    git(seed, "remote", "add", "origin", origin);
    git(seed, "push", "origin", "develop");

    const work = mkRepoDir(`${name}-work`);
    git(work, "init", "-b", "os/y");
    write(work, "openspec/changes/x/proposal.md", "# x\n");
    write(work, "openspec/changes/y/dependencies.yaml", "blocked_by: [x]\n");
    git(work, "add", "-A");
    git(work, "commit", "-m", "wip");
    git(work, "remote", "add", "origin", origin);
    return { work, origin };
  }
  const gate = (work: string) => runGate({ cwd: work, change: "y", baseUrl: "http://127.0.0.1:1", fetchTimeoutMs: 5_000 });

  it("a blocker archived on origin/develop is satisfied, with a pending-merge note", async () => {
    const { work } = setup("x11-a");
    const v = await gate(work);
    expect(v.status).toBe("ok");
    expect(v.blockers.map((b) => [b.change, b.state])).toEqual([["x", "satisfied"]]);
    expect(v.notes.join(" ")).toMatch(/x is archived on origin\/develop \(pending merge/);
  });

  it("when the fetch fails the existing origin/develop ref is used (same verdict, note about the failure)", async () => {
    const { work, origin } = setup("x11-b");
    git(work, "fetch", "origin", "develop"); // the ref now exists locally
    git(work, "remote", "set-url", "origin", path.join(tmpRoot, "does-not-exist.git"));
    expect(fs.existsSync(origin)).toBe(true);
    const v = await gate(work);
    expect(v.blockers.map((b) => [b.change, b.state])).toEqual([["x", "satisfied"]]);
    expect(v.notes.join(" ")).toMatch(/git fetch origin develop failed/);
  });

  it("no origin/develop at all → the blocker stays open and the gap is noted", async () => {
    const repo = mkRepoDir("x11-none");
    git(repo, "init", "-b", "os/y");
    write(repo, "openspec/changes/x/proposal.md", "# x\n");
    write(repo, "openspec/changes/y/dependencies.yaml", "blocked_by: [x]\n");
    const v = await gate(repo);
    expect(v.status).toBe("warn");
    expect(v.notes.join(" ")).toMatch(/origin\/develop is not available/);
  });
});
