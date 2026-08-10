/**
 * L1 — the GET/PUT contract against a real (injected) Fastify instance
 * (test-plan E1-E4, E11-E14, E16, X2, X10).
 *
 * Every rejection assertion checks the FILE as well as the status code: a 4xx
 * that still wrote would satisfy a status-only test.
 *
 * See change: add-blackhole-plugin.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerBlackholeRoutes } from "../index.js";

let dir: string;
let file: string;
let app: FastifyInstance;
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "blackhole-routes-"));
  file = path.join(dir, "pi-blackhole", "pi-blackhole-config.json");
  app = Fastify();
  registerBlackholeRoutes(app, { logger: silentLogger, env: { PI_CODING_AGENT_DIR: dir } });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ROUTE = "/api/plugins/blackhole/config";

function seed(obj: Record<string, unknown>): Buffer {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf-8");
  return fs.readFileSync(file);
}

function put(payload: unknown) {
  return app.inject({ method: "PUT", url: ROUTE, payload: payload as object });
}

/** Assert a rejected request left the file's bytes untouched. */
async function expectRejected(payload: unknown, before: Buffer | null) {
  const res = await put(payload);
  expect(res.statusCode).toBeGreaterThanOrEqual(400);
  expect(res.statusCode).toBeLessThan(500);
  if (before === null) expect(fs.existsSync(file)).toBe(false);
  else expect(fs.readFileSync(file).equals(before)).toBe(true);
  return res;
}

describe("GET config", () => {
  it("returns the effective shape for an absent file and creates nothing (E16)", async () => {
    const res = await app.inject({ method: "GET", url: ROUTE });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.filePath).toBe(file);
    expect(body.exists).toBe(false);
    expect(body.fields.observeAfterTokens).toEqual({
      value: 15_000,
      default: 15_000,
      isDefault: true,
    });
    expect(fs.existsSync(file)).toBe(false);
  });

  it("reports the unmanaged keys present in the file", async () => {
    seed({ _comment: "hi", dropperPoolFullnessThreshold: 0.2, compaction: "manual" });
    const body = (await app.inject({ method: "GET", url: ROUTE })).json();
    expect(body.unmanagedKeys.sort()).toEqual(["_comment", "dropperPoolFullnessThreshold"]);
    expect(body.fields.compaction.value).toBe("manual");
  });

  it("returns a parse-error result with the parser message and no config (X1)", async () => {
    seed({});
    fs.writeFileSync(file, '{ "memory": true, }', "utf-8");
    const res = await app.inject({ method: "GET", url: ROUTE });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.status).toBe("parse-error");
    expect(typeof body.message).toBe("string");
    expect(body.fields).toBeUndefined();
  });
});

describe("PUT config — accepted", () => {
  it("writes observeAfterTokens 1 and echoes it back (E2)", async () => {
    const res = await put({ observeAfterTokens: 1 });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(fs.readFileSync(file, "utf-8")).observeAfterTokens).toBe(1);
    expect(res.json().fields.observeAfterTokens.value).toBe(1);
  });

  it("persists cooldownHours 0 as disabled rather than dropping it (E5)", async () => {
    const res = await put({ observerModel: { provider: "p", id: "m", cooldownHours: 0 } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(fs.readFileSync(file, "utf-8")).observerModel.cooldownHours).toBe(0);
  });

  it("accepts dropperPressureThreshold 1 (E8)", async () => {
    expect((await put({ dropperPressureThreshold: 1 })).statusCode).toBe(200);
    expect(JSON.parse(fs.readFileSync(file, "utf-8")).dropperPressureThreshold).toBe(1);
  });

  it("accepts compaction 'off' (E12)", async () => {
    expect((await put({ compaction: "off" })).statusCode).toBe(200);
  });

  it("reports which unmanaged keys it preserved and whether a race was seen", async () => {
    seed({ _comment: "keep", memory: true });
    const body = (await put({ memory: false })).json();
    expect(body.preservedUnmanagedKeys).toEqual(["_comment"]);
    expect(body.externalWriteDetected).toBe(false);
  });
});

describe("PUT config — rejected without writing", () => {
  it("rejects observeAfterTokens 0 and leaves the file untouched (E1)", async () => {
    const before = seed({ observeAfterTokens: 15_000 });
    await expectRejected({ observeAfterTokens: 0 }, before);
  });

  it("rejects observeAfterTokens -1 (E3)", async () => {
    const before = seed({ observeAfterTokens: 15_000 });
    await expectRejected({ observeAfterTokens: -1 }, before);
  });

  it("rejects observeAfterTokens 1.5 as non-integer (E4)", async () => {
    const before = seed({ observeAfterTokens: 15_000 });
    const res = await expectRejected({ observeAfterTokens: 1.5 }, before);
    expect(JSON.stringify(res.json())).toMatch(/integer/);
  });

  it("rejects model cooldownHours -1 (E6)", async () => {
    const before = seed({ memory: true });
    await expectRejected({ observerModel: { provider: "p", id: "m", cooldownHours: -1 } }, before);
  });

  it("rejects dropperPressureThreshold 0, 1.0001 and non-finite (E7, E9, E10)", async () => {
    const before = seed({ dropperPressureThreshold: 0.7 });
    await expectRejected({ dropperPressureThreshold: 0 }, before);
    await expectRejected({ dropperPressureThreshold: 1.0001 }, before);
    await expectRejected({ dropperPressureThreshold: null }, before);
  });

  it("rejects compaction 'sometimes' (E11)", async () => {
    const before = seed({ compaction: "auto" });
    await expectRejected({ compaction: "sometimes" }, before);
  });

  it("rejects an unknown key and never writes it (E13)", async () => {
    const before = seed({ memory: true });
    await expectRejected({ nonExistentKey: 1 }, before);
    expect(Object.hasOwn(JSON.parse(fs.readFileSync(file, "utf-8")), "nonExistentKey")).toBe(false);
  });

  it("writes NEITHER key when one is valid and one invalid (E14)", async () => {
    const before = seed({ compaction: "auto", agentMaxTurns: 16 });
    await expectRejected({ compaction: "off", agentMaxTurns: -3 }, before);
    const after = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(after.compaction).toBe("auto");
    expect(after.agentMaxTurns).toBe(16);
  });

  it("rejects a raw request that bypasses the client form entirely (X10)", async () => {
    const before = seed({ compaction: "auto" });
    await expectRejected({ compaction: "SOMETIMES" }, before);
    await expectRejected("compaction=off", before);
  });

  it("creates no file at all when the first request is invalid", async () => {
    await expectRejected({ observeAfterTokens: 0 }, null);
  });

  it("refuses to write while the file is unparseable and leaves the bytes intact (X2)", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ "memory": true, }', "utf-8");
    const before = fs.readFileSync(file);
    const res = await put({ memory: false });
    expect(res.statusCode).toBe(409);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });
});
