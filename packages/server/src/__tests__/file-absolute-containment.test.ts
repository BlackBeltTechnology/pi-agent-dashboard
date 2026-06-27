/**
 * Security tests for absolute / `file://` path containment on `/api/file`.
 * Absolute paths are accepted but MUST resolve under a known session cwd;
 * an absolute path outside every session cwd is rejected exactly as a
 * traversal attempt. See change: unify-file-link-openability.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { registerFileRoutes } from "../routes/file-routes.js";

const execFileAsync = promisify(execFile);
async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

function makeApp(cwds: string[], pinned: string[] = []): FastifyInstance {
  const app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: { listAll: () => cwds.map((cwd) => ({ cwd })) } as any,
    preferencesStore: { getPinnedDirectories: () => pinned } as any,
    networkGuard: async () => undefined,
  });
  return app;
}

describe("GET /api/file — absolute path containment", () => {
  let app: FastifyInstance;
  let tmp: string;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "file-abs-"));
    await fsp.writeFile(path.join(tmp, "foo.ts"), "const x = 1;\n", "utf-8");
    app = makeApp([tmp]);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("allows an absolute path resolving inside a known session cwd", async () => {
    const abs = path.join(tmp, "foo.ts");
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(tmp)}&path=${encodeURIComponent(abs)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ type: "file", content: "const x = 1;\n" });
  });

  it("allows a file:// URI resolving inside a known session cwd", async () => {
    const abs = path.join(tmp, "foo.ts");
    const uri = `file://${abs}`;
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(tmp)}&path=${encodeURIComponent(uri)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ type: "file", content: "const x = 1;\n" });
  });

  it("rejects an absolute path outside every session cwd (no content)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(tmp)}&path=${encodeURIComponent("/etc/passwd")}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside working directory" });
  });

  it("rejects a file:// URI pointing outside every session cwd", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(tmp)}&path=${encodeURIComponent("file:///etc/passwd")}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside working directory" });
  });

  it("rejects a file:// URI with percent-encoded traversal segments", async () => {
    // `file://` + encoded `../../etc/passwd` — decode + containment must both
    // run so an encoded escape cannot regress silently.
    const encoded = "file://%2e%2e%2f%2e%2e%2fetc%2fpasswd";
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(tmp)}&path=${encodeURIComponent(encoded)}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside working directory" });
  });

  it("behaves as cwd-only when cwd has no git (parent-tree read rejected)", async () => {
    // No git → layer ② no-ops; a parent-tree file stays rejected.
    const parentFile = path.join(path.dirname(tmp), "sibling.txt");
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(tmp)}&path=${encodeURIComponent(parentFile)}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside working directory" });
  });
});

describe("GET /api/file — git-root widening (worktree sessions)", () => {
  let app: FastifyInstance;
  let repo: string;
  let worktree: string;

  beforeEach(async () => {
    repo = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "file-wt-")));
    await git(repo, "init", "-q");
    await git(repo, "config", "user.email", "t@t.t");
    await git(repo, "config", "user.name", "t");
    await fsp.writeFile(path.join(repo, "root.txt"), "root-content\n");
    await git(repo, "add", ".");
    await git(repo, "commit", "-q", "-m", "init");
    worktree = path.join(repo, ".worktrees", "wt");
    await git(repo, "worktree", "add", "-q", worktree);
    // Only the worktree is a registered session cwd.
    app = makeApp([worktree]);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fsp.rm(repo, { recursive: true, force: true });
  });

  it("allows a worktree cwd reading a parent-root file (HTTP 200)", async () => {
    const target = path.join(repo, "root.txt");
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(worktree)}&path=${encodeURIComponent(target)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ type: "file", content: "root-content\n" });
  });

  it("rejects a symlink under the repo root whose real target escapes (HTTP 403)", async () => {
    const outside = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "file-out-")));
    try {
      await fsp.writeFile(path.join(outside, "secret.txt"), "secret\n");
      const link = path.join(repo, "escape");
      await fsp.symlink(outside, link);
      const target = path.join(link, "secret.txt");
      const res = await app.inject({
        method: "GET",
        url: `/api/file?cwd=${encodeURIComponent(worktree)}&path=${encodeURIComponent(target)}`,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ success: false, error: "path outside working directory" });
    } finally {
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });
});

describe("GET /api/file/exists — pinned-dir anchor + strings preserved", () => {
  let app: FastifyInstance;
  let cwd: string;
  let pinned: string;

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "file-ex-cwd-")));
    pinned = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "file-ex-pin-")));
    await fsp.writeFile(path.join(pinned, "here.txt"), "x\n");
    app = makeApp([cwd], [pinned]);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fsp.rm(cwd, { recursive: true, force: true });
    await fsp.rm(pinned, { recursive: true, force: true });
  });

  it("honors a pinned directory (existing file inside it → 200)", async () => {
    const probe = path.join(pinned, "here.txt");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/exists?cwd=${encodeURIComponent(pinned)}&path=${encodeURIComponent(probe)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { exists: true } });
  });

  it("keeps the 'unknown cwd' string for an unregistered cwd", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/file/exists?cwd=${encodeURIComponent("/nope")}&path=${encodeURIComponent("/nope/x")}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "unknown cwd" });
  });

  it("keeps the 'path outside cwd' string for an out-of-anchor probe", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/file/exists?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent("/etc/passwd")}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside cwd" });
  });

  it("rejects a relative probe (resolved against server cwd, not request cwd)", async () => {
    // A relative `path` must not be resolved against the server process cwd —
    // with git-root widening that could leak existence checks under the launch repo.
    const res = await app.inject({
      method: "GET",
      url: `/api/file/exists?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent("here.txt")}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside cwd" });
  });
});
