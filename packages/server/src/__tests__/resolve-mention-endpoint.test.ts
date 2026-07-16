/**
 * Route tests for `POST /api/file/resolve-mention` + the `~/.pi` anchor on the
 * open route `GET /api/file`.
 *
 * Security: the untrusted-`cwd` gate MUST reject before any resolution/stat
 * (design D2). The open route MUST honor the SAME `~/.pi` anchor the resolver
 * uses, so a resolved home path also previews (design D7). Fake `$HOME` keeps
 * `~/.pi` under a controlled tmp home. See change:
 * server-side-file-mention-resolution.
 */

import fsp from "node:fs/promises";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerFileRoutes } from "../routes/file-routes.js";

function makeApp(cwds: string[], pinned: string[] = []): FastifyInstance {
  const app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: { listAll: () => cwds.map((cwd) => ({ cwd })) } as any,
    preferencesStore: { getPinnedDirectories: () => pinned } as any,
    networkGuard: async () => undefined,
  });
  return app;
}

describe("POST /api/file/resolve-mention", () => {
  let app: FastifyInstance;
  let cwd: string;
  let home: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rme-cwd-")));
    home = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rme-home-")));
    origHome = process.env.HOME;
    process.env.HOME = home;
    await fsp.mkdir(path.join(home, ".pi", "agent"), { recursive: true });
    await fsp.writeFile(path.join(home, ".pi", "agent", "settings.json"), '{"a":1}\n');
    await fsp.writeFile(path.join(cwd, "real.ts"), "const x = 1;\n");
    app = makeApp([cwd]);
    await app.ready();
  });

  afterEach(async () => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    vi.restoreAllMocks();
    await app.close();
    await fsp.rm(cwd, { recursive: true, force: true });
    await fsp.rm(home, { recursive: true, force: true });
  });

  it("rejects an untrusted cwd with 403 and never stats (S1)", async () => {
    const statSpy = vi.spyOn(fs, "stat");
    const res = await app.inject({
      method: "POST",
      url: "/api/file/resolve-mention",
      payload: { cwd: "/etc", mention: "passwd" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "unknown session path" });
    expect(statSpy).not.toHaveBeenCalled();
  });

  it("resolves a real relative file under a known cwd", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/file/resolve-mention",
      payload: { cwd, mention: "real.ts" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      data: { resolved: path.join(cwd, "real.ts"), kind: "relative" },
    });
  });

  it("resolves a `~/.pi` home mention with kind tilde", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/file/resolve-mention",
      payload: { cwd, mention: "~/.pi/agent/settings.json" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      data: { resolved: path.join(home, ".pi", "agent", "settings.json"), kind: "tilde" },
    });
  });

  it("returns { resolved: null } for a junk mention (no error)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/file/resolve-mention",
      payload: { cwd, mention: "nope-does-not-exist.ts" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { resolved: null } });
  });
});

describe("GET /api/file — ~/.pi anchor honored by the open route", () => {
  let app: FastifyInstance;
  let cwd: string;
  let home: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rme-open-cwd-")));
    home = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rme-open-home-")));
    origHome = process.env.HOME;
    process.env.HOME = home;
    await fsp.mkdir(path.join(home, ".pi", "agent"), { recursive: true });
    await fsp.writeFile(path.join(home, ".pi", "agent", "settings.json"), '{"a":1}\n');
    await fsp.mkdir(path.join(home, ".ssh"), { recursive: true });
    await fsp.writeFile(path.join(home, ".ssh", "config"), "Host *\n");
    app = makeApp([cwd]);
    await app.ready();
  });

  afterEach(async () => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    await app.close();
    await fsp.rm(cwd, { recursive: true, force: true });
    await fsp.rm(home, { recursive: true, force: true });
  });

  it("reads a resolved `~/.pi/agent/settings.json` (200, S9)", async () => {
    const target = path.join(home, ".pi", "agent", "settings.json");
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(target)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ type: "file", content: '{"a":1}\n' });
  });

  it("rejects a `~/.ssh/config` read outside every anchor (403, S10)", async () => {
    const target = path.join(home, ".ssh", "config");
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(target)}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "path outside working directory" });
  });
});
