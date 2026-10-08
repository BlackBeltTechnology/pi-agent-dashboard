/**
 * Routes + spawn-env contributor. Folds X1, X3(GET/contributor), X4, X5, X7, E14.
 * See change: add-context-mode-settings-plugin.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSpawnEnvContributor, ROUTE, registerContextModeRoutes } from "../index.js";

let dir: string;
let file: string;
let app: FastifyInstance;
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(async () => {
  vi.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cms-routes-"));
  file = path.join(dir, "sub", "settings.json");
  app = Fastify();
  await registerContextModeRoutes(app, { logger, filePath: () => file });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("GET", () => {
  it("X7: absent file → 200 defaults, nothing created", async () => {
    const res = await app.inject({ method: "GET", url: ROUTE });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.exists).toBe(false);
    expect(b.fields["search.windowMs"]).toEqual({ value: 60000, default: 60000, isDefault: true });
    expect(fs.existsSync(path.dirname(file))).toBe(false);
    const c = createSpawnEnvContributor({ logger, filePath: () => file });
    expect(c({ mechanism: "headless" })).toEqual({});
    expect(fs.existsSync(path.dirname(file))).toBe(false);
  });

  it("X3: corrupt file → all defaults; contributor returns {} + warning", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json");
    const b = (await app.inject({ method: "GET", url: ROUTE })).json();
    expect(b.fields["search.windowMs"].isDefault).toBe(true);
    const c = createSpawnEnvContributor({ logger, filePath: () => file });
    expect(c({ mechanism: "headless" })).toEqual({});
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("PUT", () => {
  it("valid write persists logical keys and reports non-default", async () => {
    const res = await app.inject({ method: "PUT", url: ROUTE, payload: { "search.windowMs": 30000 } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({ "search.windowMs": 30000 });
    expect(res.json().fields["search.windowMs"].isDefault).toBe(false);
    expect(fs.readFileSync(file, "utf-8")).not.toContain("CONTEXT_MODE_SEARCH_WINDOW_MS");
  });

  it("X1: one invalid key → 400 with exactly that error; file bytes unchanged", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"search.windowMs": 1}\n');
    const before = fs.readFileSync(file);
    const res = await app.inject({ method: "PUT", url: ROUTE, payload: { "search.blockAfter": 0, "fetch.strict": true } });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toHaveLength(1);
    expect(res.json().errors[0].key).toBe("search.blockAfter");
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });

  it("unknown key rejected", async () => {
    const res = await app.inject({ method: "PUT", url: ROUTE, payload: { "bridge.depth": 1 } });
    expect(res.statusCode).toBe(400);
  });
});

describe("spawn-env contributor", () => {
  const put = (obj: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj));
  };

  it("E14: projects both scopes for headless/tmux/wt and nothing for wsl-tmux", () => {
    put({ "search.windowMs": 30000, "storage.dir": "/d" });
    const c = createSpawnEnvContributor({ logger, filePath: () => file });
    for (const m of ["headless", "tmux", "wt"] as const) {
      expect(c({ mechanism: m })).toEqual({ CONTEXT_MODE_SEARCH_WINDOW_MS: "30000", CONTEXT_MODE_DIR: "/d" });
    }
    expect(c({ mechanism: "wsl-tmux" })).toEqual({});
  });

  it("X4: invalid entry omitted individually with one warning naming the key", () => {
    put({ "search.blockAfter": -1, "search.windowMs": 30000 });
    const c = createSpawnEnvContributor({ logger, filePath: () => file });
    expect(c({ mechanism: "headless" })).toEqual({ CONTEXT_MODE_SEARCH_WINDOW_MS: "30000" });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain("search.blockAfter");
  });

  it("X5: an external edit is visible on the next call (no cache)", () => {
    const c = createSpawnEnvContributor({ logger, filePath: () => file });
    put({ "search.windowMs": 30000 });
    expect(c({ mechanism: "headless" }).CONTEXT_MODE_SEARCH_WINDOW_MS).toBe("30000");
    put({ "search.windowMs": 45000 });
    expect(c({ mechanism: "headless" }).CONTEXT_MODE_SEARCH_WINDOW_MS).toBe("45000");
  });
});
