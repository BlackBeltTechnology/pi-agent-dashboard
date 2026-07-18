/**
 * HTTP route tests for the worktree lifecycle endpoints.
 * Pins envelope shape + status codes + stable error codes.
 *
 * See change: add-worktree-lifecycle-actions.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import { registerGitRoutes } from "../routes/git-routes.js";
import { addWorktree } from "../git-worktree/git-operations.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

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
