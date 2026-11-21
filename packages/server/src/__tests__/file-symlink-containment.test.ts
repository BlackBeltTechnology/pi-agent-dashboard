/**
 * Layer ① is anchored on REAL paths: an in-cwd link to a file outside the anchor is refused (and its
 * remedy names the real directory), an in-anchor link is admitted, a link into a granted directory is
 * admitted, and the system opener receives the decided real path.
 * See change: close-local-listener-and-egress-gaps (D1, D2).
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetAccessGrants, recordGrant } from "../access/access-grants.js";
import { registerFileRoutes } from "../routes/file-routes.js";
import { registerSessionRoutes } from "../routes/session-routes.js";

const MARKER = "TOP-SECRET-MARKER-9f2c";
const q = encodeURIComponent;

describe("symlink containment (real-path layer ①)", () => {
  let app: FastifyInstance;
  let cwd: string;
  let outside: string;
  let opened: string[][];
  let savedStore: string | undefined;

  beforeEach(async () => {
    const base = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "symlink-contain-")));
    cwd = path.join(base, "cwd");
    outside = path.join(base, "outside");
    await fsp.mkdir(cwd);
    await fsp.mkdir(outside);
    await fsp.writeFile(path.join(outside, "secret.txt"), MARKER);
    await fsp.writeFile(path.join(cwd, "inside.txt"), "inside\n");
    await fsp.symlink(path.join(outside, "secret.txt"), path.join(cwd, "link"));
    await fsp.symlink(outside, path.join(cwd, "dirlink"));
    await fsp.symlink(path.join(cwd, "inside.txt"), path.join(cwd, "inlink"));
    savedStore = process.env.PI_ACCESS_GRANTS_STORE;
    process.env.PI_ACCESS_GRANTS_STORE = path.join(base, "grants.json");
    __resetAccessGrants();
    opened = [];
    app = Fastify({ logger: false });
    const sessionManager = {
      listAll: () => [{ cwd }],
      get: (id: string) => (id === "s1" ? { id, cwd } : undefined),
    } as never;
    registerFileRoutes(app, {
      sessionManager,
      preferencesStore: { getPinnedDirectories: () => [] } as never,
      networkGuard: async () => undefined,
      systemOpen: { capable: () => true, run: (cmd: string, args: string[]) => void opened.push([cmd, ...args]) },
    } as never);
    registerSessionRoutes(app, { sessionManager, eventStore: {} as never, networkGuard: async () => undefined } as never);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    __resetAccessGrants();
    if (savedStore === undefined) delete process.env.PI_ACCESS_GRANTS_STORE;
    else process.env.PI_ACCESS_GRANTS_STORE = savedStore;
    await fsp.rm(path.dirname(cwd), { recursive: true, force: true });
  });

  const get = (route: string, p: string) => app.inject({ method: "GET", url: `${route}?cwd=${q(cwd)}&path=${q(p)}` });

  it("E1 an in-cwd link to an outside file is refused with a remedy naming the real directory", async () => {
    const res = await get("/api/file", "link");
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ success: false, error: "path outside working directory", subject: outside });
    expect(res.body).not.toContain(MARKER);
  });

  it("E2 a link through an intermediate directory link is refused on every read route", async () => {
    for (const route of ["/api/file", "/api/file/raw", "/api/file/digest"]) {
      const res = await get(route, "dirlink/secret.txt");
      expect(res.statusCode, route).toBe(403);
      expect(res.body, route).not.toContain(MARKER);
    }
  });

  it("an in-anchor link (link → file inside the cwd) is admitted", async () => {
    const res = await get("/api/file", "inlink");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.content).toBe("inside\n");
  });

  it("a link into a granted directory is admitted", async () => {
    expect(recordGrant({ subject: outside, scope: "project", origin: "test" }).ok).toBe(true);
    const res = await get("/api/file", "link");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.content).toBe(MARKER);
  });

  it("/api/session-file no longer takes a lexical in-cwd shortcut", async () => {
    const res = await app.inject({ method: "GET", url: `/api/session-file?sessionId=s1&path=${q(path.join(cwd, "link"))}` });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain(MARKER);
    const ok = await app.inject({ method: "GET", url: `/api/session-file?sessionId=s1&path=${q(path.join(cwd, "inside.txt"))}` });
    expect(ok.statusCode).toBe(200);
  });

  it("/api/open-in-system launches the decided real path, not the link", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/open-in-system",
      remoteAddress: "127.0.0.1",
      headers: { "content-type": "application/json", origin: "http://localhost:8000" },
      payload: JSON.stringify({ cwd, path: "inlink" }),
    });
    expect(res.statusCode).toBe(200);
    expect(opened[0]?.at(-1)).toBe(path.join(cwd, "inside.txt"));
  });

  it("T.13 a link to a sibling directory whose name starts with the cwd name is refused", async () => {
    const sibling = `${cwd}-x`;
    await fsp.mkdir(sibling);
    await fsp.writeFile(path.join(sibling, "s.txt"), MARKER);
    await fsp.symlink(path.join(sibling, "s.txt"), path.join(cwd, "sib"));
    const res = await get("/api/file", "sib");
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain(MARKER);
  });

  it("T.14 a multi-hop chain ending outside is refused; one staying inside is admitted", async () => {
    await fsp.symlink(path.join(outside, "secret.txt"), path.join(cwd, "l3"));
    await fsp.symlink(path.join(cwd, "l3"), path.join(cwd, "l2"));
    await fsp.symlink(path.join(cwd, "l2"), path.join(cwd, "l1"));
    expect((await get("/api/file", "l1")).statusCode).toBe(403);
    await fsp.symlink(path.join(cwd, "inside.txt"), path.join(cwd, "i3"));
    await fsp.symlink(path.join(cwd, "i3"), path.join(cwd, "i2"));
    expect((await get("/api/file", "i2")).statusCode).toBe(200);
  });

  it("T.34 a link loop (ELOOP) never serves bytes and never 500s", async () => {
    await fsp.symlink(path.join(cwd, "b"), path.join(cwd, "a"));
    await fsp.symlink(path.join(cwd, "a"), path.join(cwd, "b"));
    const res = await get("/api/file", "a");
    expect([403, 404]).toContain(res.statusCode);
  });

  it("T.35 a dangling link keeps the nearest-ancestor admission and the existing not-found mapping", async () => {
    await fsp.symlink(path.join(outside, "absent.txt"), path.join(cwd, "dangling"));
    const res = await get("/api/file", "dangling");
    expect(res.statusCode).toBe(404);
  });
});
