/**
 * `GET /api/folder/project` — status table, admission ordering, de-dup, no prompt.
 * Covers test-plan E20, E21, X1, X2, X3, P2 (L1).
 * See change: add-project-scoped-apps.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FolderProject } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import type { GitProbeRunner } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerFolderProjectRoutes } from "../folder-project-routes.js";

// Record every fs touch the resolver could make under a folder.
const touched = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock("node:fs/promises", async (orig) => {
  const real = await orig<typeof import("node:fs/promises")>();
  const wrap = <K extends "stat" | "lstat" | "open" | "opendir" | "readdir">(k: K): (typeof real)[K] =>
    ((p: string, ...rest: unknown[]) => {
      touched.paths.push(String(p));
      return (real[k] as (...a: unknown[]) => unknown)(p, ...rest);
    }) as never;
  return { ...real, stat: wrap("stat"), lstat: wrap("lstat"), open: wrap("open"), opendir: wrap("opendir"), readdir: wrap("readdir") };
});

const timeoutRunner: GitProbeRunner = async () => ({
  ok: false,
  error: { kind: "timeout", timeoutMs: 1000, binary: "git" },
});

const roots: string[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  touched.paths.length = 0;
});

function folder(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "folder-project-route-")));
  roots.push(root);
  return root;
}

function build(opts: {
  known?: string[];
  runner?: GitProbeRunner;
  resolve?: (cwd: string) => Promise<FolderProject>;
  onIndeterminate?: (info: unknown) => void;
}) {
  const app = Fastify();
  apps.push(app);
  const resolve = opts.resolve ? vi.fn(opts.resolve) : undefined;
  registerFolderProjectRoutes(app, {
    networkGuard: async () => {},
    knownCwds: () => opts.known ?? [],
    getRuleSources: () => [],
    admitOptions: { runner: opts.runner, onIndeterminate: opts.onIndeterminate },
    ...(resolve ? { resolve: (cwd: string) => resolve(cwd) } : {}),
  });
  return { app, resolve };
}

const get = (app: FastifyInstance, cwd?: string) =>
  app.inject({ method: "GET", url: cwd === undefined ? "/api/folder/project" : `/api/folder/project?cwd=${encodeURIComponent(cwd)}` });

describe("E20: endpoint status table", () => {
  it("400 for missing / relative cwd", async () => {
    const { app } = build({});
    expect((await get(app)).statusCode).toBe(400);
    expect((await get(app, "relative/x")).statusCode).toBe(400);
  });

  it("200 for a known cwd", async () => {
    const dir = folder();
    const { app } = build({ known: [dir] });
    const res = await get(app, dir);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: null, types: [], source: "none" });
  });

  it("200 reflects a declared identity", async () => {
    const dir = folder();
    mkdirSync(join(dir, ".pi", "dashboard"), { recursive: true });
    writeFileSync(join(dir, ".pi", "dashboard", "project.json"), JSON.stringify({ schemaVersion: 1, id: "acme-erp", type: "judo" }));
    const { app } = build({ known: [dir] });
    expect((await get(app, dir)).json()).toEqual({ id: "acme-erp", types: ["judo"], source: "declared" });
  });

  it("403 for an unknown folder the guard refuses", async () => {
    const dir = folder(); // plain non-repo folder → definitive refusal
    const { app } = build({});
    const res = await get(app, dir);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "cwd not allowed" });
  });

  it("503 + Retry-After + body when admission is indeterminate", async () => {
    const dir = folder();
    const { app } = build({ runner: timeoutRunner });
    const res = await get(app, dir);
    expect(res.statusCode).toBe(503);
    expect(res.headers["retry-after"]).toBe("1");
    expect(res.json()).toEqual({ error: "cwd-admission-unavailable", message: expect.any(String), retryAfterMs: 1000 });
  });

  it("404 for a known-but-deleted cwd", async () => {
    const dir = folder();
    const gone = join(dir, "gone");
    const { app } = build({ known: [gone] });
    expect((await get(app, gone)).statusCode).toBe(404);
  });
});

describe("E21: unknown-and-missing is 403, not 404", () => {
  it("never leaks existence of an unknown path", async () => {
    const { app } = build({});
    expect((await get(app, join(folder(), "nope"))).statusCode).toBe(403);
  });
});

describe("X1–X3: refused reads nothing, never prompts, logs indeterminate", () => {
  it("X1: a refused cwd performs no fs call under it", async () => {
    const dir = folder();
    const { app, resolve } = build({ resolve: async () => ({ id: null, types: [], source: "none" }) });
    touched.paths.length = 0;
    expect((await get(app, dir)).statusCode).toBe(403);
    expect(touched.paths.filter((p) => p.startsWith(dir))).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("X1: an indeterminate cwd performs no fs call under it either", async () => {
    const dir = folder();
    const { app } = build({ runner: timeoutRunner });
    touched.paths.length = 0;
    expect((await get(app, dir)).statusCode).toBe(503);
    expect(touched.paths.filter((p) => p.startsWith(dir))).toEqual([]);
  });

  it("X2: no access prompt seam exists on the route (deps carry no hold hook)", async () => {
    // The route's dep surface has no `holdCwdDenial`; an unknown cwd is a plain 403.
    const dir = folder();
    const { app } = build({});
    expect((await get(app, dir)).statusCode).toBe(403);
  });

  it("X3: an indeterminate admission answers 503 each time and reports each decision to the host logger", async () => {
    const dir = folder();
    const seen: unknown[] = [];
    const { app } = build({ runner: timeoutRunner, onIndeterminate: (i) => seen.push(i) });
    expect((await get(app, dir)).statusCode).toBe(503);
    expect((await get(app, dir)).statusCode).toBe(503);
    expect(seen).toHaveLength(2); // host logger (cwdAdmissionLogger) owns the 60 s throttle
  });
});

describe("P2: per-cwd de-dup", () => {
  it("10 simultaneous requests for one cwd run the resolver once", async () => {
    const dir = folder();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { app, resolve } = build({
      known: [dir],
      resolve: async () => {
        await gate;
        return { id: null, types: ["judo"], source: "detected" };
      },
    });
    const all = Promise.all(Array.from({ length: 10 }, () => get(app, dir)));
    await new Promise((r) => setTimeout(r, 100));
    release();
    const responses = await all;
    expect(responses.map((r) => r.statusCode)).toEqual(Array(10).fill(200));
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
