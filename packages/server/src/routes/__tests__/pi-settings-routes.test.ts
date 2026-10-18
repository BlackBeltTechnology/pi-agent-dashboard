import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mirrorDefaultsToPi } from "../../pi-agent-settings.js";
import { registerPiRetryRoutes } from "../pi-retry-routes.js";
import { PI_SETTINGS_RAW_BODY_LIMIT, registerPiSettingsRoutes } from "../pi-settings-routes.js";

const lockfile = createRequire(import.meta.url)("proper-lockfile") as typeof import("proper-lockfile");

/**
 * /api/pi-settings routes: read, typed patch, raw write, drift repair.
 * Real tmp agent dir via the route's `fsDeps` seam.
 * See change: edit-pi-agent-settings.
 */
describe("pi-settings routes", () => {
  let dir: string;
  let file: string;
  let app: FastifyInstance;
  let reloads: number;
  let guardStatus: number | null;
  let dashboard: { defaultModel?: string; defaultThinkingLevel?: string };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-routes-"));
    file = join(dir, "settings.json");
    reloads = 0;
    guardStatus = null;
    dashboard = {};
    app = Fastify();
    registerPiSettingsRoutes(app, {
      networkGuard: async (_req, reply) => {
        if (guardStatus) reply.code(guardStatus).send({ success: false, error: "denied" });
      },
      reloadConnectedSessions: () => {
        reloads += 1;
        return 2;
      },
      readDashboardConfig: () => dashboard,
      fsDeps: { agentDirEnv: dir },
    });
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const seed = (t: string | object) => writeFileSync(file, typeof t === "string" ? t : JSON.stringify(t, null, 2));
  const onDisk = () => readFileSync(file, "utf-8");
  const get = async () => (await app.inject({ method: "GET", url: "/api/pi-settings" })).json();
  const typed = (patch: unknown, baseEtag: string) =>
    app.inject({ method: "PUT", url: "/api/pi-settings", payload: { patch, baseEtag } });
  const rawPut = (raw: string, baseEtag: string) =>
    app.inject({ method: "PUT", url: "/api/pi-settings/raw", payload: { raw, baseEtag } });

  describe("GET", () => {
    it("E1 existing file", async () => {
      seed({ steeringMode: "all" });
      const res = await app.inject({ method: "GET", url: "/api/pi-settings" });
      expect(res.statusCode).toBe(200);
      const b = res.json();
      expect(b.settings.steeringMode).toBe("all");
      expect(b.raw).toBe(onDisk());
      expect(b.etag).not.toBe("absent");
      expect(b.etag).toBeTruthy();
    });

    it("E2 absent file", async () => {
      expect(await get()).toMatchObject({ success: true, settings: {}, raw: "", etag: "absent" });
    });

    it("E3 unparseable file", async () => {
      seed('{ "steeringMode": ');
      const b = await get();
      expect(typeof b.parseError).toBe("string");
      expect(b.settings).toEqual({});
      expect(b.raw).toBe('{ "steeringMode": ');
    });

    it("E4 BOM", async () => {
      seed('\uFEFF{"steeringMode":"all"}');
      const b = await get();
      expect(b.settings.steeringMode).toBe("all");
      expect(b.parseError).toBeUndefined();
    });
  });

  describe("write outcomes + reload (X8)", () => {
    it("200 on typed and raw: reloadedSessions 2; every rejection reloads nothing", async () => {
      seed({});
      let t = (await get()).etag;
      let res = await typed({ steeringMode: "all" }, t);
      expect(res.statusCode).toBe(200);
      expect(res.json().reloadedSessions).toBe(2);
      t = res.json().etag;
      res = await rawPut('{"steeringMode":"one-at-a-time"}', t);
      expect(res.statusCode).toBe(200);
      expect(res.json().reloadedSessions).toBe(2);
      expect(reloads).toBe(2);

      const stale = (await get()).etag;
      seed({ steeringMode: "all", other: 1 }); // external change
      expect((await typed({ followUpMode: "all" }, stale)).statusCode).toBe(409);
      expect((await rawPut("{}", stale)).statusCode).toBe(409);
      expect((await typed({ steeringMode: "bad" }, (await get()).etag)).statusCode).toBe(400);
      expect((await rawPut("{", (await get()).etag)).statusCode).toBe(400);
      const big = JSON.stringify({ raw: " ".repeat(PI_SETTINGS_RAW_BODY_LIMIT + 1), baseEtag: "x" });
      expect((await app.inject({ method: "PUT", url: "/api/pi-settings/raw", headers: { "content-type": "application/json" }, payload: big })).statusCode).toBe(413);
      const release = await lockfile.lock(file, { realpath: false, stale: 10_000 });
      try {
        const cur = (await get()).etag;
        expect((await typed({ steeringMode: "all" }, cur)).statusCode).toBe(503);
        expect((await rawPut("{}", cur)).statusCode).toBe(503);
      } finally {
        await release();
      }
      expect(reloads).toBe(2);
    });

    it("409 body carries the current state", async () => {
      seed({ a: 1 });
      const t = (await get()).etag;
      seed({ a: 2 });
      const res = await typed({ steeringMode: "all" }, t);
      expect(res.json()).toMatchObject({ success: false, error: "stale", settings: { a: 2 } });
      expect(res.json().etag).toBeTruthy();
      expect(res.json().raw).toBe(onDisk());
    });

    it("400 invalid carries field errors", async () => {
      seed({});
      const res = await typed({ compaction: { reserveTokens: -1 } }, (await get()).etag);
      expect(res.statusCode).toBe(400);
      expect(res.json().errors[0].field).toBe("compaction.reserveTokens");
    });

    // test-plan #E6 — pi 1.3.0 key. See change: update-pi-core-1-3-adopt-apis.
    it("E6 sessionShareDestination: each enum value is written verbatim, null deletes it, other keys untouched", async () => {
      const others = { steeringMode: "all", compaction: { enabled: false }, extra: [1, 2] };
      seed(others);
      for (const value of ["auto", "gist", "radius"]) {
        const res = await typed({ sessionShareDestination: value }, (await get()).etag);
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(onDisk())).toEqual({ ...others, sessionShareDestination: value });
      }
      const res = await typed({ sessionShareDestination: null }, (await get()).etag);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(onDisk())).toEqual(others);
    });

    // test-plan #E7
    it("E7 sessionShareDestination: an invalid value is a 400 field error and the file is byte-identical", async () => {
      seed({ steeringMode: "all" });
      const before = onDisk();
      for (const bad of ["s3", true]) {
        const res = await typed({ sessionShareDestination: bad }, (await get()).etag);
        expect(res.statusCode).toBe(400);
        expect(res.json().errors.map((e: { field: string }) => e.field)).toContain("sessionShareDestination");
        expect(onDisk()).toBe(before);
      }
    });

    it("missing baseEtag → 400", async () => {
      const res = await app.inject({ method: "PUT", url: "/api/pi-settings", payload: { patch: {} } });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("raw size boundary (E22)", () => {
    const bodyOfSize = (total: number, baseEtag: string) => {
      const mk = (pad: number) => JSON.stringify({ raw: JSON.stringify({ pad: "x".repeat(pad) }), baseEtag });
      return mk(total - mk(0).length);
    };

    it.each([
      [PI_SETTINGS_RAW_BODY_LIMIT - 1, 200],
      [PI_SETTINGS_RAW_BODY_LIMIT, 200],
      [PI_SETTINGS_RAW_BODY_LIMIT + 1, 413],
    ])("body of %i bytes → %i", async (size, status) => {
      seed({});
      const payload = bodyOfSize(size, (await get()).etag);
      expect(Buffer.byteLength(payload)).toBe(size);
      const before = onDisk();
      const res = await app.inject({
        method: "PUT",
        url: "/api/pi-settings/raw",
        headers: { "content-type": "application/json" },
        payload,
      });
      expect(res.statusCode).toBe(status);
      if (status === 413) {
        expect(res.json()).toMatchObject({ success: false });
        expect(typeof res.json().error).toBe("string");
        expect(onDisk()).toBe(before);
        expect(reloads).toBe(0);
      }
    });
  });

  describe("sync-defaults (E38)", () => {
    it("mirrors both keys from the dashboard config; no reload", async () => {
      dashboard = { defaultModel: "anthropic/claude-opus-5-5", defaultThinkingLevel: "high" };
      seed({ defaultProvider: "x", defaultModel: "claude-opus-5", defaultThinkingLevel: "medium", keep: 1 });
      const res = await app.inject({ method: "POST", url: "/api/pi-settings/sync-defaults" });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(onDisk())).toEqual({
        defaultProvider: "anthropic",
        defaultModel: "claude-opus-5-5",
        defaultThinkingLevel: "high",
        keep: 1,
      });
      expect(res.json().settings.defaultModel).toBe("claude-opus-5-5");
      expect(reloads).toBe(0);
    });

    it("unparseable pi file → 400, untouched", async () => {
      dashboard = { defaultModel: "anthropic/a" };
      seed("{");
      const res = await app.inject({ method: "POST", url: "/api/pi-settings/sync-defaults" });
      expect(res.statusCode).toBe(400);
      expect(onDisk()).toBe("{");
    });
  });

  describe("project settings file (E41)", () => {
    it("is never touched by any write endpoint", async () => {
      const proj = mkdtempSync(join(tmpdir(), "pi-proj-"));
      mkdirSync(join(proj, ".pi"));
      const sentinel = join(proj, ".pi", "settings.json");
      writeFileSync(sentinel, "SENTINEL");
      const mtime = statSync(sentinel).mtimeMs;
      dashboard = { defaultModel: "anthropic/a" };
      seed({});
      const t = (await get()).etag;
      const r1 = await typed({ steeringMode: "all" }, t);
      await rawPut("{}", r1.json().etag);
      await app.inject({ method: "POST", url: "/api/pi-settings/sync-defaults" });
      const prev = process.env.PI_CODING_AGENT_DIR;
      process.env.PI_CODING_AGENT_DIR = dir;
      try {
        const retryApp = Fastify();
        registerPiRetryRoutes(retryApp, { networkGuard: async () => {}, reloadConnectedSessions: () => 0 });
        await retryApp.inject({
          method: "PUT",
          url: "/api/pi-retry",
          payload: { enabled: true, maxRetries: 3, baseDelayMs: 2000, provider: { maxRetries: 0, maxRetryDelayMs: 60000 } },
        });
        await retryApp.close();
      } finally {
        if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = prev;
      }
      expect(readFileSync(sentinel, "utf-8")).toBe("SENTINEL");
      expect(statSync(sentinel).mtimeMs).toBe(mtime);
    });
  });

  describe("network guard (X10)", () => {
    it("rejects every endpoint with the guard's status and writes nothing", async () => {
      seed({ a: 1 });
      const before = onDisk();
      guardStatus = 403;
      const t = "whatever";
      expect((await app.inject({ method: "GET", url: "/api/pi-settings" })).statusCode).toBe(403);
      expect((await typed({ steeringMode: "all" }, t)).statusCode).toBe(403);
      expect((await rawPut("{}", t)).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url: "/api/pi-settings/sync-defaults" })).statusCode).toBe(403);
      expect(onDisk()).toBe(before);
      expect(reloads).toBe(0);
    });
  });

  describe("logs (X11)", () => {
    it("record outcome + reload count, never values", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      seed({});
      const t = (await get()).etag;
      const secret = '{"httpProxy":"http://user:secret@h"}';
      const ok = await rawPut(secret, t);
      expect(ok.statusCode).toBe(200);
      await rawPut("{", ok.json().etag); // 400
      await rawPut(secret, t); // 409
      const lines = log.mock.calls.map((c) => c.join(" ")).filter((l) => l.includes("[pi-settings]"));
      expect(lines.some((l) => l.includes("ok") && l.includes("reloaded=2"))).toBe(true);
      expect(lines.some((l) => l.includes("invalid"))).toBe(true);
      expect(lines.some((l) => l.includes("stale"))).toBe(true);
      expect(lines.join("\n")).not.toContain("secret");
    });
  });

  describe("event loop (P1)", () => {
    it("a waiting PUT does not block concurrent requests", async () => {
      seed({});
      const t = (await get()).etag;
      const release = await lockfile.lock(file, { realpath: false, stale: 10_000 });
      try {
        const put = typed({ steeringMode: "all" }, t);
        await new Promise((r) => setTimeout(r, 20));
        const latencies: number[] = [];
        for (let i = 0; i < 5; i++) {
          const start = performance.now();
          await app.inject({ method: "GET", url: "/api/pi-settings" });
          latencies.push(performance.now() - start);
          await new Promise((r) => setTimeout(r, 5));
        }
        expect(Math.max(...latencies)).toBeLessThan(50);
        expect((await put).statusCode).toBe(503);
      } finally {
        await release();
      }
    });
  });

  describe("unified Save converges (F1)", () => {
    it.each(["editor-first", "mirror-first"])("typed patch + mirror concurrently (%s) both succeed", async (order) => {
      for (let i = 0; i < 20; i++) {
        seed({});
        dashboard = { defaultModel: "anthropic/claude-opus-5-5" };
        const t = (await get()).etag;
        const patchP = () => typed({ steeringMode: "all" }, t);
        const mirrorP = () => mirrorDefaultsToPi(() => dashboard, ["defaultModel"], { agentDirEnv: dir });
        const [a, b] = order === "editor-first" ? await Promise.all([patchP(), mirrorP()]) : (await Promise.all([mirrorP(), patchP()])).reverse();
        expect((a as { statusCode: number }).statusCode).toBe(200);
        expect((b as { ok: boolean }).ok).toBe(true);
        expect(JSON.parse(onDisk())).toMatchObject({ steeringMode: "all", defaultModel: "claude-opus-5-5", defaultProvider: "anthropic" });
      }
    });
  });
});
