/**
 * Reveal / open-in-system launch the decided REAL path, and a link into a granted directory stays refused
 * (those gates keep `allowGrant:false`, so no opener is spawned).
 *
 * See change: close-local-listener-and-egress-gaps (D1, D2; test-plan #E145).
 */
import fsSync from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAccessGrants, recordGrant } from "../access/access-grants.js";
import { registerFileRoutes } from "../routes/file-routes.js";

const run = vi.fn();
const LOOPBACK = { origin: "http://localhost:8000" };

describe("T.42 reveal / open-in-system of a link", () => {
  let app: FastifyInstance;
  let base: string;
  let cwd: string;
  let granted: string;
  let savedStore: string | undefined;

  beforeEach(async () => {
    run.mockReset();
    base = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "reveal-link-")));
    cwd = path.join(base, "cwd");
    granted = path.join(base, "granted");
    await fsp.mkdir(cwd);
    await fsp.mkdir(granted);
    await fsp.writeFile(path.join(cwd, "target.txt"), "in");
    await fsp.writeFile(path.join(granted, "f.txt"), "out");
    fsSync.symlinkSync(path.join(cwd, "target.txt"), path.join(cwd, "l"));
    fsSync.symlinkSync(path.join(granted, "f.txt"), path.join(cwd, "l2"));
    savedStore = process.env.PI_ACCESS_GRANTS_STORE;
    process.env.PI_ACCESS_GRANTS_STORE = path.join(base, "grants.json");
    __resetAccessGrants();
    expect(recordGrant({ subject: granted, scope: "project", origin: "test" }).ok).toBe(true);
    app = Fastify({ logger: false });
    registerFileRoutes(app, {
      sessionManager: { listAll: () => [{ cwd }] } as never,
      preferencesStore: { getPinnedDirectories: () => [] } as never,
      networkGuard: async () => undefined,
      systemOpen: { capable: () => true, run, platform: "darwin" },
    } as never);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    __resetAccessGrants();
    if (savedStore === undefined) delete process.env.PI_ACCESS_GRANTS_STORE;
    else process.env.PI_ACCESS_GRANTS_STORE = savedStore;
    await fsp.rm(base, { recursive: true, force: true });
  });

  const post = (url: string, p: string) => app.inject({ method: "POST", url, headers: LOOPBACK, payload: { cwd, path: p } });

  it("reveal of an in-anchor link selects the link's real target", async () => {
    const res = await post("/api/reveal-in-file-manager", "l");
    expect(res.statusCode).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]).toEqual(["-R", path.join(cwd, "target.txt")]);
  });

  it("open-in-system of an in-anchor link launches the real target", async () => {
    const res = await post("/api/open-in-system", "l");
    expect(res.statusCode).toBe(200);
    expect(run.mock.calls[0][1]).toEqual([path.join(cwd, "target.txt")]);
  });

  it.each(["/api/reveal-in-file-manager", "/api/open-in-system"])("%s refuses a link into a granted directory: 403, no opener spawned", async (route) => {
    const res = await post(route, "l2");
    expect(res.statusCode).toBe(403);
    expect(run).not.toHaveBeenCalled();
    // The grant itself is real: the same path IS readable, so the refusal is `allowGrant:false`, not a missing grant.
    const read = await app.inject({ method: "GET", url: `/api/file?cwd=${encodeURIComponent(cwd)}&path=l2` });
    expect(read.statusCode).toBe(200);
  });
});
