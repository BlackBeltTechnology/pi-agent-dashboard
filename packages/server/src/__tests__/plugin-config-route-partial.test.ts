/**
 * `POST /api/config/plugins/:id` is a PARTIAL write: keys the body omits keep
 * their stored values.
 *
 * Bug: the route validated the body with Ajv `useDefaults`, which filled every
 * omitted key with its schema DEFAULT in place; the merge
 * `{ ...stored, ...body }` then overwrote stored values with those defaults
 * (a one-key write reset the chat gateway's allowedRoots/allowlist/admins).
 * See change: fix-plugin-config-partial-write.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-schema-"));
fs.writeFileSync(
  path.join(pkgDir, "schema.json"),
  JSON.stringify({
    type: "object",
    properties: {
      roots: { type: "array", items: { type: "string" }, default: [] },
      mode: { type: "string", default: "hidden" },
      flag: { type: "boolean", default: false },
      throttle: { type: "number", default: 1000 },
    },
  }),
);

vi.mock("@blackbelt-technology/dashboard-plugin-runtime/server", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    getPluginStatusStore: () => ({ getStatus: () => ({ enabled: true }) }),
    discoverPlugins: () => [{ manifest: { id: "p", configSchema: "schema.json" }, packageDir: pkgDir }],
  };
});

const { registerPluginConfigRoutes } = await import("../routes/plugin-config-routes.js");
const configFile = path.join(os.homedir(), ".pi", "dashboard", "config.json");

describe("POST /api/config/plugins/:id — partial write", () => {
  const app = Fastify();
  beforeAll(async () => {
    registerPluginConfigRoutes(app, {
      networkGuard: async () => {},
      broadcast: () => {},
    } as unknown as Parameters<typeof registerPluginConfigRoutes>[1]);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it("keeps stored values for keys the body omits (no default overwrite)", async () => {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(
      configFile,
      JSON.stringify({ plugins: { p: { roots: ["/a"], mode: "shown", flag: true, throttle: 1000 } } }),
    );
    const res = await app.inject({ method: "POST", url: "/api/config/plugins/p", payload: { throttle: 500 } });
    expect(res.statusCode).toBe(200);
    const stored = JSON.parse(fs.readFileSync(configFile, "utf8")).plugins.p;
    expect(stored).toEqual({ roots: ["/a"], mode: "shown", flag: true, throttle: 500 });
  });

  it("still fills defaults for keys that were never stored", async () => {
    fs.writeFileSync(configFile, JSON.stringify({ plugins: {} }));
    const res = await app.inject({ method: "POST", url: "/api/config/plugins/p", payload: { flag: true } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(fs.readFileSync(configFile, "utf8")).plugins.p).toEqual({
      roots: [],
      mode: "hidden",
      flag: true,
      throttle: 1000,
    });
  });

  it("still rejects a schema-invalid body", async () => {
    const res = await app.inject({ method: "POST", url: "/api/config/plugins/p", payload: { flag: "yes" } });
    expect(res.statusCode).toBe(400);
  });
});
