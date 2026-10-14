import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerSystemRoutes } from "../routes/system-routes.js";

const lockfile = createRequire(import.meta.url)("proper-lockfile") as typeof import("proper-lockfile");

/**
 * `PUT /api/config` mirrors the dashboard default model / thinking level into
 * pi's global settings.json (design D1). Config writes land in the ephemeral
 * HOME the harness sets; pi's agent dir is sandboxed via PI_CODING_AGENT_DIR.
 * See change: edit-pi-agent-settings.
 */
describe("PUT /api/config → pi default mirror", () => {
  let app: FastifyInstance;
  let agentDir: string;
  let prevAgentDir: string | undefined;
  const piFile = () => join(agentDir, "settings.json");
  const seedPi = (t: string | object) => writeFileSync(piFile(), typeof t === "string" ? t : JSON.stringify(t, null, 2));
  const piJson = () => JSON.parse(readFileSync(piFile(), "utf-8"));

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-mirror-"));
    prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    app = Fastify();
    registerSystemRoutes(app, {
      sessionManager: {} as never,
      preferencesStore: { flush: () => {} } as never,
      metaPersistence: { flushAll: () => {} } as never,
      config: { port: 8000, piPort: 9999, dev: false } as never,
      networkGuard: async () => {},
    } as never);
  });

  afterEach(async () => {
    await app.close();
    if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
  });

  const save = (partial: Record<string, unknown>) => app.inject({ method: "PUT", url: "/api/config", payload: partial });

  it.each([
    ["anthropic/claude-opus-5-5", { defaultProvider: "anthropic", defaultModel: "claude-opus-5-5" }, undefined],
    ["openrouter/deepseek/deepseek-v4.1-flash", { defaultProvider: "openrouter", defaultModel: "deepseek/deepseek-v4.1-flash" }, undefined],
  ])("E33 %s splits on the first /", async (model, expected, skipped) => {
    seedPi({ keep: 1 });
    const res = await save({ defaultModel: model });
    expect(res.statusCode).toBe(200);
    expect(piJson()).toEqual({ keep: 1, ...expected });
    expect(res.json().piMirror).toEqual({ ok: true, ...(skipped ? { skipped } : {}) });
    expect(loadConfig().defaultModel).toBe(model);
  });

  it("E33 no provider separator → skipped, pi unchanged", async () => {
    seedPi({ defaultProvider: "p", defaultModel: "m" });
    const res = await save({ defaultModel: "claude-opus-5-5" });
    expect(res.json().piMirror).toEqual({ ok: true, skipped: "no-provider-separator" });
    expect(piJson()).toEqual({ defaultProvider: "p", defaultModel: "m" });
  });

  it("E33 empty model → pi unchanged", async () => {
    seedPi({ defaultProvider: "p", defaultModel: "m" });
    await save({ defaultModel: "" });
    expect(piJson()).toEqual({ defaultProvider: "p", defaultModel: "m" });
  });

  it.each([
    ["high", "high"],
    ["max", "max"],
    ["", undefined],
    ["loud", undefined],
  ])("E34 thinking level %j", async (level, mirrored) => {
    seedPi({ keep: 1 });
    await save({ defaultThinkingLevel: level });
    expect(piJson().defaultThinkingLevel).toBe(mirrored);
  });

  it("E35 unrelated save leaves pi byte-identical and adds no piMirror", async () => {
    seedPi({ keep: 1 });
    const mtime = statSync(piFile()).mtimeMs;
    const before = readFileSync(piFile(), "utf-8");
    const res = await save({ autoShutdown: true });
    expect(res.json().piMirror).toBeUndefined();
    expect(readFileSync(piFile(), "utf-8")).toBe(before);
    expect(statSync(piFile()).mtimeMs).toBe(mtime);
  });

  it("E36 idempotent: already-equal pi file is not rewritten", async () => {
    seedPi({ defaultProvider: "anthropic", defaultModel: "claude-opus-5-5" });
    const before = readFileSync(piFile(), "utf-8");
    const mtime = statSync(piFile()).mtimeMs;
    await new Promise((r) => setTimeout(r, 15));
    const res = await save({ defaultModel: "anthropic/claude-opus-5-5" });
    expect(res.json().piMirror).toEqual({ ok: true });
    expect(readFileSync(piFile(), "utf-8")).toBe(before);
    expect(statSync(piFile()).mtimeMs).toBe(mtime);
  });

  it("E37 unparseable pi file: save succeeds, mirror reports parse, pi untouched", async () => {
    seedPi('{ "a": ');
    const res = await save({ defaultModel: "anthropic/new-model" });
    expect(res.statusCode).toBe(200);
    expect(res.json().piMirror).toEqual({ ok: false, error: "parse" });
    expect(readFileSync(piFile(), "utf-8")).toBe('{ "a": ');
    expect(loadConfig().defaultModel).toBe("anthropic/new-model");
  });

  it("X7 held lock: save succeeds, mirror reports busy, pi unchanged", async () => {
    seedPi({ keep: 1 });
    const before = readFileSync(piFile(), "utf-8");
    const release = await lockfile.lock(piFile(), { realpath: false, stale: 10_000 });
    try {
      const res = await save({ defaultModel: "anthropic/busy-model" });
      expect(res.statusCode).toBe(200);
      expect(res.json().piMirror).toEqual({ ok: false, error: "busy" });
      expect(loadConfig().defaultModel).toBe("anthropic/busy-model");
    } finally {
      await release();
    }
    expect(readFileSync(piFile(), "utf-8")).toBe(before);
  });

  it("F2 overlapping saves converge on the persisted dashboard value", async () => {
    seedPi({});
    // Slow the first mirror: both queue behind a short-held lock.
    const release = await lockfile.lock(piFile(), { realpath: false, stale: 10_000 });
    setTimeout(() => void release(), 50);
    const [a, b] = await Promise.all([save({ defaultModel: "anthropic/a" }), save({ defaultModel: "anthropic/b" })]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    const persisted = loadConfig().defaultModel;
    expect(piJson().defaultModel).toBe(persisted.split("/").slice(1).join("/"));
  });
});
