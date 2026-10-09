/**
 * Route-level coverage for the `sessionList` write path of `PUT /api/config`
 * (test-plan #E24, #E25): an invalid `sessionList` patch answers 400 and is
 * never persisted; a valid opt-out lands and reads back live.
 *
 * See change: archive-service-sessions-on-end.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-config-put-session-list-"));
  fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
  configFile = path.join(testDir, ".pi", "dashboard", "config.json");
  fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
  origHome = process.env.HOME!;
  process.env.HOME = testDir;
});

afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("PUT /api/config sessionList", () => {
  it("rejects a non-boolean archiveServiceSessionsOnEnd with 400 and persists nothing", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { sessionList: { archiveServiceSessionsOnEnd: "yes" } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("archiveServiceSessionsOnEnd");
    expect(JSON.parse(fs.readFileSync(configFile, "utf-8")).sessionList).toBeUndefined();
    await app.close();
  });

  it("persists archiveServiceSessionsOnEnd=false and reads it back live (no restart)", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { sessionList: { archiveServiceSessionsOnEnd: false } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().restartRequired).toBeFalsy();
    expect(loadConfig().sessionList.archiveServiceSessionsOnEnd).toBe(false);
    await app.close();
  });
});
