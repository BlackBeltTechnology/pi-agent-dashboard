/**
 * `PUT /api/config` carries `pairing.acceptLanRequests` (test-plan #E23):
 * a boolean applies live (next knock, no restart) and merges into the existing
 * `pairing` object; a non-boolean is refused with 400 and nothing is persisted.
 *
 * See change: add-lan-knock-pairing (design D14).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { liveAcceptLanRequests, resetConfigSnapshot } from "../config-snapshot.js";
import { registerSystemRoutes } from "../routes/system-routes.js";

let testDir: string;
let configFile: string;
let origHome: string;

function makeApp(): FastifyInstance {
  const app = Fastify();
  (app as any)._reloadAuth = async () => {};
  registerSystemRoutes(app, {
    sessionManager: {} as never,
    preferencesStore: { flush: () => {} } as never,
    metaPersistence: { flushAll: () => {} } as never,
    config: { port: 8000, piPort: 9999, dev: false } as never,
    networkGuard: (async () => {}) as never,
  } as never);
  return app;
}

const raw = () => JSON.parse(fs.readFileSync(configFile, "utf-8"));

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-config-put-pairing-"));
  fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
  configFile = path.join(testDir, ".pi", "dashboard", "config.json");
  fs.writeFileSync(configFile, JSON.stringify({ port: 8000, pairing: { publicBaseUrls: ["https://pi.example.com"] } }));
  origHome = process.env.HOME!;
  process.env.HOME = testDir;
  resetConfigSnapshot();
});

afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(testDir, { recursive: true, force: true });
  resetConfigSnapshot();
});

describe("#E23 PUT /api/config pairing.acceptLanRequests", () => {
  it("true applies to the next live read without a restart and keeps sibling pairing keys", async () => {
    const app = makeApp();
    expect(liveAcceptLanRequests()).toBe(false);
    const res = await app.inject({ method: "PUT", url: "/api/config", payload: { pairing: { acceptLanRequests: true } } });
    expect(res.statusCode).toBe(200);
    expect(res.json().restartRequired).toBeFalsy();
    expect(liveAcceptLanRequests()).toBe(true);
    expect(raw().pairing).toEqual({ publicBaseUrls: ["https://pi.example.com"], acceptLanRequests: true });
    await app.close();
  });

  it("turning it back off is live too", async () => {
    const app = makeApp();
    await app.inject({ method: "PUT", url: "/api/config", payload: { pairing: { acceptLanRequests: true } } });
    await app.inject({ method: "PUT", url: "/api/config", payload: { pairing: { acceptLanRequests: false } } });
    expect(liveAcceptLanRequests()).toBe(false);
    await app.close();
  });

  it("a non-boolean is 400 and persists nothing", async () => {
    const app = makeApp();
    const before = fs.readFileSync(configFile, "utf-8");
    const res = await app.inject({ method: "PUT", url: "/api/config", payload: { pairing: { acceptLanRequests: "yes" } } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("acceptLanRequests");
    expect(fs.readFileSync(configFile, "utf-8")).toBe(before);
    expect(liveAcceptLanRequests()).toBe(false);
    await app.close();
  });

  it("a pairing patch without acceptLanRequests (public URL edit) keeps the switch", async () => {
    const app = makeApp();
    await app.inject({ method: "PUT", url: "/api/config", payload: { pairing: { acceptLanRequests: true } } });
    await app.inject({ method: "PUT", url: "/api/config", payload: { pairing: { publicBaseUrls: ["https://b.example"] } } });
    expect(raw().pairing).toEqual({ publicBaseUrls: ["https://b.example"], acceptLanRequests: true });
    await app.close();
  });
});
