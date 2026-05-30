/**
 * HTTP-level route tests for the worktree endpoints registered by
 * `registerGitRoutes`. Exercises envelope shape, status codes, and the
 * stable `code` field for each documented error arm.
 *
 * See change: add-worktree-spawn-dialog.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import { registerGitRoutes } from "../routes/git-routes.js";

function git(cmd: string, cwd: string) {
  execSync(`git ${cmd}`, { cwd, stdio: ["pipe", "pipe", "pipe"] });
}

function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "git-wt-routes-")));
  git("-c init.defaultBranch=main init", dir);
  git("config user.email test@test.com", dir);
  git("config user.name Test", dir);
  writeFileSync(join(dir, "README.md"), "init");
  git("add .", dir);
  git("commit -m init", dir);
  return dir;
}

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  // No-op network guard so we can hit the endpoints in tests.
  registerGitRoutes(app, { networkGuard: async () => {} });
  await app.ready();
  return app;
}

describe("GET /api/git/head", () => {
  let app: FastifyInstance;
  let repo: string;
  beforeEach(async () => {
    app = await makeApp();
    repo = makeRepo();
  });
  afterEach(async () => {
    rmSync(repo, { recursive: true, force: true });
    await app.close();
  });

  it("returns { branch, detached, sha } for a fresh repo", async () => {
    const res = await app.inject({ method: "GET", url: `/api/git/head?cwd=${encodeURIComponent(repo)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.branch).toBe("main");
    expect(body.data.detached).toBe(false);
    expect(body.data.sha).toMatch(/^[0-9a-f]{4,}$/);
  });

  it("returns code:cwd_invalid + 400 when cwd is missing", async () => {
    const res = await app.inject({ method: "GET", url: `/api/git/head` });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ success: false, code: "cwd_invalid" });
  });

  it("returns code:not_a_repo for a non-git directory", async () => {
    const plain = mkdtempSync(join(tmpdir(), "no-git-route-"));
    try {
      const res = await app.inject({ method: "GET", url: `/api/git/head?cwd=${encodeURIComponent(plain)}` });
      expect(res.statusCode).toBe(200); // not_a_repo is a success-shape envelope (matches existing /branches arm)
      expect(res.json()).toMatchObject({ success: false, code: "not_a_repo" });
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("GET /api/git/worktrees", () => {
  let app: FastifyInstance;
  let repo: string;
  beforeEach(async () => {
    app = await makeApp();
    repo = makeRepo();
  });
  afterEach(async () => {
    rmSync(repo, { recursive: true, force: true });
    await app.close();
  });

  it("returns one entry (main) for a fresh repo", async () => {
    const res = await app.inject({ method: "GET", url: `/api/git/worktrees?cwd=${encodeURIComponent(repo)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.worktrees).toHaveLength(1);
    expect(body.data.worktrees[0]).toMatchObject({ isMain: true, branch: "main" });
  });

  it("returns code:not_a_repo for a non-git directory", async () => {
    const plain = mkdtempSync(join(tmpdir(), "no-git-route-"));
    try {
      const res = await app.inject({ method: "GET", url: `/api/git/worktrees?cwd=${encodeURIComponent(plain)}` });
      expect(res.json()).toMatchObject({ success: false, code: "not_a_repo" });
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("POST /api/git/worktree", () => {
  let app: FastifyInstance;
  let repo: string;
  beforeEach(async () => {
    app = await makeApp();
    repo = makeRepo();
  });
  afterEach(async () => {
    rmSync(repo, { recursive: true, force: true });
    await app.close();
  });

  it("creates a worktree with auto-derived path and returns 200", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/git/worktree`,
      payload: { cwd: repo, base: "main", newBranch: "feat/dark-mode" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.path).toBe(join(repo, ".worktrees", "feat-dark-mode"));
    expect(body.data.branch).toBe("feat/dark-mode");
    expect(body.data.excludeAppended).toBe(true);
  });

  it("returns 400 + code:cwd_invalid when base is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/git/worktree`,
      payload: { cwd: repo, newBranch: "feat/x" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ success: false, code: "cwd_invalid" });
  });

  it("returns 400 + code:cwd_invalid when newBranch is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/git/worktree`,
      payload: { cwd: repo, base: "main" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ success: false, code: "cwd_invalid" });
  });

  it("returns 400 + code:base_not_found when base ref does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/git/worktree`,
      payload: { cwd: repo, base: "no-such-ref", newBranch: "feat/x" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ success: false, code: "base_not_found" });
  });

  it("returns 409 + code:path_exists when target path is non-empty", async () => {
    const collide = join(repo, ".worktrees", "feat-x");
    execSync(`mkdir -p '${collide}' && echo hi > '${collide}/file.txt'`);
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/git/worktree`,
        payload: { cwd: repo, base: "main", newBranch: "feat/x" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ success: false, code: "path_exists" });
    } finally {
      rmSync(join(repo, ".worktrees"), { recursive: true, force: true });
    }
  });

  it("path_exists envelope carries orphanLikely:true for non-registered orphan dir", async () => {
    const collide = join(repo, ".worktrees", "feat-orphan");
    execSync(`mkdir -p '${collide}' && echo hi > '${collide}/file.txt'`);
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/git/worktree`,
        payload: { cwd: repo, base: "main", newBranch: "feat/orphan" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ success: false, code: "path_exists", orphanLikely: true });
    } finally {
      rmSync(join(repo, ".worktrees"), { recursive: true, force: true });
    }
  });
});

describe("POST /api/git/worktree/orphan-cleanup", () => {
  let app: FastifyInstance;
  let repo: string;
  beforeEach(async () => {
    app = await makeApp();
    repo = makeRepo();
  });
  afterEach(async () => {
    rmSync(repo, { recursive: true, force: true });
    await app.close();
  });

  it("happy path: 200 ok and removes the orphan dir", async () => {
    const orphan = join(repo, ".worktrees", "orphan");
    execSync(`mkdir -p '${orphan}' && echo hi > '${orphan}/tsconfig.json'`);
    const res = await app.inject({
      method: "POST",
      url: `/api/git/worktree/orphan-cleanup`,
      payload: { cwd: repo, path: orphan },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true });
    expect(() => execSync(`ls '${orphan}'`, { stdio: "pipe" })).toThrow();
  });

  it("400 + outside_repo when path is outside cwd", async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "orphan-outside-"));
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/git/worktree/orphan-cleanup`,
        payload: { cwd: repo, path: elsewhere },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ success: false, code: "outside_repo" });
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("400 + not_a_directory when path does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/git/worktree/orphan-cleanup`,
      payload: { cwd: repo, path: join(repo, ".worktrees", "never-existed") },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ success: false, code: "not_a_directory" });
  });

  it("409 + looks_like_worktree when dir contains a .git entry", async () => {
    const dir = join(repo, ".worktrees", "fake-wt");
    execSync(`mkdir -p '${dir}' && touch '${dir}/.git'`);
    const res = await app.inject({
      method: "POST",
      url: `/api/git/worktree/orphan-cleanup`,
      payload: { cwd: repo, path: dir },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ success: false, code: "looks_like_worktree" });
  });

  it("409 + not_orphan when path IS a registered worktree", async () => {
    git("worktree add .worktrees/real-wt -b real-wt", repo);
    const res = await app.inject({
      method: "POST",
      url: `/api/git/worktree/orphan-cleanup`,
      payload: { cwd: repo, path: join(repo, ".worktrees", "real-wt") },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ success: false, code: "not_orphan" });
  });

  it("409 + too_many_files when dir exceeds 20 files", async () => {
    const dir = join(repo, ".worktrees", "many");
    execSync(`mkdir -p '${dir}'`);
    for (let i = 0; i < 25; i++) {
      writeFileSync(join(dir, `f${i}.txt`), "x");
    }
    const res = await app.inject({
      method: "POST",
      url: `/api/git/worktree/orphan-cleanup`,
      payload: { cwd: repo, path: dir },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ success: false, code: "too_many_files" });
  });

  it("400 + cwd_invalid when path missing from body", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/git/worktree/orphan-cleanup`,
      payload: { cwd: repo },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ success: false, code: "cwd_invalid" });
  });
});


describe("worktree-create route — per-request timeout disable", () => {
  let app: FastifyInstance;
  let repo: string;
  beforeEach(async () => {
    app = await makeApp();
    repo = makeRepo();
  });
  afterEach(async () => {
    rmSync(repo, { recursive: true, force: true });
    await app.close();
  });

  // Regression: the bootstrap step (inline `await runBootstrap` for repos
  // whose `.pi/settings.json` references the parent) can exceed Fastify's
  // 10 s `connectionTimeout`. The route must disable the per-socket timeout
  // so the response actually reaches the browser. See change:
  // openspec-worktree-spawn-button.
  it("invokes setTimeout(0) on the raw socket when POST /api/git/worktree handler runs", async () => {
    // We can't directly observe the call inside the handler from outside,
    // so we assert by source inspection: the production handler MUST contain
    // the optional-chained setTimeout disable. Pinning here so refactors
    // that drop the line are caught by CI rather than discovered in the UI.
    const { readFileSync } = await import("node:fs");
    const routesPath = new URL("../routes/git-routes.ts", import.meta.url);
    const src = readFileSync(routesPath, "utf-8");
    const occurrences = (src.match(/request\.raw\.socket\?\.setTimeout\?\.\(0\)/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("happy-path POST /api/git/worktree still succeeds (smoke after timeout-disable)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/git/worktree`,
      payload: { cwd: repo, base: "main", newBranch: "feat/timeout-smoke" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });
});
