/**
 * L1 — the per-session pipeline + status route contract against a real
 * (injected) Fastify instance (test-plan E1–E9, X3, X5–X8).
 *
 * Mirrors `routes.test.ts` (add-blackhole-plugin) precedent: injected Fastify,
 * tmpdir agent dir, real filesystem. Detection covers the capability matrix;
 * the session route covers validate-then-confine, quiet degradation, and the
 * read-only contract.
 *
 * See change: add-blackhole-session-pipeline.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerBlackholeRoutes } from "../index.js";

// Counting fs spies: ESM namespaces are not configurable, so vi.spyOn cannot
// observe `node:fs` — wrap instead (same reason as config-io.test.ts X9).
const fsCalls: string[] = [];
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const counted = <T extends (...args: never[]) => unknown>(name: string, fn: T) =>
    (...args: never[]) => {
      fsCalls.push(name);
      return fn(...args);
    };
  return {
    ...actual,
    readFileSync: counted("readFileSync", actual.readFileSync),
    existsSync: counted("existsSync", actual.existsSync),
  };
});

let dir: string;
let bhDir: string;
let app: FastifyInstance;
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

const UUID_V7 = "019fe770-a0a4-70bb-ac85-2e92e6aa8216";

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "blackhole-pipeline-"));
  bhDir = path.join(dir, "pi-blackhole");
  app = Fastify();
  registerBlackholeRoutes(app, {
    logger: silentLogger,
    env: { PI_CODING_AGENT_DIR: dir },
  });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function seedPending(sessionId: string, obj: unknown): Buffer {
  fs.mkdirSync(bhDir, { recursive: true });
  const p = path.join(bhDir, `${sessionId}-pending.json`);
  fs.writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj, null, 2), "utf-8");
  return fs.readFileSync(p);
}

function seedConfig(obj: unknown): void {
  fs.mkdirSync(bhDir, { recursive: true });
  fs.writeFileSync(path.join(bhDir, "pi-blackhole-config.json"), JSON.stringify(obj), "utf-8");
}

function seedCooldown(obj: unknown): void {
  fs.mkdirSync(bhDir, { recursive: true });
  fs.writeFileSync(path.join(bhDir, "pi-blackhole-cooldown.json"), JSON.stringify(obj), "utf-8");
}

/** App variant with an injected capability (status-route matrix). */
async function appWithCapability(
  cap: (() => Promise<boolean>) | undefined,
): Promise<FastifyInstance> {
  const a = Fastify();
  registerBlackholeRoutes(a, {
    logger: silentLogger,
    env: { PI_CODING_AGENT_DIR: dir },
    isPiExtensionInstalled: cap,
  });
  await a.ready();
  return a;
}

// ── GET /status — the installed gate truth source (E1–E4, X3) ───────────────

describe("GET /api/plugins/blackhole/status", () => {
  it("capability present → its answer alone; true with NO config file (E1)", async () => {
    const a = await appWithCapability(async () => true);
    const res = await a.inject({ method: "GET", url: "/api/plugins/blackhole/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ installed: true });
    expect(fs.existsSync(path.join(bhDir, "pi-blackhole-config.json"))).toBe(false);
    await a.close();
  });

  it("capability answers false — config file does NOT override (E2)", async () => {
    seedConfig({ memory: true });
    const a = await appWithCapability(async () => false);
    const res = await a.inject({ method: "GET", url: "/api/plugins/blackhole/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ installed: false });
    await a.close();
  });

  it("capability ABSENT + config file exists → degraded fallback true (E3)", async () => {
    seedConfig({ memory: true });
    const res = await app.inject({ method: "GET", url: "/api/plugins/blackhole/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ installed: true });
  });

  it("capability ABSENT + no config file → fails closed false (E4)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins/blackhole/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ installed: false });
  });

  it("capability rejection → 503, body is NOT { installed: false } (X3)", async () => {
    const a = await appWithCapability(async () => {
      throw new Error("registry locked");
    });
    const res = await a.inject({ method: "GET", url: "/api/plugins/blackhole/status" });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.installed).toBeUndefined();
    expect(typeof body.error).toBe("string");
    await a.close();
  });
});

// ── Session id validation (E5–E8) ────────────────────────────────────────────

describe("GET /api/plugins/blackhole/session/:id — validation", () => {
  it("accepts a UUIDv7 and reads its exact pending file (E5)", async () => {
    seedPending(UUID_V7, { cursors: { observer: { entryId: "aabbccdd", state: "recorded" } } });
    const res = await app.inject({ method: "GET", url: `/api/plugins/blackhole/session/${UUID_V7}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().sessionId).toBe(UUID_V7);
    expect(res.json().activity).toBe("active");
    expect(res.json().cursors.observer.state).toBe("recorded");
  });

  it("accepts version nibbles 1, 4, 7, 8 (E6)", async () => {
    const ids = [
      "3fa85f64-5717-1e52-b3fc-2c963f66afa6",
      "3fa85f64-5717-45c2-b3fc-2c963f66afa6",
      "019fe770-a0a4-7dbb-ac85-2e92e6aa8216",
      "3fa85f64-5717-85c2-b3fc-2c963f66afa6",
    ];
    for (const id of ids) {
      const res = await app.inject({ method: "GET", url: `/api/plugins/blackhole/session/${id}` });
      expect(res.statusCode, id).toBe(200);
    }
  });

  it("rejects invalid ids with 4xx and ZERO filesystem access (E7, E8)", async () => {
    fsCalls.length = 0;
    const hostile = [
      "", // empty
      "019fe770-a0a4-70bb-ac85-2e92e6aa821", // 35 chars — truncated
      "019fe770-a0a4-70bb-ac85-2e92e6aa82166", // 37 chars
      "019fe770a0a470bbac852e92e6aa8216", // no separators
      "019fe770-a0a4-70bb-ac85-2e92e6aa8zzz", // non-hex garbage
      "../../../../etc/passwd", // path separator + ..
      "%2e%2e%2fetc", // percent-encoded traversal
      "019fe770-a0a4-70bb-ac85-2e92e6aa8216/extra", // embedded separator
      "..\\..\\windows", // backseparator
    ];
    for (const id of hostile) {
      const url = `/api/plugins/blackhole/session/${encodeURIComponent(id)}`;
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, id).toBeGreaterThanOrEqual(400);
      expect(res.statusCode, id).toBeLessThan(500);
    }
    expect(fsCalls).toEqual([]);
  });

  it("confines the resolved pending path inside <agentDir>/pi-blackhole/ (E9)", async () => {
    // Pure path-builder check: whatever id reaches it, the resolved absolute
    // path stays inside the blackhole directory.
    const { resolvePipelinePaths } = await import("../pipeline-reader.js");
    const { pendingPath, containerDir } = resolvePipelinePaths(
      { PI_CODING_AGENT_DIR: dir },
      UUID_V7,
    );
    const resolvedContainer = path.resolve(containerDir);
    expect(path.resolve(pendingPath).startsWith(resolvedContainer + path.sep)).toBe(true);
    expect(path.resolve(pendingPath)).toBe(path.join(bhDir, `${UUID_V7}-pending.json`));
  });
});

// ── Response assembly (X5–X7) ────────────────────────────────────────────────

describe("GET /api/plugins/blackhole/session/:id — assembly", () => {
  it("absent pending file → no-activity 200, never an error (X5a)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/plugins/blackhole/session/${UUID_V7}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().activity).toBe("none");
  });

  it("truncated pending JSON → treated as no activity (X5b)", async () => {
    seedPending(UUID_V7, '{ "cursors": { "observer"');
    const res = await app.inject({ method: "GET", url: `/api/plugins/blackhole/session/${UUID_V7}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().activity).toBe("none");
  });

  it("healthy config → global fields populated", async () => {
    seedConfig({ compactAfterTokens: 81_000, memory: true, compaction: "auto" });
    const body = (
      await app.inject({ method: "GET", url: `/api/plugins/blackhole/session/${UUID_V7}` })
    ).json();
    expect(body.config).toEqual({
      compactAfterTokens: 81_000,
      memory: true,
      compaction: "auto",
    });
  });

  it("malformed global config → null global fields, still 200 (X6)", async () => {
    fs.mkdirSync(bhDir, { recursive: true });
    fs.writeFileSync(path.join(bhDir, "pi-blackhole-config.json"), "{ broken", "utf-8");
    const res = await app.inject({ method: "GET", url: `/api/plugins/blackhole/session/${UUID_V7}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().config).toEqual({
      compactAfterTokens: null,
      memory: null,
      compaction: null,
    });
  });

  it("active cooldown entry → worker advisory with model, until and reason (X7-healthy path)", async () => {
    seedConfig({
      memory: true,
      observerModel: { provider: "openai", id: "gpt-x" },
    });
    const future = new Date(Date.now() + 3_600_000).toISOString();
    seedCooldown({
      "openai/gpt-x": { until: future, reason: "429 Too Many Requests", stage: "observer" },
    });
    const body = (
      await app.inject({ method: "GET", url: `/api/plugins/blackhole/session/${UUID_V7}` })
    ).json();
    expect(body.workers.observer.model).toBe("openai/gpt-x");
    expect(body.workers.observer.cooldown).toEqual({ until: future, reason: "429 Too Many Requests" });
    expect(body.workers.reflector.cooldown).toBeNull();
  });

  it("absent cooldown file → no advisory, healthy path unaffected (X7a)", async () => {
    seedConfig({ memory: true, observerModel: { provider: "openai", id: "gpt-x" } });
    const body = (
      await app.inject({ method: "GET", url: `/api/plugins/blackhole/session/${UUID_V7}` })
    ).json();
    expect(body.workers.observer.cooldown).toBeNull();
  });

  it("garbage cooldown file → no advisory, still 200 (X7b)", async () => {
    seedConfig({ memory: true });
    seedCooldown("not json at all {");
    const res = await app.inject({ method: "GET", url: `/api/plugins/blackhole/session/${UUID_V7}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().workers.observer.cooldown).toBeNull();
  });

  it("manual-mode accumulated batches → pendingBatches counted", async () => {
    seedPending(UUID_V7, {
      observationBatches: [{ coversUpToId: "a", data: 1 }, { coversUpToId: "b", data: 2 }],
      reflectionBatches: [{ coversUpToId: "c", data: 3 }],
      cursors: { observer: { entryId: "aabbccdd", state: "recorded" } },
    });
    const body = (
      await app.inject({ method: "GET", url: `/api/plugins/blackhole/session/${UUID_V7}` })
    ).json();
    expect(body.pendingBatches).toBe(3);
    expect(body.activity).toBe("active");
  });

  it("numeric cursor entries and tip pass through when recorded (E11 support)", async () => {
    seedPending(UUID_V7, {
      cursors: { observer: { entryId: "aabbccdd", state: "recorded", entry: 412 } },
      tip: 450,
    });
    const body = (
      await app.inject({ method: "GET", url: `/api/plugins/blackhole/session/${UUID_V7}` })
    ).json();
    expect(body.cursors.observer.entry).toBe(412);
    expect(body.tip).toBe(450);
  });
});

// ── Read-only contract (X8) ──────────────────────────────────────────────────

describe("read-only contract", () => {
  it("registers only GET handlers on both routes — mutating verbs are unregistered (X8a)", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const status = await app.inject({
        method,
        url: "/api/plugins/blackhole/session/019fe770-a0a4-70bb-ac85-2e92e6aa8216",
        payload: {},
      });
      expect(status.statusCode, `${method} session`).toBe(404);
      const statusRoute = await app.inject({
        method,
        url: "/api/plugins/blackhole/status",
        payload: {},
      });
      expect(statusRoute.statusCode, `${method} status`).toBe(404);
    }
    const ok = await app.inject({
      method: "GET",
      url: "/api/plugins/blackhole/status",
    });
    expect(ok.statusCode).toBe(200);
  });

  it("a served request leaves the pending file bytes + mtime unchanged (X8b)", async () => {
    const buf = seedPending(UUID_V7, { cursors: { observer: { entryId: "a", state: "recorded" } } });
    const statBefore = fs.statSync(path.join(bhDir, `${UUID_V7}-pending.json`));
    await new Promise((r) => setTimeout(r, 20));
    const res = await app.inject({ method: "GET", url: `/api/plugins/blackhole/session/${UUID_V7}` });
    expect(res.statusCode).toBe(200);
    const statAfter = fs.statSync(path.join(bhDir, `${UUID_V7}-pending.json`));
    expect(fs.readFileSync(path.join(bhDir, `${UUID_V7}-pending.json`)).equals(buf)).toBe(true);
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
  });
});
