/**
 * Tests for `GET /api/git/worktree/bootstrap-status`.
 *
 * Spec scenarios (`git-operations-api` capability):
 *   - Non-bootstrap repo → `{ needsBootstrap: false, reason: "not_required" }`
 *   - Bootstrap repo with healthy node_modules → `{ ok }`
 *   - Bootstrap repo missing node_modules → `{ no_node_modules }`
 *   - Bootstrap repo with stale lockfile → `{ stale_lockfile }`
 *   - Localhost-only (off-loopback → 403)
 *
 * See change: harden-worktree-spawn.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { registerGitRoutes } from "../routes/git-routes.js";

const PASSTHRU_GUARD = async () => {};
const DENY_GUARD = async (_req: any, reply: any) => {
  reply.code(403).send({ success: false, error: "forbidden" });
};

function gitInit(dir: string): void {
  execSync("git init -q -b main", { cwd: dir });
  execSync("git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", { cwd: dir });
}

function writeFile(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

describe("GET /api/git/worktree/bootstrap-status", () => {
  let tmpRoot: string;
  let fastify: FastifyInstance;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-bootstrap-status-route-"));
    gitInit(tmpRoot);
  });

  afterEach(async () => {
    if (fastify) await fastify.close();
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
  });

  async function setup(opts: { networkGuard?: any } = {}) {
    fastify = Fastify();
    registerGitRoutes(fastify, { networkGuard: opts.networkGuard ?? PASSTHRU_GUARD });
    await fastify.ready();
  }

  it("non-bootstrap repo (no .pi/settings.json) → not_required", async () => {
    await setup();
    const res = await fastify.inject({
      method: "GET",
      url: `/api/git/worktree/bootstrap-status?cwd=${encodeURIComponent(tmpRoot)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ needsBootstrap: false, reason: "not_required" });
  });

  it("non-bootstrap repo with npm-only packages → not_required", async () => {
    writeFile(path.join(tmpRoot, ".pi", "settings.json"), JSON.stringify({
      packages: ["npm:pi-web-access"],
    }));
    await setup();
    const res = await fastify.inject({
      method: "GET",
      url: `/api/git/worktree/bootstrap-status?cwd=${encodeURIComponent(tmpRoot)}`,
    });
    expect(res.json().data).toEqual({ needsBootstrap: false, reason: "not_required" });
  });

  it("bootstrap repo with healthy node_modules → ok", async () => {
    writeFile(path.join(tmpRoot, ".pi", "settings.json"), JSON.stringify({
      packages: [{ source: "..", extensions: ["+packages/extension/src/bridge.ts"] }],
    }));
    writeFile(path.join(tmpRoot, "package-lock.json"), '{"lockfileVersion":3}');
    // node_modules with stamp, both fresh
    fs.mkdirSync(path.join(tmpRoot, "node_modules"), { recursive: true });
    writeFile(path.join(tmpRoot, "node_modules", ".package-lock.json"), '{}');
    // Make stamp newer than lockfile.
    const now = Date.now() / 1000;
    fs.utimesSync(path.join(tmpRoot, "package-lock.json"), now - 10, now - 10);
    fs.utimesSync(path.join(tmpRoot, "node_modules", ".package-lock.json"), now, now);

    await setup();
    const res = await fastify.inject({
      method: "GET",
      url: `/api/git/worktree/bootstrap-status?cwd=${encodeURIComponent(tmpRoot)}`,
    });
    expect(res.json().data).toEqual({ needsBootstrap: false, reason: "ok" });
  });

  it("bootstrap repo missing node_modules → no_node_modules", async () => {
    writeFile(path.join(tmpRoot, ".pi", "settings.json"), JSON.stringify({
      packages: [{ source: "..", extensions: ["+packages/extension/src/bridge.ts"] }],
    }));
    writeFile(path.join(tmpRoot, "package-lock.json"), '{"lockfileVersion":3}');

    await setup();
    const res = await fastify.inject({
      method: "GET",
      url: `/api/git/worktree/bootstrap-status?cwd=${encodeURIComponent(tmpRoot)}`,
    });
    expect(res.json().data).toEqual({ needsBootstrap: true, reason: "no_node_modules" });
  });

  it("bootstrap repo with empty node_modules dir → no_node_modules", async () => {
    writeFile(path.join(tmpRoot, ".pi", "settings.json"), JSON.stringify({
      packages: [{ source: "..", extensions: ["+packages/extension/src/bridge.ts"] }],
    }));
    writeFile(path.join(tmpRoot, "package-lock.json"), '{"lockfileVersion":3}');
    fs.mkdirSync(path.join(tmpRoot, "node_modules"), { recursive: true });

    await setup();
    const res = await fastify.inject({
      method: "GET",
      url: `/api/git/worktree/bootstrap-status?cwd=${encodeURIComponent(tmpRoot)}`,
    });
    expect(res.json().data).toEqual({ needsBootstrap: true, reason: "no_node_modules" });
  });

  it("bootstrap repo with stale lockfile → stale_lockfile", async () => {
    writeFile(path.join(tmpRoot, ".pi", "settings.json"), JSON.stringify({
      packages: [{ source: "..", extensions: ["+packages/extension/src/bridge.ts"] }],
    }));
    writeFile(path.join(tmpRoot, "package-lock.json"), '{"lockfileVersion":3}');
    fs.mkdirSync(path.join(tmpRoot, "node_modules"), { recursive: true });
    writeFile(path.join(tmpRoot, "node_modules", ".package-lock.json"), '{}');
    // Make lockfile newer than stamp.
    const now = Date.now() / 1000;
    fs.utimesSync(path.join(tmpRoot, "node_modules", ".package-lock.json"), now - 10, now - 10);
    fs.utimesSync(path.join(tmpRoot, "package-lock.json"), now, now);

    await setup();
    const res = await fastify.inject({
      method: "GET",
      url: `/api/git/worktree/bootstrap-status?cwd=${encodeURIComponent(tmpRoot)}`,
    });
    expect(res.json().data).toEqual({ needsBootstrap: true, reason: "stale_lockfile" });
  });

  it("off-loopback denied by network guard", async () => {
    writeFile(path.join(tmpRoot, ".pi", "settings.json"), JSON.stringify({
      packages: [{ source: "..", extensions: ["+packages/extension/src/bridge.ts"] }],
    }));
    await setup({ networkGuard: DENY_GUARD });
    const res = await fastify.inject({
      method: "GET",
      url: `/api/git/worktree/bootstrap-status?cwd=${encodeURIComponent(tmpRoot)}`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("missing cwd → 400 cwd_invalid", async () => {
    await setup();
    const res = await fastify.inject({
      method: "GET",
      url: "/api/git/worktree/bootstrap-status",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("cwd_invalid");
  });

  it("non-git cwd → not_a_repo", async () => {
    const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), "pi-not-a-repo-"));
    try {
      await setup();
      const res = await fastify.inject({
        method: "GET",
        url: `/api/git/worktree/bootstrap-status?cwd=${encodeURIComponent(nonGit)}`,
      });
      expect(res.json().code).toBe("not_a_repo");
    } finally {
      fs.rmSync(nonGit, { recursive: true, force: true });
    }
  });
});
