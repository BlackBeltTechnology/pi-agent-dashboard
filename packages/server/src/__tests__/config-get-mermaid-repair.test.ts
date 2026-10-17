/**
 * GET /api/config projects the resolved `mermaidRepair` block (test-plan #E6):
 * served via readConfigRedacted() with no credential-shaped keys.
 * See change: add-mermaid-ai-repair.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerSystemRoutes } from "../routes/system-routes.js";

let testDir: string;
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

function seed(config: Record<string, unknown>): void {
  fs.writeFileSync(path.join(testDir, ".pi", "dashboard", "config.json"), JSON.stringify(config));
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-config-get-mrepair-"));
  fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
  origHome = process.env.HOME!;
  process.env.HOME = testDir;
});

afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("GET /api/config mermaidRepair", () => {
  it("serves the resolved block with no credential-shaped keys", async () => {
    seed({ port: 8000, mermaidRepair: { enabled: true, model: "anthropic/m" } });
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/api/config", remoteAddress: "127.0.0.1" });
    expect(res.statusCode).toBe(200);
    const block = res.json().data.mermaidRepair;
    expect(block).toEqual({ enabled: true, model: "anthropic/m", maxChars: 20000, timeoutMs: 30000 });
    expect(Object.keys(block).some((k) => /key|token|secret/i.test(k))).toBe(false);
    await app.close();
  });

  it("serves disabledReason when enabled without a model", async () => {
    seed({ port: 8000, mermaidRepair: { enabled: true } });
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/api/config", remoteAddress: "127.0.0.1" });
    expect(res.json().data.mermaidRepair).toMatchObject({ enabled: false, disabledReason: "no_model" });
    await app.close();
  });
});
