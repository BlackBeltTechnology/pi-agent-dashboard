/**
 * `/api/browse`, `/api/browse/flags`, `/api/browse/mkdir` are confined to
 * `$HOME` + pinned dirs. See change: harden-server-capability-bounds (T2, T3).
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerFileRoutes } from "../routes/file-routes.js";

let tmp: string;
let home: string;
let pinned: string;
let outside: string;
let app: FastifyInstance;
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

beforeEach(async () => {
  tmp = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "browse-confine-")));
  home = path.join(tmp, "home");
  pinned = path.join(tmp, "pinned");
  outside = path.join(tmp, "outside");
  await Promise.all([home, pinned, outside].map((d) => fsp.mkdir(d)));
  await fsp.mkdir(path.join(home, "workspace"));
  await fsp.mkdir(path.join(pinned, "repo"));
  await fsp.mkdir(path.join(outside, "secret"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;

  app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: { listAll: () => [] } as never,
    preferencesStore: { getPinnedDirectories: () => [pinned] } as never,
    networkGuard: async () => undefined,
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  process.env.HOME = saved.HOME;
  process.env.USERPROFILE = saved.USERPROFILE;
  await fsp.rm(tmp, { recursive: true, force: true });
});

const browse = (p?: string) =>
  app.inject({ method: "GET", url: p === undefined ? "/api/browse" : `/api/browse?path=${encodeURIComponent(p)}` });
const mkdir = (parent: string, name: string) =>
  app.inject({ method: "POST", url: "/api/browse/mkdir", payload: { parent, name } });
const flags = (paths: string[]) =>
  app.inject({ method: "GET", url: `/api/browse/flags?paths=${encodeURIComponent(JSON.stringify(paths))}` });

describe("GET /api/browse confinement", () => {
  it("rejects the filesystem root", async () => {
    const res = await browse(path.parse(tmp).root);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ success: false, error: "path outside allowed roots" });
  });

  it("rejects a directory outside home and pinned", async () => {
    expect((await browse(outside)).statusCode).toBe(403);
  });

  it("rejects `..` traversal out of home", async () => {
    expect((await browse(path.join(home, "..", "outside"))).statusCode).toBe(403);
  });

  it("rejects a symlink in home that points outside", async () => {
    await fsp.symlink(outside, path.join(home, "escape"));
    expect((await browse(path.join(home, "escape"))).statusCode).toBe(403);
  });

  it("defaults to home when no path is given (folder-picker open)", async () => {
    const res = await browse();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.current).toBe(home);
    expect(res.json().data.entries.map((e: { name: string }) => e.name)).toContain("workspace");
  });

  it("lists a directory under home and one under a pinned dir", async () => {
    expect((await browse(path.join(home, "workspace"))).statusCode).toBe(200);
    const res = await browse(pinned);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.entries.map((e: { name: string }) => e.name)).toContain("repo");
  });

  it("nulls `parent` when the parent would leave the allowed roots", async () => {
    // home's parent (tmp) is outside the roots → no `..` row to a refused place
    expect((await browse(home)).json().data.parent).toBeNull();
    expect((await browse(pinned)).json().data.parent).toBeNull();
    // a child's parent stays inside
    expect((await browse(path.join(home, "workspace"))).json().data.parent).toBe(home);
  });
});

describe("GET /api/browse/flags confinement", () => {
  it("rejects when any path is outside the roots", async () => {
    const res = await flags([path.join(home, "workspace"), outside]);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("path outside allowed roots");
  });

  it("classifies paths inside the roots", async () => {
    const res = await flags([path.join(home, "workspace"), path.join(pinned, "repo")]);
    expect(res.statusCode).toBe(200);
  });
});

describe("POST /api/browse/mkdir confinement", () => {
  it("rejects a parent outside the roots and creates nothing", async () => {
    const res = await mkdir(outside, "pwned");
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("path outside allowed roots");
    await expect(fsp.stat(path.join(outside, "pwned"))).rejects.toThrow();
  });

  it("rejects a symlinked parent that escapes home and creates nothing", async () => {
    await fsp.symlink(outside, path.join(home, "escape"));
    const res = await mkdir(path.join(home, "escape"), "pwned");
    expect(res.statusCode).toBe(403);
    await expect(fsp.stat(path.join(outside, "pwned"))).rejects.toThrow();
  });

  it("creates inside home and inside a pinned dir", async () => {
    const a = await mkdir(path.join(home, "workspace"), "new-a");
    expect(a.statusCode).toBe(200);
    expect((await fsp.stat(path.join(home, "workspace", "new-a"))).isDirectory()).toBe(true);
    const b = await mkdir(pinned, "new-b");
    expect(b.statusCode).toBe(200);
  });
});
