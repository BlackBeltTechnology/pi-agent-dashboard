/**
 * HTTP-level route tests for the worktree endpoints registered by
 * `registerGitRoutes`. Exercises envelope shape, status codes, and the
 * stable `code` field for each documented error arm.
 *
 * See change: add-worktree-spawn-dialog.
 */

import { execSync } from "node:child_process";
import fs, { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAdmissionLive } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gitOps from "../git-worktree/git-operations.js";
import { type GitRoutesDeps, registerGitRoutes } from "../routes/git-routes.js";
import {
  addLinkedWorktree,
  captureAdmissions,
  cleanupAdmissionDirs,
  failingRunner,
  makeGitRepo,
  realpathFailingFor,
  tmpDir,
} from "./helpers/admission-test-kit.js";

/** Dirs the route admission treats as known folders (session/pinned stand-ins). See change: core-cwd-admission. */
const KNOWN: string[] = [];
const known = <T extends string>(p: T): T => {
  KNOWN.push(p);
  return p;
};

function git(cmd: string, cwd: string) {
  execSync(`git ${cmd}`, { cwd, stdio: ["pipe", "pipe", "pipe"] });
}

function makeRepo(): string {
  const dir = known(realpathSync(mkdtempSync(join(tmpdir(), "git-wt-routes-"))));
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
  registerGitRoutes(app, { networkGuard: async () => {}, knownCwds: () => KNOWN });
  await app.ready();
  return app;
}

/**
 * @structural-pin app.inject cannot observe the raw socket: the handler's setTimeout(0) and restore-on-finish are only visible in the route source
 */
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
    const plain = known(mkdtempSync(join(tmpdir(), "no-git-route-")));
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
    const plain = known(mkdtempSync(join(tmpdir(), "no-git-route-")));
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

  it("checks out an existing branch when newBranch is omitted (checkout mode)", async () => {
    // newBranch is now optional: `{cwd, base}` checks out `base` directly.
    // See change: worktree-checkout-existing-branch.
    git("branch stale-feature", repo);
    const res = await app.inject({
      method: "POST",
      url: `/api/git/worktree`,
      payload: { cwd: repo, base: "stale-feature" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, data: { branch: "stale-feature" } });
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
    const elsewhere = known(mkdtempSync(join(tmpdir(), "orphan-outside-")));
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

  // Regression: the worktree-init run (script install / detached agent) can
  // exceed Fastify's 10 s `connectionTimeout`. The POST /init handler must
  // disable the per-socket timeout so the response reaches the browser, and
  // restore it on response finish so keep-alive sockets don't inherit ∞.
  // See change: generalize-worktree-init-hook.
  it("disables then restores the per-socket timeout in the init handler", async () => {
    // We can't directly observe the call inside the handler from outside,
    // so we assert by source inspection: the production handler MUST disable
    // the socket timeout and register a restore on response finish. Pinning
    // here so refactors that drop these are caught by CI, not in the UI.
    const { readFileSync } = await import("node:fs");
    const routesPath = new URL("../routes/git-routes.ts", import.meta.url);
    const src = readFileSync(routesPath, "utf-8");
    expect(/socket\?\.setTimeout\?\.\(0\)/.test(src)).toBe(true);
    expect(/reply\.raw\.once\("finish"/.test(src)).toBe(true);
    expect(/socket\.setTimeout\(prevTimeout\)/.test(src)).toBe(true);
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


// ── core-cwd-admission: git routes admit the cwd before any operation ────────────────────
// See change: core-cwd-admission (test-plan E1–E6, E15, X1, X2, X5).

describe("git routes — cwd admission", () => {
  afterAll(() => cleanupAdmissionDirs());
  afterEach(() => vi.restoreAllMocks());

  async function appWith(known: string[], extra: Partial<GitRoutesDeps> = {}): Promise<FastifyInstance> {
    const a = Fastify({ logger: false });
    registerGitRoutes(a, { networkGuard: async () => {}, knownCwds: () => known, ...extra });
    await a.ready();
    return a;
  }
  const status = (a: FastifyInstance, cwd: string) =>
    a.inject({ method: "GET", url: `/api/git/status?cwd=${encodeURIComponent(cwd)}` });
  const PIN_MESSAGE = "cwd is not a known folder; pin the repository to allow git operations";

  it("E1: a known session cwd is admitted without spawning git from admission", async () => {
    const repo = makeGitRepo();
    const spawns: string[] = [];
    const app = await appWith([repo], {
      admitOptions: { runner: async (recipe, input, ctx) => { spawns.push("probe"); return failingRunner(recipe, input, ctx); } },
    });
    const res = await status(app, repo);
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(spawns).toEqual([]);
    await app.close();
  });

  it("E2: a linked worktree of a pinned repo (no session) is admitted", async () => {
    const repo = makeGitRepo();
    const wt = addLinkedWorktree(repo, "e2");
    const app = await appWith([repo]);
    const res = await status(app, wt);
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    await app.close();
  });

  it("E3: sibling worktree, main checkout of a known worktree, child of a pinned non-repo and a symlink to unknown are refused with the pin hint", async () => {
    const repo = makeGitRepo();
    const w1 = addLinkedWorktree(repo, "e3a");
    const w2 = addLinkedWorktree(repo, "e3b");
    const pinnedParent = tmpDir("adm-parent-");
    const child = join(pinnedParent, "r");
    mkdirSync(child);
    execSync("git init -q", { cwd: child });
    const unknown = tmpDir("adm-unknown-");
    const k = makeGitRepo();
    symlinkSync(unknown, join(k, "link-to-unknown"));
    const opSpy = vi.spyOn(gitOps, "getGitStatus");
    const cases: Array<[string, string[], string]> = [
      ["sibling", [w1], w2],
      ["main checkout of a known worktree", [w1], repo],
      ["child of a pinned non-repo", [pinnedParent], child],
      ["symlink to an unknown dir", [k], join(k, "link-to-unknown")],
    ];
    for (const [label, known, cwd] of cases) {
      const app = await appWith(known);
      const res = await status(app, cwd);
      expect({ label, status: res.statusCode, body: res.json() }).toMatchObject({
        status: 400,
        body: { success: false, code: "cwd_unknown", error: PIN_MESSAGE },
      });
      await app.close();
    }
    expect(opSpy).not.toHaveBeenCalled();
  });

  it("E4: every one of the 23 git sites refuses an unknown existing dir before any operation", async () => {
    const unknown = tmpDir("adm-u-");
    const ops = gitOps as unknown as Record<string, (...args: unknown[]) => unknown>;
    const opSpies = Object.keys(ops)
      .filter((k) => typeof ops[k] === "function")
      .map((k) => vi.spyOn(ops, k));
    const fsSpies = (["statSync", "existsSync", "realpathSync", "readdirSync"] as const).map((k) => vi.spyOn(fs, k));
    const enc = encodeURIComponent(unknown);
    const sites: Array<[string, "GET" | "POST", string, object?]> = [
      ["branches", "GET", `/api/git/branches?cwd=${enc}`],
      ["checkout", "POST", "/api/git/checkout", { cwd: unknown, branch: "x" }],
      ["init", "POST", "/api/git/init", { cwd: unknown }],
      ["stash-pop", "POST", "/api/git/stash-pop", { cwd: unknown }],
      ["status", "GET", `/api/git/status?cwd=${enc}`],
      ["changed-files", "GET", `/api/git/changed-files?cwd=${enc}`],
      ["commit", "POST", "/api/git/commit", { cwd: unknown, message: "m", files: ["a"] }],
      ["commit-draft", "POST", "/api/git/commit-draft", { cwd: unknown, files: ["a"], sessionId: "s" }],
      ["head", "GET", `/api/git/head?cwd=${enc}`],
      ["worktrees", "GET", `/api/git/worktrees?cwd=${enc}`],
      ["init-status", "GET", `/api/git/worktree/init-status?cwd=${enc}`],
      ["worktree/init", "POST", "/api/git/worktree/init", { cwd: unknown }],
      ["worktree", "POST", "/api/git/worktree", { cwd: unknown, base: "main" }],
      ["orphan-cleanup", "POST", "/api/git/worktree/orphan-cleanup", { cwd: unknown, path: "x" }],
      ["remove", "POST", "/api/git/worktree/remove", { cwd: unknown }],
      ["prune", "POST", "/api/git/worktree/prune", { cwd: unknown }],
      ["merge", "POST", "/api/git/worktree/merge", { cwd: unknown }],
      ["push", "POST", "/api/git/worktree/push", { cwd: unknown }],
      ["pr", "POST", "/api/git/worktree/pr", { cwd: unknown }],
      ["pull-requests", "GET", `/api/git/pull-requests?cwd=${enc}`],
      ["from-pr", "POST", "/api/git/worktree/from-pr", { cwd: unknown, prNumber: 1 }],
      ["diff-stat", "GET", `/api/git/worktree/diff-stat?cwd=${enc}`],
    ];
    expect(sites).toHaveLength(22); // + remove-batch (per-item envelope, test E13) = 23 sites
    const app = await appWith([]);
    for (const [name, method, url, payload] of sites) {
      const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
      expect({ name, status: res.statusCode, code: res.json().code }).toEqual({ name, status: 400, code: "cwd_unknown" });
    }
    const batch = await app.inject({ method: "POST", url: "/api/git/worktree/remove-batch", payload: { items: [{ cwd: unknown }] } });
    expect(batch.json().data.results).toEqual([{ cwd: unknown, ok: false, code: "cwd_unknown" }]);
    for (const spy of opSpies) expect(spy.mock.calls, spy.getMockName()).toHaveLength(0);
    for (const spy of fsSpies) expect(spy.mock.calls.filter(([p]) => p === unknown)).toEqual([]);
    expect(existsSync(join(unknown, ".git"))).toBe(false);
    await app.close();
  });

  it("E5: cwd states map to their documented codes", async () => {
    const repo = makeGitRepo();
    const pinnedNonRepo = tmpDir("adm-nonrepo-");
    const gone = tmpDir("adm-gone-");
    rmSync(gone, { recursive: true });
    const unknownMissing = join(tmpDir("adm-u-"), "missing");
    const file = join(repo, "README.md");
    const app = await appWith([repo, pinnedNonRepo, gone]);
    const get = (url: string) => app.inject({ method: "GET", url });
    const enc = encodeURIComponent;

    const omitted = await get("/api/git/status");
    expect(omitted.statusCode).toBe(400);
    expect(omitted.json()).toMatchObject({ code: "cwd_invalid", error: "cwd required" });

    const deleted = await status(app, gone);
    expect(deleted.statusCode).toBe(400);
    expect(deleted.json()).toMatchObject({ code: "cwd_invalid", error: "cwd does not exist" });

    const missing = await status(app, unknownMissing);
    expect(missing.statusCode).toBe(400);
    expect(missing.json().code).toBe("cwd_unknown");

    const regular = await status(app, file);
    expect(regular.statusCode).toBe(400);
    expect(regular.json().code).toBe("cwd_unknown");

    const nonRepo = await get(`/api/git/head?cwd=${enc(pinnedNonRepo)}`);
    expect(nonRepo.json()).toMatchObject({ success: false, code: "not_a_repo" });

    const branches = await get("/api/git/branches");
    expect(branches.statusCode).toBe(400);
    expect(branches.json()).toMatchObject({ code: "cwd_required", error: "cwd parameter required" });
    await app.close();
  });

  it("E6: the operation receives the canonical cwd of a pinned symlink", async () => {
    const repo = makeGitRepo();
    const link = join(tmpDir("adm-link-"), "L");
    symlinkSync(repo, link);
    const opSpy = vi.spyOn(gitOps, "getGitStatus");
    const app = await appWith([link]);
    const res = await status(app, link);
    expect(res.statusCode).toBe(200);
    expect(opSpy).toHaveBeenCalledWith(realpathSync(repo));
    await app.close();
  });

  it("X1: indeterminate admission answers 503 with the shared body and runs no operation", async () => {
    const unknown = tmpDir("adm-x1-");
    const opSpy = vi.spyOn(gitOps, "getGitStatus");
    const app = await appWith([], { admitOptions: { runner: failingRunner } });
    const res = await status(app, unknown);
    expect(res.statusCode).toBe(503);
    expect(res.headers["retry-after"]).toBe("1");
    expect(res.json()).toEqual({
      success: false,
      code: "cwd-admission-unavailable",
      error: "cwd-admission-unavailable",
      message: "cwd admission could not be decided right now",
      retryAfterMs: 1000,
    });
    expect(opSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it("X2: one unreadable pinned entry makes unknown cwds 503 but known ones still admitted", async () => {
    const repo = makeGitRepo();
    const unreadable = join(tmpDir("adm-x2-"), "locked");
    const unknown = tmpDir("adm-x2u-");
    const app = await appWith([repo, unreadable], { admitOptions: { realpath: realpathFailingFor(unreadable) } });
    const u = await status(app, unknown);
    expect(u.statusCode).toBe(503);
    expect(u.json().code).toBe("cwd-admission-unavailable");
    const k = await status(app, repo);
    expect(k.statusCode).toBe(200);
    await app.close();
  });

  it("X5: the admission token is no longer live after the response (success and throwing op)", async () => {
    const repo = makeGitRepo();
    const cap = captureAdmissions();
    const app = await appWith([repo]);
    expect((await status(app, repo)).statusCode).toBe(200);
    vi.spyOn(gitOps, "getChangedFiles").mockRejectedValueOnce(new Error("boom"));
    const res = await app.inject({ method: "GET", url: `/api/git/changed-files?cwd=${encodeURIComponent(repo)}` });
    expect(res.json().success).toBe(false);
    expect(cap.tokens).toHaveLength(2);
    for (const t of cap.tokens) expect(isAdmissionLive(t)).toBe(false);
    cap.restore();
    await app.close();
  });

  it("E15: a worktree spawned from the dashboard is refused for init-status until a session is registered at it", async () => {
    const repo = makeGitRepo();
    const w0 = addLinkedWorktree(repo, "e15-w0");
    const known = [w0]; // only W0 has a session
    const app = await appWith(known);
    const wt = join(tmpDir("adm-e15-"), "w");
    const created = await app.inject({ method: "POST", url: "/api/git/worktree", payload: { cwd: w0, base: "main", newBranch: "e15", path: wt } });
    expect(created.json().success).toBe(true);
    const probe = () => app.inject({ method: "GET", url: `/api/git/worktree/init-status?cwd=${encodeURIComponent(realpathSync(wt))}` });
    const before = await probe();
    expect(before.statusCode).toBe(400);
    expect(before.json().code).toBe("cwd_unknown");
    known.push(realpathSync(wt)); // the spawned session registers
    expect((await probe()).statusCode).toBe(200);
    await app.close();
  });
});
