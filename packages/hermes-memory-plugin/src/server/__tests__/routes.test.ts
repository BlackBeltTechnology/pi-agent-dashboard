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
import { legacyFile, noTouchBody } from "../../__tests__/hermes-fixtures.js";
import { buildResolvedConfig } from "../../client/settings-model.js";
import { readEffectiveConfig } from "../config-io.js";
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

// ── resync-hermes-memory-config-0-9 ───────────────────────────────────────────

const put = (payload: unknown) => app.inject({ method: "PUT", url: ROUTE, payload: payload as Record<string, unknown> });
const onDisk = () => JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
const seed = (obj: unknown) => fs.writeFileSync(file, JSON.stringify(obj));

describe("E12 PUT preserves unknown on-disk keys", () => {
  it("keeps futureHermesKey and nested deep-equal", async () => {
    seed({ futureHermesKey: 42, nested: { x: [1, 2] } });
    const res = await put({ nudgeInterval: 3 });
    expect(res.statusCode).toBe(200);
    expect(onDisk()).toEqual({ futureHermesKey: 42, nested: { x: [1, 2] }, nudgeInterval: 3 });
  });
});

describe("E13 a cleared known key is not resurrected from disk", () => {
  it("body without llmModelOverride drops it; unknown key kept; GET reads default", async () => {
    seed({ llmModelOverride: "a/b", futureHermesKey: 42 });
    expect((await put({ nudgeInterval: 3 })).statusCode).toBe(200);
    expect(Object.hasOwn(onDisk(), "llmModelOverride")).toBe(false);
    expect(onDisk().futureHermesKey).toBe(42);
    const get = await app.inject({ method: "GET", url: ROUTE });
    expect(get.json().fields.llmModelOverride.isDefault).toBe(true);
  });
});

describe("E14 default-valued fields are omitted", () => {
  it("defaults-only body + nudgeInterval:10 + llmFallbackModels:[] → only the strategy is written", async () => {
    const body = { ...buildResolvedConfig({}, new Set()), nudgeInterval: 10, llmFallbackModels: [] };
    expect((await put(body)).statusCode).toBe(200);
    expect(onDisk()).toEqual({ memoryOverflowStrategy: "auto-consolidate" });
    const { fields } = (await app.inject({ method: "GET", url: ROUTE })).json();
    for (const [key, view] of Object.entries(fields as Record<string, { isDefault: boolean }>)) {
      expect(view.isDefault, key).toBe(key !== "memoryOverflowStrategy");
    }
  });
});

describe("E15 the strategy is always written (authoritative over autoConsolidate)", () => {
  it("keeps the default strategy next to a non-default autoConsolidate", async () => {
    expect((await put({ memoryOverflowStrategy: "auto-consolidate", autoConsolidate: false })).statusCode).toBe(200);
    expect(onDisk()).toEqual({ memoryOverflowStrategy: "auto-consolidate", autoConsolidate: false });
  });
});

describe("E16 legacy consolidationTimeoutMs heal fires once", () => {
  it("heals on the first no-touch save, then a deliberate 60000 sticks", async () => {
    seed(legacyFile({ futureHermesKey: 1 }));
    // (1) the client's no-touch body
    expect((await put(noTouchBody(readEffectiveConfig(file)))).statusCode).toBe(200);
    const after1 = onDisk();
    expect(Object.hasOwn(after1, "consolidationTimeoutMs")).toBe(false);
    expect(after1).toEqual({ futureHermesKey: 1, memoryOverflowStrategy: "auto-consolidate" });
    // (2)
    let fields = (await app.inject({ method: "GET", url: ROUTE })).json().fields;
    expect(fields.consolidationTimeoutMs).toEqual({ value: 180000, default: 180000, isDefault: true });
    // (3) the user now sets 60000 deliberately — the legacy signature is gone
    expect((await put({ ...noTouchBody(readEffectiveConfig(file)), consolidationTimeoutMs: 60000 })).statusCode).toBe(200);
    expect(onDisk().consolidationTimeoutMs).toBe(60000);
    // (4)
    fields = (await app.inject({ method: "GET", url: ROUTE })).json().fields;
    expect(fields.consolidationTimeoutMs).toMatchObject({ value: 60000, isDefault: false });
  });
});

describe("E17 heal guards", () => {
  it("(a) legacy file 90000, body 60000 → the user's edit is kept", async () => {
    seed(legacyFile({ consolidationTimeoutMs: 90000 }));
    await put({ consolidationTimeoutMs: 60000 });
    expect(onDisk().consolidationTimeoutMs).toBe(60000);
  });
  it("(b) legacy file 60000, body 120000 → 120000", async () => {
    seed(legacyFile());
    await put({ consolidationTimeoutMs: 120000 });
    expect(onDisk().consolidationTimeoutMs).toBe(120000);
  });
  it("(c) non-legacy file 60000, body 60000 → no heal", async () => {
    seed({ consolidationTimeoutMs: 60000 });
    await put({ consolidationTimeoutMs: 60000 });
    expect(onDisk().consolidationTimeoutMs).toBe(60000);
  });
});

describe("E18 an on-disk __proto__ key round-trips as data (no pollution)", () => {
  it("written text keeps own __proto__; GET raw has it as an own key", async () => {
    fs.writeFileSync(file, '{"__proto__":{"x":1},"futureHermesKey":2}');
    expect((await put({ nudgeInterval: 3 })).statusCode).toBe(200);
    const text = fs.readFileSync(file, "utf-8");
    expect(text).toContain('"__proto__"');
    const parsed = JSON.parse(text);
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(parsed.__proto__).toEqual({ x: 1 });
    const raw = readEffectiveConfig(file).raw;
    expect(Object.hasOwn(raw, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe("E19 an unknown key in the BODY is still rejected", () => {
  it("400 naming futureHermesKey; file bytes unchanged", async () => {
    seed({ futureHermesKey: 42 });
    const before = fs.readFileSync(file, "utf-8");
    const res = await put({ futureHermesKey: 7, nudgeInterval: 3 });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors.map((e: { field: string }) => e.field)).toContain("futureHermesKey");
    expect(fs.readFileSync(file, "utf-8")).toBe(before);
  });
});

describe("X5 unreadable file (EISDIR) → 500 on GET and PUT, nothing written", () => {
  it("maps to { error, code } and logs path + code only", async () => {
    const logged: string[] = [];
    await app.close();
    app = Fastify();
    registerHermesRoutes(app, {
      logger: { info: () => {}, warn: () => {}, error: (m: string) => logged.push(m) },
      env: { PI_CODING_AGENT_DIR: dir },
    });
    await app.ready();
    fs.mkdirSync(file);
    const get = await app.inject({ method: "GET", url: ROUTE });
    expect(get.statusCode).toBe(500);
    expect(get.json()).toEqual({ error: "hermes config file unreadable", code: "EISDIR" });
    const res = await put({ nudgeInterval: 3 });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "hermes config file unreadable", code: "EISDIR" });
    expect(fs.statSync(file).isDirectory()).toBe(true);
    expect(fs.readdirSync(file)).toEqual([]);
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      expect(line).toContain(file);
      expect(line).toContain("EISDIR");
      expect(line).not.toContain("nudgeInterval");
    }
  });
});

describe("X4 (route) failed quarantine copy → 500, no write", () => {
  it("maps HermesConfigError to { error, code }", async () => {
    await app.close();
    app = Fastify();
    registerHermesRoutes(app, {
      logger: silentLogger,
      env: { PI_CODING_AGENT_DIR: dir },
      write: {
        writeQuarantine: () => {
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        },
      },
    });
    await app.ready();
    fs.writeFileSync(file, "{ broken");
    const res = await put({ nudgeInterval: 3 });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "hermes config quarantine failed", code: "EACCES" });
    expect(fs.readFileSync(file, "utf-8")).toBe("{ broken");
  });
});

