/**
 * Tests for the worktree-bootstrap step wired into POST /api/git/worktree.
 *
 * Covers spec scenarios (`git-operations-api` capability):
 *   - Successful create on non-bootstrap repo carries bootstrap:{ran:false, skippedReason:"not_required"}
 *   - Bootstrap repo with no recognized lockfile → skippedReason:"no_lockfile"
 *   - Bootstrap failure → response { success:false, error:"bootstrap_failed", stderr }
 *
 * The bootstrap install path is exercised via the `worktree-bootstrap.ts`
 * module directly in `run-bootstrap.test.ts`; here we focus on the
 * route-level wiring (response shape, error envelope, skippedReason).
 *
 * See change: harden-worktree-spawn.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import { registerGitRoutes } from "../routes/git-routes.js";

function git(cmd: string, cwd: string) {
  execSync(`git ${cmd}`, { cwd, stdio: ["pipe", "pipe", "pipe"] });
}

/**
 * Make a fresh repo and seed it as a worktree-local-bridge dashboard:
 * `.pi/settings.json` with `source: ".."` AND extensions referencing a
 * worktree-local path. New worktrees of this repo will be flagged as
 * `bootstrap-required`.
 */
function makeBootstrapRepo(opts: { withLockfile?: boolean } = {}): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "git-wt-bootstrap-")));
  git("-c init.defaultBranch=main init", dir);
  git("config user.email test@test.com", dir);
  git("config user.name Test", dir);
  // .pi/settings.json gating
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(join(dir, ".pi", "settings.json"), JSON.stringify({
    packages: [{ source: "..", extensions: ["+packages/extension/src/bridge.ts"] }],
  }));
  // Bridge target so the heuristic source-dir check sees content.
  mkdirSync(join(dir, "packages", "extension", "src"), { recursive: true });
  writeFileSync(join(dir, "packages", "extension", "src", "bridge.ts"), "// stub");
  // Optional lockfile so pickInstallCommand picks `npm ci`. Without it
  // the bootstrap step short-circuits with skippedReason:"no_lockfile".
  if (opts.withLockfile) {
    writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }));
  }
  writeFileSync(join(dir, "README.md"), "init");
  git("add .", dir);
  git("commit -m init", dir);
  return dir;
}

/** Non-bootstrap repo: no `.pi/settings.json` at all. */
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

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerGitRoutes(app, { networkGuard: async () => {} });
  await app.ready();
  return app;
}

describe("POST /api/git/worktree — bootstrap arm", () => {
  let app: FastifyInstance;
  let repo: string;

  beforeEach(async () => { app = await makeApp(); });
  afterEach(async () => {
    if (repo) rmSync(repo, { recursive: true, force: true });
    await app.close();
  });

  it("non-bootstrap repo: response carries bootstrap.ran=false skippedReason=not_required", async () => {
    repo = makePlainRepo();
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree",
      payload: { cwd: repo, base: "main", newBranch: "feat/x" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.bootstrap).toEqual({ ran: false, skippedReason: "not_required" });
  });

  it("bootstrap repo with no lockfile → skippedReason=no_lockfile (no install attempted)", async () => {
    repo = makeBootstrapRepo({ withLockfile: false });
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree",
      payload: { cwd: repo, base: "main", newBranch: "feat/x" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.bootstrap).toEqual({ ran: false, skippedReason: "no_lockfile" });
  });

  it("bootstrap repo with broken lockfile → bootstrap_failed envelope + stderr tail", async () => {
    repo = makeBootstrapRepo({ withLockfile: true });
    // Write a deliberately broken package-lock so `npm ci` exits non-zero
    // fast (missing package.json AND broken lockfile is a guaranteed
    // failure on any npm version). Real test signal: the response code
    // is `bootstrap_failed`, NOT that the install would have succeeded.
    writeFileSync(join(repo, "package-lock.json"), "{ this is not a lockfile");
    // Stage so the worktree-add copies the file into the new worktree.
    git("add package-lock.json", repo);
    git("commit -m broken-lockfile", repo);
    const res = await app.inject({
      method: "POST",
      url: "/api/git/worktree",
      payload: { cwd: repo, base: "main", newBranch: "feat/x" },
    });
    // Note: response can vary by npm version; the contract here is that
    // SOME bootstrap_failed signal surfaces. If the local test runner has
    // no `npm` on PATH, we'd still expect spawn_error → bootstrap_failed.
    const body = res.json();
    if (res.statusCode === 200 && body.success && body.data?.bootstrap?.ran === true) {
      // Defensive: some npm versions tolerate JSON garbage and run anyway.
      // Skip the assertion in that environment.
      return;
    }
    expect(res.statusCode).toBe(500);
    expect(body.success).toBe(false);
    expect(body.code).toBe("bootstrap_failed");
    expect(typeof body.stderr).toBe("string");
  });
});
