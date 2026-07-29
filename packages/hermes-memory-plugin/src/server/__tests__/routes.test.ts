/**
 * Route tests against a real (injected) Fastify instance (spec: all route
 * scenarios). GET returns the effective shape; PUT valid → 200 + file written;
 * PUT invalid → 400 + file unchanged.
 * See change: add-hermes-memory-settings-plugin.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerHermesRoutes } from "../index.js";

let dir: string;
let file: string;
let app: FastifyInstance;
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-routes-"));
  file = path.join(dir, "hermes-memory-config.json");
  app = Fastify();
  registerHermesRoutes(app, { logger: silentLogger, env: { PI_CODING_AGENT_DIR: dir } });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ROUTE = "/api/plugins/hermes-memory/config";

describe("GET config", () => {
  it("returns the effective shape (path, exists, fields, raw)", async () => {
    const res = await app.inject({ method: "GET", url: ROUTE });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.filePath).toBe(file);
    expect(body.exists).toBe(false);
    expect(body.fields.nudgeInterval).toEqual({ value: 10, default: 10, isDefault: true });
  });
});

describe("PUT config — valid", () => {
  it("writes the file and returns 200 with the saved value reflected", async () => {
    const res = await app.inject({
      method: "PUT",
      url: ROUTE,
      payload: { nudgeInterval: 5, reviewEnabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(file)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf-8")).nudgeInterval).toBe(5);
    expect(res.json().fields.nudgeInterval.value).toBe(5);
    expect(res.json().exists).toBe(true);
  });
});

describe("PUT config — invalid (400, no write)", () => {
  it("rejects an unknown key without writing", async () => {
    const res = await app.inject({ method: "PUT", url: ROUTE, payload: { bogusKey: 1 } });
    expect(res.statusCode).toBe(400);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("rejects a bad enum without writing", async () => {
    const res = await app.inject({ method: "PUT", url: ROUTE, payload: { memoryMode: "bogus" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].field).toBe("memoryMode");
    expect(fs.existsSync(file)).toBe(false);
  });

  it("rejects an uncompilable regex without writing", async () => {
    const res = await app.inject({
      method: "PUT",
      url: ROUTE,
      payload: { correctionStrongPatterns: ["(unbalanced"] },
    });
    expect(res.statusCode).toBe(400);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("does not overwrite an existing file on a rejected PUT", async () => {
    fs.writeFileSync(file, JSON.stringify({ nudgeInterval: 99 }));
    const res = await app.inject({ method: "PUT", url: ROUTE, payload: { memoryMode: "bogus" } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(fs.readFileSync(file, "utf-8")).nudgeInterval).toBe(99);
  });
});
