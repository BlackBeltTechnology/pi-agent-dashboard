/**
 * Tests for `POST /api/file/write` — the markdown write surface.
 * Covers the authorization branches (403 out-of-scope, 403 symlink escape),
 * optimistic concurrency (409 mtime mismatch leaves the file unchanged),
 * the success path (atomic write + new mtime), and the global-scope branch.
 *
 * See change: directory-settings-page-and-scoped-md-editing.
 */

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerFileRoutes } from "../routes/file-routes.js";

function makeApp(cwds: string[]): FastifyInstance {
  const app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: { listAll: () => cwds.map((cwd) => ({ cwd })) } as any,
    preferencesStore: { getPinnedDirectories: () => [] } as any,
    networkGuard: async () => undefined,
  });
  return app;
}

async function readMtime(p: string): Promise<number> {
  // Full-precision mtime token, matching the server's conflict check (no rounding).
  return (await fsp.stat(p)).mtimeMs;
}

async function write(app: FastifyInstance, body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/file/write", payload: body });
}

describe("POST /api/file/write — directory scope", () => {
  let app: FastifyInstance;
  let cwd: string;

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "fw-cwd-")));
    await fsp.writeFile(path.join(cwd, "AGENTS.md"), "# original\n", "utf-8");
    await fsp.writeFile(path.join(cwd, "notes.txt"), "x\n", "utf-8");
    app = makeApp([cwd]);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fsp.rm(cwd, { recursive: true, force: true });
  });

  it("writes an in-scope .md and returns the new mtime", async () => {
    const target = path.join(cwd, "AGENTS.md");
    const mtime = await readMtime(target);
    const res = await write(app, { cwd, path: target, content: "# edited\n", mtime });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.mtime).toBe("number");
    expect(await fsp.readFile(target, "utf-8")).toBe("# edited\n");
    expect(body.data.mtime).toBe(await readMtime(target));
  });

  it("rejects a non-markdown target with 403 and does not write", async () => {
    const target = path.join(cwd, "notes.txt");
    const res = await write(app, { cwd, path: target, content: "hacked", mtime: await readMtime(target) });
    expect(res.statusCode).toBe(403);
    expect(await fsp.readFile(target, "utf-8")).toBe("x\n");
  });

  it("rejects an out-of-scope path with 403", async () => {
    const res = await write(app, { cwd, path: "/etc/passwd", content: "x", mtime: 1 });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a symlink whose realpath escapes the cwd with 403", async () => {
    const outside = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "fw-out-")));
    try {
      const secret = path.join(outside, "secret.md");
      await fsp.writeFile(secret, "# secret\n");
      const link = path.join(cwd, "escape.md");
      await fsp.symlink(secret, link);
      const res = await write(app, { cwd, path: link, content: "# pwned\n", mtime: await readMtime(link) });
      expect(res.statusCode).toBe(403);
      expect(await fsp.readFile(secret, "utf-8")).toBe("# secret\n");
    } finally {
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });

  it("returns 409 on mtime mismatch and leaves the file unchanged", async () => {
    const target = path.join(cwd, "AGENTS.md");
    const staleMtime = (await readMtime(target)) - 5000;
    const res = await write(app, { cwd, path: target, content: "# clobbered\n", mtime: staleMtime });
    expect(res.statusCode).toBe(409);
    expect(await fsp.readFile(target, "utf-8")).toBe("# original\n");
  });

  it("rejects a write to an unregistered session cwd with 403", async () => {
    const res = await write(app, { cwd: "/nope", path: "/nope/x.md", content: "x", mtime: 1 });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("unknown session path");
  });
});

describe("POST /api/file/write — global scope", () => {
  let app: FastifyInstance;
  let home: string;
  let agentDir: string;
  let realHome: string | undefined;

  beforeEach(async () => {
    home = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "fw-home-")));
    agentDir = path.join(home, ".pi", "agent");
    await fsp.mkdir(agentDir, { recursive: true });
    await fsp.writeFile(path.join(agentDir, "MEMORY.md"), "# mem\n", "utf-8");
    await fsp.mkdir(path.join(home, "Documents"), { recursive: true });
    await fsp.writeFile(path.join(home, "Documents", "secret.md"), "# s\n", "utf-8");
    // Point the guard's default home (os.homedir → $HOME on POSIX) at the fake home.
    realHome = process.env.HOME;
    process.env.HOME = home;
    app = makeApp([]);
    await app.ready();
  });

  afterEach(async () => {
    if (realHome !== undefined) process.env.HOME = realHome;
    await app.close();
    await fsp.rm(home, { recursive: true, force: true });
  });

  it("writes a global-scope .md under ~/.pi/agent (no cwd)", async () => {
    const target = path.join(agentDir, "MEMORY.md");
    const mtime = await readMtime(target);
    const res = await write(app, { path: target, content: "# updated\n", mtime });
    expect(res.statusCode).toBe(200);
    expect(await fsp.readFile(target, "utf-8")).toBe("# updated\n");
  });

  it("rejects a global-scope path outside ~/.pi/agent with 403", async () => {
    const target = path.join(home, "Documents", "secret.md");
    const res = await write(app, { path: target, content: "# x\n", mtime: await readMtime(target) });
    expect(res.statusCode).toBe(403);
    expect(await fsp.readFile(target, "utf-8")).toBe("# s\n");
  });

  it("rejects a relative path in global scope with 400", async () => {
    const res = await write(app, { path: "MEMORY.md", content: "x", mtime: 1 });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/file/md-read", () => {
  let app: FastifyInstance;
  let cwd: string;
  let home: string;
  let agentDir: string;
  let realHome: string | undefined;

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "mr-cwd-")));
    await fsp.writeFile(path.join(cwd, "AGENTS.md"), "# agents\n", "utf-8");
    await fsp.writeFile(path.join(cwd, "notes.txt"), "x\n", "utf-8");
    home = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "mr-home-")));
    agentDir = path.join(home, ".pi", "agent");
    await fsp.mkdir(agentDir, { recursive: true });
    await fsp.writeFile(path.join(agentDir, "MEMORY.md"), "# mem\n", "utf-8");
    realHome = process.env.HOME;
    process.env.HOME = home;
    app = makeApp([cwd]);
    await app.ready();
  });

  afterEach(async () => {
    if (realHome !== undefined) process.env.HOME = realHome;
    await app.close();
    await fsp.rm(cwd, { recursive: true, force: true });
    await fsp.rm(home, { recursive: true, force: true });
  });

  it("reads an in-scope .md in directory scope with content + mtime", async () => {
    const target = path.join(cwd, "AGENTS.md");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/md-read?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(target)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.content).toBe("# agents\n");
    expect(body.data.mtime).toBe(await readMtime(target));
  });

  it("reads a global-scope .md under ~/.pi/agent (no cwd)", async () => {
    const target = path.join(agentDir, "MEMORY.md");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/md-read?path=${encodeURIComponent(target)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.content).toBe("# mem\n");
  });

  it("rejects a non-markdown target with 403", async () => {
    const target = path.join(cwd, "notes.txt");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/md-read?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(target)}`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a global path outside ~/.pi/agent with 403", async () => {
    const outside = path.join(home, "secret.md");
    await fsp.writeFile(outside, "# s\n");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/md-read?path=${encodeURIComponent(outside)}`,
    });
    expect(res.statusCode).toBe(403);
  });
});
