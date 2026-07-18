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

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveMainPath } from "../git-worktree/git-operations.js";
import { registerGitRoutes } from "../routes/git-routes.js";
import { hookDefHash, type WorktreeInitHook } from "../git-worktree/worktree-init.js";
import { createWorktreeInitRegistry } from "../git-worktree/worktree-init-registry.js";
import { recordTrust } from "../git-worktree/worktree-init-trust.js";

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

/** Non-git dir with a declared worktreeInit hook (no `git init`). */
function makeHookDir(hook: WorktreeInitHook): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "nongit-wt-init-")));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(join(dir, ".pi", "settings.json"), JSON.stringify({ worktreeInit: hook }));
  return dir;
}

/** Non-git dir with no `.pi/settings.json`. */
function makePlainDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "nongit-wt-plain-")));
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

/** Repo with `.pi/settings.json` but NO `worktreeInit` hook (state ③). */
function makeConfiguredNoHookRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "git-wt-nohook-")));
  git("-c init.defaultBranch=main init", dir);
  git("config user.email test@test.com", dir);
  git("config user.name Test", dir);
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(join(dir, ".pi", "settings.json"), JSON.stringify({ toolset: {} }));
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

  it("git repo, no .pi/settings.json → hasHook:false, configured:false (state ①)", async () => {
    repo = makePlainRepo();
    const res = await app.inject({ method: "GET", url: `/api/git/worktree/init-status?cwd=${encodeURIComponent(repo)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ hasHook: false, configured: false });
  });

  it("configured repo, no worktreeInit hook → hasHook:false, configured:true (state ③)", async () => {
    repo = makeConfiguredNoHookRepo();
    const res = await app.inject({ method: "GET", url: `/api/git/worktree/init-status?cwd=${encodeURIComponent(repo)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ hasHook: false, configured: true });
  });

  it("hasHook:true responses carry NO configured field", async () => {
    const hook = scriptHook("test ! -d node_modules", ":");
    repo = makeHookRepo(hook);
    recordTrust(resolveMainPath(repo)!, hookDefHash(hook));
    const res = await app.inject({ method: "GET", url: `/api/git/worktree/init-status?cwd=${encodeURIComponent(repo)}` });
    const data = res.json().data;
    expect(data.hasHook).toBe(true);
    expect("configured" in data).toBe(false);
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

// ── Trust scope on confirm (change: add-session-scoped-init-trust) ───────
function storeFile(): string {
  return join(getDashboardConfigDir(), "worktree-init-trust.json");
}
/** True iff SOME persisted trust key ends with the given hash. */
function diskHasHash(hash: string): boolean {
  const p = storeFile();
  if (!existsSync(p)) return false;
  const map = JSON.parse(readFileSync(p, "utf8")) as Record<string, true>;
  return Object.keys(map).some((k) => k.endsWith(`\u0000${hash}`));
}

describe("POST /api/git/worktree/init — trust scope", () => {
  let app: FastifyInstance;
  let repo: string;
  let dir: string;
  beforeEach(async () => { app = await makeApp(); rmSync(storeFile(), { force: true }); });
  afterEach(async () => {
    if (repo) rmSync(repo, { recursive: true, force: true });
    if (dir) rmSync(dir, { recursive: true, force: true });
    rmSync(storeFile(), { force: true });
    await app.close();
  });

  it("S8 unrecognized scope → bad_request, no trust recorded, hook NOT run", async () => {
    const hook = scriptHook("test ! -d node_modules", "touch RAN_MARKER");
    for (const scope of ["Session", "permanent", "", 5, null]) {
      repo = makeHookRepo(hook);
      const res = await app.inject({
        method: "POST",
        url: "/api/git/worktree/init",
        payload: { cwd: repo, confirmHash: hookDefHash(hook), scope },
      });
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.code).toBe("bad_request");
      expect(existsSync(join(repo, "RAN_MARKER"))).toBe(false); // runInitHook NOT called
      expect(diskHasHash(hookDefHash(hook))).toBe(false); // recordTrust NOT called
      rmSync(repo, { recursive: true, force: true });
    }
    repo = "";
  });

  it("S9 valid session confirm → runs, nothing persisted to disk", async () => {
    const hook = scriptHook("test ! -d node_modules", "touch RAN_MARKER");
    repo = makeHookRepo(hook);
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/init",
      payload: { cwd: repo, confirmHash: hookDefHash(hook), scope: "session" },
    });
    expect(res.json().data.ran).toBe(true);
    expect(existsSync(join(repo, "RAN_MARKER"))).toBe(true); // hook ran
    expect(diskHasHash(hookDefHash(hook))).toBe(false); // JSON store unchanged
  });

  it("S10 omitted scope confirm → runs + persisted (project default)", async () => {
    const hook = scriptHook("test ! -d node_modules", "touch RAN_MARKER");
    repo = makeHookRepo(hook);
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/init",
      payload: { cwd: repo, confirmHash: hookDefHash(hook) },
    });
    expect(res.json().data.ran).toBe(true);
    expect(existsSync(join(repo, "RAN_MARKER"))).toBe(true);
    expect(diskHasHash(hookDefHash(hook))).toBe(true); // persisted
  });

  it("S11 untrusted both stores, no confirmHash → init_untrusted, hook NOT run", async () => {
    const hook = scriptHook("test ! -d node_modules", "touch RAN_MARKER");
    repo = makeHookRepo(hook);
    const res = await app.inject({ method: "POST", url: "/api/git/worktree/init", payload: { cwd: repo } });
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe("init_untrusted");
    expect(body.data.hash).toBe(hookDefHash(hook));
    expect(existsSync(join(repo, "RAN_MARKER"))).toBe(false);
  });

  it("S12 session scope on external non-git dir → runs, disk unchanged", async () => {
    const hook = scriptHook("test ! -d node_modules", "touch RAN_MARKER");
    dir = realpathSync(mkdtempSync(join(tmpdir(), "nongit-scope-")));
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(join(dir, ".pi", "settings.json"), JSON.stringify({ worktreeInit: hook }));
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/init",
      payload: { cwd: dir, confirmHash: hookDefHash(hook), scope: "session" },
    });
    expect(res.json().data.ran).toBe(true);
    expect(existsSync(join(dir, "RAN_MARKER"))).toBe(true);
    expect(diskHasHash(hookDefHash(hook))).toBe(false);
  });

  it("S13 auto-init cannot bypass — untrusted + no confirm never runs", async () => {
    // The POST /init route grants trust ONLY via confirmHash===hash. It reads no
    // "auto" flag, so an auto-on-spawn path (which carries no confirm) hits the
    // same TOFU gate and cannot forge trust.
    const hook = scriptHook("test ! -d node_modules", "touch RAN_MARKER");
    repo = makeHookRepo(hook);
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/init",
      payload: { cwd: repo, requestId: "auto-spawn" },
    });
    expect(res.json().code).toBe("init_untrusted");
    expect(existsSync(join(repo, "RAN_MARKER"))).toBe(false);
    expect(diskHasHash(hookDefHash(hook))).toBe(false);
  });
});

// ── Non-git directories (change: support-non-git-init-hook) ─────────────
// A configured non-git dir (`.pi/settings.json#worktreeInit`) is now read via
// `resolveConfigRoot`, so init-status / init report the hook instead of
// `not_a_repo`. TOFU still gates execution.
describe("non-git dir — GET /api/git/worktree/init-status", () => {
  let app: FastifyInstance;
  let dir: string;
  beforeEach(async () => { app = await makeApp(); });
  afterEach(async () => { if (dir) rmSync(dir, { recursive: true, force: true }); await app.close(); });

  it("valid worktreeInit, untrusted → hasHook:true trusted:false, NOT not_a_repo", async () => {
    dir = makeHookDir(scriptHook("test ! -d node_modules", ":"));
    const res = await app.inject({ method: "GET", url: `/api/git/worktree/init-status?cwd=${encodeURIComponent(dir)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.code).toBeUndefined();
    expect(body.data).toEqual({ hasHook: true, trusted: false });
  });

  it("no .pi/settings.json → hasHook:false configured:false success, NOT not_a_repo", async () => {
    dir = makePlainDir();
    const res = await app.inject({ method: "GET", url: `/api/git/worktree/init-status?cwd=${encodeURIComponent(dir)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.code).toBeUndefined();
    expect(body.data).toEqual({ hasHook: false, configured: false });
  });

  it("trusted hook → gate evaluated → needsInit + trusted:true", async () => {
    const hook = scriptHook("test ! -d node_modules", ":");
    dir = makeHookDir(hook);
    recordTrust(dir, hookDefHash(hook));
    const res = await app.inject({ method: "GET", url: `/api/git/worktree/init-status?cwd=${encodeURIComponent(dir)}` });
    const data = res.json().data;
    expect(data.trusted).toBe(true);
    expect(data.needsInit).toBe(true);
  });
});

describe("non-git dir — POST /api/git/worktree/init", () => {
  let app: FastifyInstance;
  let dir: string;
  beforeEach(async () => { app = await makeApp(); });
  afterEach(async () => { if (dir) rmSync(dir, { recursive: true, force: true }); await app.close(); });

  it("untrusted → init_untrusted, no execution (marker not written)", async () => {
    const hook = scriptHook("test ! -d node_modules", "touch RAN_MARKER");
    dir = makeHookDir(hook);
    const res = await app.inject({ method: "POST", url: "/api/git/worktree/init", payload: { cwd: dir } });
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe("init_untrusted");
    expect(body.data.hook).toEqual(hook);
    expect(body.data.hash).toBe(hookDefHash(hook));
    expect(existsSync(join(dir, "RAN_MARKER"))).toBe(false);
  });

  it("no .pi/settings.json → ran:false skippedReason:no_hook, NOT not_a_repo", async () => {
    dir = makePlainDir();
    const res = await app.inject({ method: "POST", url: "/api/git/worktree/init", payload: { cwd: dir } });
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.code).toBeUndefined();
    expect(body.data).toEqual({ ran: false, skippedReason: "no_hook" });
  });

  it("confirm then run → trusted hook executes (marker written), ran:true", async () => {
    const hook = scriptHook("test ! -d node_modules", "touch RAN_MARKER");
    dir = makeHookDir(hook);
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree/init",
      payload: { cwd: dir, confirmHash: hookDefHash(hook) },
    });
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.ran).toBe(true);
    expect(existsSync(join(dir, "RAN_MARKER"))).toBe(true);
  });
});

// ── active-inits endpoint (change: friendlier-worktree-init) ──────────
describe("GET /api/git/worktree/active-inits", () => {
  async function makeAppWithRegistry(registry: ReturnType<typeof createWorktreeInitRegistry>) {
    const app = Fastify({ logger: false });
    registerGitRoutes(app, { networkGuard: async () => {}, worktreeInitRegistry: registry });
    await app.ready();
    return app;
  }

  it("empty when no registry is wired", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/git/worktree/active-inits" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ runs: [] });
    await app.close();
  });

  it("reflects a running run", async () => {
    const reg = createWorktreeInitRegistry();
    reg.startRun("/w/a", 1000);
    const app = await makeAppWithRegistry(reg);
    const res = await app.inject({ method: "GET", url: "/api/git/worktree/active-inits" });
    expect(res.json().data.runs).toEqual([{ cwd: "/w/a", phase: "running", startedAt: 1000 }]);
    await app.close();
  });

  it("reflects a terminal run within TTL", async () => {
    const reg = createWorktreeInitRegistry();
    reg.startRun("/w/b");
    reg.finishRun("/w/b", "failed", "script_nonzero_exit");
    const app = await makeAppWithRegistry(reg);
    const res = await app.inject({ method: "GET", url: "/api/git/worktree/active-inits" });
    expect(res.json().data.runs[0]).toEqual(
      expect.objectContaining({ cwd: "/w/b", phase: "failed", code: "script_nonzero_exit" }),
    );
    await app.close();
  });

  it("POST /init registers a terminal entry visible via active-inits", async () => {
    const reg = createWorktreeInitRegistry();
    const app = await makeAppWithRegistry(reg);
    const hook = scriptHook("test ! -d node_modules", ":");
    repo = makeHookRepo(hook);
    await app.inject({
      method: "POST",
      url: "/api/git/worktree/init",
      payload: { cwd: repo, confirmHash: hookDefHash(hook) },
    });
    const res = await app.inject({ method: "GET", url: "/api/git/worktree/active-inits" });
    const run = res.json().data.runs.find((r: { cwd: string }) => r.cwd === repo);
    expect(run?.phase).toBe("done");
    await app.close();
  });

  let repo: string;
  afterEach(() => { if (repo) rmSync(repo, { recursive: true, force: true }); });
});

describe("worktree-init endpoints — off-loopback", () => {
  it("init-status rejected by the network guard", async () => {
    const app = await makeApp(async (_req, reply) => { reply.code(403).send({ success: false, error: "blocked" }); });
    const res = await app.inject({ method: "GET", url: "/api/git/worktree/init-status?cwd=/x" });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
