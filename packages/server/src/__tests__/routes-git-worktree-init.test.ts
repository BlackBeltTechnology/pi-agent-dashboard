/**
 * Route tests for the worktree-init endpoints:
 *   GET  /api/git/worktree/init-status
 *   POST /api/git/worktree/init
 *
 * Covers `git-operations-api` scenarios: no-hook, needs-init true/false,
 * untrusted → confirm flow, script success/failure, off-loopback 403.
 *
 * See change: generalize-worktree-init-hook.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import { registerGitRoutes } from "../routes/git-routes.js";
import { hookDefHash, type WorktreeInitHook } from "../worktree-init.js";
import { recordTrust } from "../worktree-init-trust.js";
import { resolveMainPath } from "../git-operations.js";

function git(cmd: string, cwd: string) {
  execSync(`git ${cmd}`, { cwd, stdio: ["pipe", "pipe", "pipe"] });
}

/** Repo with a declared worktreeInit hook. `command` defaults to a no-op. */
function makeHookRepo(hook: WorktreeInitHook): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "git-wt-init-")));
  git("-c init.defaultBranch=main init", dir);
  git("config user.email test@test.com", dir);
  git("config user.name Test", dir);
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(join(dir, ".pi", "settings.json"), JSON.stringify({ worktreeInit: hook }));
  writeFileSync(join(dir, "README.md"), "init");
  git("add .", dir);
  git("commit -m init", dir);
  return dir;
}

/** Plain repo: no `.pi/settings.json`. */
function makePlainRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "git-wt-plain-")));
  git("-c init.defaultBranch=main init", dir);
  git("config user.email test@test.com", dir);
  git("config user.name Test", dir);
  writeFileSync(join(dir, "README.md"), "init");
  git("add .", dir);
  git("commit -m init", dir);
  return dir;
}

async function makeApp(guard: (req: any, reply: any) => Promise<void> = async () => {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerGitRoutes(app, { networkGuard: guard });
  await app.ready();
  return app;
}

const scriptHook = (gate: string, command: string): WorktreeInitHook => ({ gate, run: { type: "script", command } });

describe("GET /api/git/worktree/init-status", () => {
  let app: FastifyInstance;
  let repo: string;
  beforeEach(async () => { app = await makeApp(); });
  afterEach(async () => { if (repo) rmSync(repo, { recursive: true, force: true }); await app.close(); });

  it("no hook → hasHook:false", async () => {
    repo = makePlainRepo();
    const res = await app.inject({ method: "GET", url: `/api/git/worktree/init-status?cwd=${encodeURIComponent(repo)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ hasHook: false });
  });

  it("untrusted hook → trusted:false, gate NOT run (no needsInit)", async () => {
    const hook = scriptHook("test ! -d node_modules", ":");
    repo = makeHookRepo(hook);
    const res = await app.inject({ method: "GET", url: `/api/git/worktree/init-status?cwd=${encodeURIComponent(repo)}` });
    const data = res.json().data;
    expect(data.hasHook).toBe(true);
    expect(data.trusted).toBe(false);
    expect(data.needsInit).toBeUndefined();
  });

  it("trusted hook, gate exits 0 → needsInit:true, trusted:true", async () => {
    const hook = scriptHook("test ! -d node_modules", ":");
    repo = makeHookRepo(hook);
    recordTrust(resolveMainPath(repo)!, hookDefHash(hook));
    const res = await app.inject({ method: "GET", url: `/api/git/worktree/init-status?cwd=${encodeURIComponent(repo)}` });
    const data = res.json().data;
    expect(data.trusted).toBe(true);
    expect(data.needsInit).toBe(true);
  });

  it("trusted hook, gate exits non-zero → needsInit:false", async () => {
    const hook = scriptHook("test ! -d node_modules", ":");
    repo = makeHookRepo(hook);
    recordTrust(resolveMainPath(repo)!, hookDefHash(hook));
    mkdirSync(join(repo, "node_modules"), { recursive: true });
    const res = await app.inject({ method: "GET", url: `/api/git/worktree/init-status?cwd=${encodeURIComponent(repo)}` });
    expect(res.json().data.needsInit).toBe(false);
  });
});

describe("POST /api/git/worktree/init", () => {
  let app: FastifyInstance;
  let repo: string;
  beforeEach(async () => { app = await makeApp(); });
  afterEach(async () => { if (repo) rmSync(repo, { recursive: true, force: true }); await app.close(); });

  it("no hook → ran:false skippedReason:no_hook", async () => {
    repo = makePlainRepo();
    const res = await app.inject({ method: "POST", url: "/api/git/worktree/init", payload: { cwd: repo } });
    expect(res.json().data).toEqual({ ran: false, skippedReason: "no_hook" });
  });

  it("untrusted hook → init_untrusted carrying hook + hash, no execution", async () => {
    const hook = scriptHook("test ! -d node_modules", "mkdir -p node_modules");
    repo = makeHookRepo(hook);
    const res = await app.inject({ method: "POST", url: "/api/git/worktree/init", payload: { cwd: repo } });
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe("init_untrusted");
    expect(body.data.hook).toEqual(hook);
    expect(body.data.hash).toBe(hookDefHash(hook));
  });

  it("confirm then run → script success ran:true", async () => {
    const hook = scriptHook("test ! -d node_modules", ":");
    repo = makeHookRepo(hook);
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/init",
      payload: { cwd: repo, confirmHash: hookDefHash(hook) },
    });
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.ran).toBe(true);
    expect(typeof body.data.durationMs).toBe("number");
  });

  it("trusted script failure → init_failed with stderr", async () => {
    const hook = scriptHook("test ! -d node_modules", "echo nope 1>&2; exit 4");
    repo = makeHookRepo(hook);
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/init",
      payload: { cwd: repo, confirmHash: hookDefHash(hook) },
    });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe("init_failed");
    expect(body.stderr).toContain("nope");
  });
});

describe("worktree-init endpoints — off-loopback", () => {
  it("init-status rejected by the network guard", async () => {
    const app = await makeApp(async (_req, reply) => { reply.code(403).send({ success: false, error: "blocked" }); });
    const res = await app.inject({ method: "GET", url: "/api/git/worktree/init-status?cwd=/x" });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
