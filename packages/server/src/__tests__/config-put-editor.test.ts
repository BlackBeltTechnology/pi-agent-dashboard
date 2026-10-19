/**
 * PUT /api/config accepts the `editor` section and applies it live
 * (test-plan #E19): stored, read back via GET, no restart, broadcast.
 *
 * See change: gate-changed-on-disk-by-content.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSystemRoutes } from "../routes/system-routes.js";

let testDir: string;
let configFile: string;
let origHome: string;
const broadcastToAll = vi.fn();

function makeApp(): FastifyInstance {
  const app = Fastify();
  (app as any)._reloadAuth = async () => {};
  registerSystemRoutes(app, {
    sessionManager: {} as never,
    preferencesStore: { flush: () => {} } as never,
    metaPersistence: { flushAll: () => {} } as never,
    config: { port: 8000, piPort: 9999, dev: false } as never,
    networkGuard: (async () => {}) as never,
    browserGateway: { broadcastToAll },
  } as never);
  return app;
}

beforeEach(() => {
  broadcastToAll.mockClear();
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-config-put-editor-"));
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

describe("PUT /api/config editor", () => {
  it("stores largeFileLimitMb, serves it on GET, needs no restart, broadcasts config_updated", async () => {
    const app = makeApp();
    const put = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { editor: { largeFileLimitMb: 64 } },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().restartRequired).toBeFalsy();
    expect(JSON.parse(fs.readFileSync(configFile, "utf-8")).editor.largeFileLimitMb).toBe(64);

    const get = await app.inject({ method: "GET", url: "/api/config", remoteAddress: "127.0.0.1" });
    expect(get.json().data.editor).toEqual({ largeFileLimitMb: 64 });

    expect(broadcastToAll).toHaveBeenCalledWith({ type: "config_updated", section: "editor" });
    await app.close();
  });

  it("does not broadcast `editor` for an unrelated write", async () => {
    const app = makeApp();
    await app.inject({ method: "PUT", url: "/api/config", payload: { completedFirst: true } });
    expect(broadcastToAll).not.toHaveBeenCalledWith({ type: "config_updated", section: "editor" });
    await app.close();
  });
});
