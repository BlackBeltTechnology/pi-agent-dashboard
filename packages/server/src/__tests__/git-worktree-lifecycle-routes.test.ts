/**
 * HTTP route tests for the worktree lifecycle endpoints.
 * Pins envelope shape + status codes + stable error codes.
 *
 * See change: add-worktree-lifecycle-actions.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as platformExec from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addWorktree } from "../git-worktree/git-operations.js";
import { registerGitRoutes } from "../routes/git-routes.js";
import type { SessionManager } from "../session/memory-session-manager.js";

function git(cmd: string, cwd: string) {
  execSync(`git ${cmd}`, { cwd, stdio: ["pipe", "pipe", "pipe"] });
}

function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "git-wt-life-routes-")));
  git("-c init.defaultBranch=main init", dir);
  git("config user.email test@test.com", dir);
  git("config user.name Test", dir);
  writeFileSync(join(dir, "README.md"), "init");
  git("add .", dir);
  git("commit -m init", dir);
  return dir;
}

interface StubGateway {
  broadcasts: Array<{ id: string; updates: any }>;
  broadcastSessionUpdated(id: string, updates: any): void;
}

function makeStubGateway(): StubGateway {
  const broadcasts: Array<{ id: string; updates: any }> = [];
  return {
    broadcasts,
    broadcastSessionUpdated(id, updates) { broadcasts.push({ id, updates }); },
  };
}

function makeStubSessionManager(sessions: DashboardSession[]): SessionManager {
  const map = new Map(sessions.map((s) => [s.id, { ...s }]));
  return {
    register: () => { throw new Error("unused"); },
    restore: () => { /* unused */ },
    unregister: () => { /* unused */ },
    update(id, updates) {
      const s = map.get(id);
      if (s) Object.assign(s, updates);
    },
    get: (id) => map.get(id),
    listActive: () => Array.from(map.values()).filter((s) => s.status !== "ended"),
    listAll: () => Array.from(map.values()),
  };
}

async function makeApp(opts?: {
  sessions?: DashboardSession[];
  gateway?: StubGateway;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const sessionManager = opts?.sessions
    ? makeStubSessionManager(opts.sessions)
    : undefined;
  registerGitRoutes(app, {
    networkGuard: async () => {},
    sessionManager,
    browserGateway: opts?.gateway as any,
  });
  await app.ready();
  return app;
}

// ── /remove ────────────────────────────────────────────────────────

describe("POST /api/git/worktree/remove", () => {
  let app: FastifyInstance;
  let repo: string;
  beforeEach(async () => { repo = makeRepo(); });
  afterEach(async () => {
    rmSync(repo, { recursive: true, force: true });
    if (app) await app.close();
  });

  it("removes a clean worktree → success envelope", async () => {
    app = await makeApp();
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/clean" });
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove",
      payload: { cwd: add.path },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, data: { removed: true } });
  });

  it("returns 409 + active_sessions when sessions are inside", async () => {
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/blocked" });
    if (!add.ok) return;
    const session: DashboardSession = {
      id: "s1", cwd: add.path, source: "dashboard", status: "active", startedAt: Date.now(),
    } as any;
    app = await makeApp({ sessions: [session] });
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove",
      payload: { cwd: add.path },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      success: false,
      code: "active_sessions",
      data: { sessionIds: ["s1"] },
    });
  });

  it("returns 400 + cwd_invalid when cwd missing", async () => {
    app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ success: false, code: "cwd_invalid" });
  });

  it("returns 400 + not_a_worktree on non-repo path", async () => {
    const plain = realpathSync(mkdtempSync(join(tmpdir(), "no-repo-")));
    try {
      app = await makeApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/git/worktree/remove",
        payload: { cwd: plain },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ success: false, code: "not_a_worktree" });
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it("returns 409 + dirty_worktree when modified files exist", async () => {
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/dirty" });
    if (!add.ok) return;
    writeFileSync(join(add.path, "u.txt"), "stuff");
    app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove",
      payload: { cwd: add.path },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ success: false, code: "dirty_worktree" });
  });

  it("broadcasts cwdMissing for every session under removed path", async () => {
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/broadcast" });
    if (!add.ok) return;
    const ended: DashboardSession = {
      id: "ended1", cwd: add.path, source: "dashboard", status: "ended", startedAt: 1,
    } as any;
    const gateway = makeStubGateway();
    app = await makeApp({ sessions: [ended], gateway });
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove",
      payload: { cwd: add.path },
    });
    expect(res.statusCode).toBe(200);
    expect(gateway.broadcasts).toContainEqual({ id: "ended1", updates: { cwdMissing: true } });
  });
});

// ── /merge ────────────────────────────────────────────────────────

describe("POST /api/git/worktree/merge", () => {
  let app: FastifyInstance;
  let repo: string;
  beforeEach(async () => { repo = makeRepo(); });
  afterEach(async () => {
    rmSync(repo, { recursive: true, force: true });
    if (app) await app.close();
  });

  it("merges cleanly and returns mergeSha", async () => {
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/clean" });
    if (!add.ok) return;
    writeFileSync(join(add.path, "f.txt"), "hi");
    execSync(`git -c user.email=t@t.com -c user.name=T add . && git -c user.email=t@t.com -c user.name=T commit -m f`, { cwd: add.path, shell: "/bin/bash" } as any);
    app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/merge",
      payload: { cwd: add.path },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.mergeSha).toMatch(/^[0-9a-f]+$/);
  });

  it("returns 409 + dirty_main when main is dirty", async () => {
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/dm" });
    if (!add.ok) return;
    writeFileSync(join(repo, "scratch.txt"), "wip");
    app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/merge",
      payload: { cwd: add.path },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ success: false, code: "dirty_main" });
  });
});

// ── /push ────────────────────────────────────────────────────────

describe("POST /api/git/worktree/push", () => {
  let app: FastifyInstance;
  let repo: string;
  beforeEach(async () => { repo = makeRepo(); });
  afterEach(async () => {
    rmSync(repo, { recursive: true, force: true });
    if (app) await app.close();
  });

  it("returns 400 + no_remote when origin missing", async () => {
    app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/push",
      payload: { cwd: repo },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ success: false, code: "no_remote" });
  });

  it("succeeds against a bare-repo remote", async () => {
    const bare = realpathSync(mkdtempSync(join(tmpdir(), "bare-")));
    try {
      execSync("git init --bare", { cwd: bare, stdio: ["pipe", "pipe", "pipe"] });
      execSync(`git remote add origin ${bare}`, { cwd: repo });
      app = await makeApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/git/worktree/push",
        payload: { cwd: repo },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ success: true });
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

// ── /pr ────────────────────────────────────────────────────────

describe("POST /api/git/worktree/pr", () => {
  let app: FastifyInstance;
  let repo: string;
  beforeEach(async () => { repo = makeRepo(); });
  afterEach(async () => {
    rmSync(repo, { recursive: true, force: true });
    if (app) await app.close();
  });

  it("returns 400 + cwd_invalid when cwd missing", async () => {
    app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/pr",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ success: false, code: "cwd_invalid" });
  });

  // gh-resolved success / failure paths are exercised via the unit mapper
  // tests; we don't shell out to gh in CI.
});

// ── /diff-stat ────────────────────────────────────────────────────────

describe("GET /api/git/worktree/diff-stat", () => {
  let app: FastifyInstance;
  let repo: string;
  beforeEach(async () => { repo = makeRepo(); });
  afterEach(async () => {
    rmSync(repo, { recursive: true, force: true });
    if (app) await app.close();
  });

  it("returns 0/0/0 envelope when branch == base", async () => {
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/empty" });
    if (!add.ok) return;
    app = await makeApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/git/worktree/diff-stat?cwd=${encodeURIComponent(add.path)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.filesChanged).toBe(0);
  });

  it("returns 400 + cwd_invalid when cwd missing", async () => {
    app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/git/worktree/diff-stat" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ success: false, code: "cwd_invalid" });
  });
});

// ── deleteBranch / main-worktree guard (change: manage-worktrees-filter-cleanup) ──

describe("POST /api/git/worktree/remove — branch delete + main guard", () => {
  let app: FastifyInstance;
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(async () => {
    rmSync(repo, { recursive: true, force: true });
    if (app) await app.close();
  });

  // test-plan #X4 — an unmerged branch must NOT surface as a RemoveCode, or
  // CloseWorktreeDialog keys on it and auto-ticks --force to retry.
  it("reports a refused branch delete as 200 + branchDeleteCode, never branch_not_merged", async () => {
    app = await makeApp();
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/unmerged-route" });
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    writeFileSync(join(add.path, "work.txt"), "w");
    git("add .", add.path);
    git("commit -m work", add.path);

    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove",
      payload: { cwd: add.path, deleteBranch: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      success: true,
      data: { removed: true, branchDeleted: false, branchDeleteCode: "unmerged" },
    });
    expect(body.code).not.toBe("branch_not_merged");
    expect(JSON.stringify(body)).not.toContain("branch_not_merged");
  });

  // test-plan #E14
  it("rejects the main worktree's own path without running git worktree remove", async () => {
    app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove",
      payload: { cwd: repo },
    });
    expect(res.json()).toMatchObject({ success: false, code: "is_main_worktree" });
    expect(res.statusCode).not.toBe(500);
    // The repo is untouched — a real `git worktree remove` would have failed loudly.
    expect(existsSync(join(repo, ".git"))).toBe(true);
  });
});

// ── /remove-batch ──────────────────────────────────────────────────

describe("POST /api/git/worktree/remove-batch", () => {
  let app: FastifyInstance;
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(async () => {
    rmSync(repo, { recursive: true, force: true });
    if (app) await app.close();
  });

  function addThree(): string[] {
    return ["a", "b", "c"].map((n) => {
      const add = addWorktree({ cwd: repo, base: "main", newBranch: `feat/${n}` });
      if (!add.ok) throw new Error(`addWorktree failed for ${n}`);
      return add.path;
    });
  }

  // test-plan #X1
  it("reports per-item results in input order and never aborts on first failure", async () => {
    app = await makeApp();
    const [p1, p2, p3] = addThree();
    writeFileSync(join(p2, "untracked.txt"), "dirty");

    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove-batch",
      payload: { items: [{ cwd: p1 }, { cwd: p2 }, { cwd: p3 }] },
    });
    expect(res.statusCode).toBe(200);
    const results = res.json().data.results;
    expect(results).toHaveLength(3);
    expect(results.map((r: any) => r.cwd)).toEqual([p1, p2, p3]);
    expect(results[0]).toMatchObject({ ok: true, code: "ok" });
    expect(results[1]).toMatchObject({ ok: false, code: "dirty_worktree" });
    expect(results[2]).toMatchObject({ ok: true, code: "ok" });
    expect(existsSync(p1)).toBe(false);
    expect(existsSync(p2)).toBe(true);
    expect(existsSync(p3)).toBe(false);
  });

  // test-plan #X2
  it("blocks only the item with active sessions, carrying its own sessionIds", async () => {
    const [p1, p2, p3] = addThree();
    const sessions = ["s1", "s2"].map((id) => ({
      id, cwd: p2, source: "dashboard", status: "active", startedAt: Date.now(),
    })) as any as DashboardSession[];
    app = await makeApp({ sessions });

    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove-batch",
      payload: { items: [{ cwd: p1 }, { cwd: p2 }, { cwd: p3 }] },
    });
    const results = res.json().data.results;
    expect(results[1]).toMatchObject({ ok: false, code: "active_sessions" });
    expect(results[1].sessionIds.sort()).toEqual(["s1", "s2"]);
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[2]).toMatchObject({ ok: true });
  });

  // test-plan #X10
  it("rejects an out-of-repo / invalid item per row while the rest still process", async () => {
    app = await makeApp();
    const [p1, , p3] = addThree();
    // A real directory OUTSIDE the repo, actually TARGETED by the batch — a
    // bad item that is merely `""` would leave the marker untouched under any
    // implementation, making the assertion vacuous.
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "outside-")));
    const marker = join(outside, "keep.txt");
    writeFileSync(marker, "keep");

    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove-batch",
      payload: { items: [{ cwd: p1 }, { cwd: outside }, { cwd: p3 }] },
    });
    const results = res.json().data.results;
    // Not a worktree → rejected per row, never removed.
    expect(results[1].ok).toBe(false);
    expect(results[1].code).toBe("not_a_worktree");
    // The surrounding items still process — no abort on first failure.
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[2]).toMatchObject({ ok: true });
    // Nothing outside the repo was touched.
    expect(existsSync(marker)).toBe(true);
    expect(existsSync(outside)).toBe(true);

    // A structurally invalid cwd is rejected too, with its own code.
    const bad = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove-batch",
      payload: { items: [{ cwd: "" }] },
    });
    expect(bad.json().data.results[0]).toMatchObject({ ok: false, code: "cwd_invalid" });
    rmSync(outside, { recursive: true, force: true });
  });

  // test-plan #X3
  it("stamps cwdMissing + broadcasts once per session under a removed item", async () => {
    const [p1] = addThree();
    const gateway = makeStubGateway();
    const sessions = ["s1", "s2"].map((id) => ({
      id, cwd: p1, source: "dashboard", status: "active", startedAt: Date.now(),
    })) as any as DashboardSession[];
    app = await makeApp({ sessions, gateway });

    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove-batch",
      payload: { items: [{ cwd: p1, force: true }] },
    });
    expect(res.json().data.results[0]).toMatchObject({ ok: true });
    expect(gateway.broadcasts).toHaveLength(2);
    expect(gateway.broadcasts.map((b) => b.id).sort()).toEqual(["s1", "s2"]);
    for (const b of gateway.broadcasts) expect(b.updates).toMatchObject({ cwdMissing: true });
  });

  // test-plan #E11
  it("rejects a malformed body with 400 and runs zero git commands", async () => {
    app = await makeApp();
    const [p1] = addThree();
    for (const payload of [{}, { items: null }, { items: "abc" }, { items: {} }]) {
      const res = await app.inject({
        method: "POST", url: "/api/git/worktree/remove-batch", payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toMatchObject({ success: false, code: "items_invalid" });
    }
    // Nothing was removed.
    expect(existsSync(p1)).toBe(true);
  });

  // test-plan #E5
  it("accepts the empty batch and a single-item batch", async () => {
    app = await makeApp();
    const empty = await app.inject({
      method: "POST", url: "/api/git/worktree/remove-batch", payload: { items: [] },
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().data.results).toEqual([]);

    const [p1] = addThree();
    const one = await app.inject({
      method: "POST", url: "/api/git/worktree/remove-batch", payload: { items: [{ cwd: p1 }] },
    });
    expect(one.json().data.results).toHaveLength(1);
    expect(one.json().data.results[0]).toMatchObject({ ok: true });
  });

  // test-plan #E6
  it("processes 50 items and rejects 51 with the stable cap code", async () => {
    app = await makeApp();
    // 50 non-existent-but-shaped items: the cap is checked BEFORE any git runs,
    // so the boundary is observable without creating 50 real worktrees.
    const fifty = Array.from({ length: 50 }, (_, i) => ({ cwd: join(repo, `.worktrees/x${i}`) }));
    const ok = await app.inject({
      method: "POST", url: "/api/git/worktree/remove-batch", payload: { items: fifty },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.results).toHaveLength(50);

    const over = await app.inject({
      method: "POST",
      url: "/api/git/worktree/remove-batch",
      payload: { items: [...fifty, { cwd: join(repo, ".worktrees/x50") }] },
    });
    expect(over.statusCode).toBe(400);
    expect(over.json()).toMatchObject({ success: false, code: "batch_too_large" });
    expect(over.json().data).toBeUndefined();
  });
});

// ── /prune + guard coverage ────────────────────────────────────────

describe("POST /api/git/worktree/prune", () => {
  let app: FastifyInstance;
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(async () => {
    rmSync(repo, { recursive: true, force: true });
    if (app) await app.close();
  });

  it("prunes stale registrations and reports the count", async () => {
    app = await makeApp();
    const add = addWorktree({ cwd: repo, base: "main", newBranch: "feat/stale" });
    if (!add.ok) return;
    rmSync(add.path, { recursive: true, force: true });
    const res = await app.inject({
      method: "POST", url: "/api/git/worktree/prune", payload: { cwd: repo },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.pruned).toBeGreaterThan(0);
  });

  // test-plan #X9
  it("both new endpoints sit behind networkGuard and respond when it allows", async () => {
    const denied = Fastify({ logger: false });
    const gitCalls: string[] = [];
    const realExec = platformExec.execSync;
    const spy = vi.spyOn(platformExec, "execSync").mockImplementation(((cmd: any, opts: any) => {
      gitCalls.push(String(cmd));
      return realExec(cmd, opts);
    }) as any);
    try {
      registerGitRoutes(denied, {
        networkGuard: async (_req: any, reply: any) => {
          reply.code(403);
          return reply.send({ success: false, code: "forbidden" });
        },
      } as any);
      await denied.ready();
      for (const url of ["/api/git/worktree/remove-batch", "/api/git/worktree/prune"]) {
        const res = await denied.inject({ method: "POST", url, payload: { cwd: repo, items: [] } });
        expect(res.statusCode, url).toBe(403);
      }
      expect(gitCalls).toEqual([]);
      await denied.close();
    } finally {
      spy.mockRestore();
    }

    // Guard allows → both endpoints exist (not 404).
    app = await makeApp();
    for (const url of ["/api/git/worktree/remove-batch", "/api/git/worktree/prune"]) {
      const res = await app.inject({ method: "POST", url, payload: { cwd: repo, items: [] } });
      expect(res.statusCode, url).not.toBe(404);
    }
  });
});
