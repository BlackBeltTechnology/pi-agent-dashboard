/**
 * `POST /api/browse/create-project` through the real route, tier gate and
 * network guard. See change: streamline-first-run (test-plan E8, E17, E18).
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerBearerAuth } from "../auth/bearer-auth.js";
import { createNetworkGuard } from "../auth/localhost-guard.js";
import { createRouteTierGate } from "../auth/route-tier-gate.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { registerFileRoutes } from "../routes/file-routes.js";

let tmp: string;
let home: string;
let app: FastifyInstance;
let tokens: { observe: string; control: string };
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

beforeEach(async () => {
  tmp = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "create-project-route-")));
  home = path.join(tmp, "home");
  await fsp.mkdir(home);
  process.env.HOME = home;
  process.env.USERPROFILE = home;

  const reg = new PairedDeviceRegistry(path.join(tmp, "paired.json"));
  tokens = {
    observe: reg.add("o", "manual", "observe").token,
    control: reg.add("c", "manual", "control").token,
  };
  app = Fastify({ logger: false });
  await app.register(rateLimit, { global: true, max: 100_000, timeWindow: "1 minute" });
  app.decorateRequest("isAuthenticated", false);
  registerBearerAuth(app, { registry: reg });
  app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => [], logRefusal: () => undefined }));
  registerFileRoutes(app, {
    sessionManager: { listAll: () => [] } as never,
    preferencesStore: { getPinnedDirectories: () => [] } as never,
    networkGuard: createNetworkGuard([]),
  });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  process.env.HOME = saved.HOME;
  process.env.USERPROFILE = saved.USERPROFILE;
  await fsp.rm(tmp, { recursive: true, force: true });
});

const post = (payload: unknown, opts: { remote?: string; token?: string } = {}) =>
  app.inject({
    method: "POST",
    url: "/api/browse/create-project",
    payload: payload as object,
    remoteAddress: opts.remote ?? "127.0.0.1",
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
  });

describe("POST /api/browse/create-project", () => {
  it("creates and returns the real path", async () => {
    const res = await post({ name: "demo" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      data: { path: path.join(home, "Projects", "demo"), existed: false },
    });
  });

  it("E8: non-string name → 400 invalid_name, no fs touched, logged as <non-string>", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    for (const body of [{}, { name: 42 }, { name: null }]) {
      const res = await post(body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ success: false, reason: "invalid_name" });
    }
    expect(await fsp.readdir(home)).toEqual([]);
    expect(log.mock.calls.some((c) => String(c[0]).includes("name=<non-string>"))).toBe(true);
  });

  it("maps reasons to statuses (409 for a file at the target)", async () => {
    await fsp.mkdir(path.join(home, "Projects"));
    await fsp.writeFile(path.join(home, "Projects", "demo"), "x");
    const res = await post({ name: "demo" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ success: false, reason: "not_a_directory" });
  });

  it("E17: a credential below control is rejected by the tier gate", async () => {
    const res = await post({ name: "demo" }, { remote: "203.0.113.5", token: tokens.observe });
    expect(res.statusCode).toBe(403);
    expect(await fsp.readdir(home)).toEqual([]);
  });

  it("E18: a request the network guard rejects creates nothing", async () => {
    const res = await post({ name: "demo" }, { remote: "203.0.113.5" });
    expect([401, 403]).toContain(res.statusCode);
    expect(await fsp.readdir(home)).toEqual([]);
  });

  it("a control credential passes the tier gate off-host with a valid token", async () => {
    const res = await post({ name: "demo" }, { remote: "203.0.113.5", token: tokens.control });
    expect(res.statusCode).toBe(200);
  });
});
