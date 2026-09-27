// @vitest-environment node
/**
 * `/api/system-one/*` routes over a real Fastify instance. Tasks 5.1–5.9
 * (test-plan E19–E27). Exemplar: packages/roles-plugin/src/server/__tests__/roles-routes.test.ts.
 * See change: add-system-one-registry.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  atomicWrite0600,
  consumerFile,
  stateDir,
  userConfigPath,
  writeKey,
} from "@blackbelt-technology/pi-system-one";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  autoAnswer,
  type FakeBackend,
  interceptOffMachine,
  startFakeBackend,
} from "../../../../system-one/src/__tests__/helpers/fake-backend.js";
import { _resetForTests } from "../../../../system-one/src/config.js";
import { mergeWrite } from "../config-io.js";
import type { ServerLlmCaller } from "../llm-caller.js";
import { mountSystemOneRoutes } from "../routes.js";
import type { ManagedControl, ManagedStatus } from "../supervisor.js";

const fakes: FakeBackend[] = [];
let app: FastifyInstance;
let managedState: ManagedStatus["state"] = "stopped";
const managed: ManagedControl = {
  status: () => ({ state: managedState }),
  start: async () => ({ state: "starting" }),
  stop: async () => ({ state: "stopped" }),
  log: () => [],
  platform: () => "darwin",
  hasLauncher: () => true,
};
const llmCaller: ServerLlmCaller = { snapshot: async () => ({ isLocal: () => false, call: vi.fn() as never }) };

beforeEach(async () => {
  rmSync(userConfigPath(), { force: true });
  rmSync(stateDir(), { recursive: true, force: true });
  _resetForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  managedState = "stopped";
  app = Fastify();
  mountSystemOneRoutes(app, { networkGuard: async () => {}, llmCaller, managed });
  await app.ready();
});
afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.TYPESAFE_API_KEY;
  await app.close();
  await Promise.all(fakes.splice(0).map((f) => f.close()));
});

async function fake(): Promise<FakeBackend> {
  const f = await startFakeBackend();
  fakes.push(f);
  return f;
}
const req = async (method: "GET" | "PUT" | "POST", url: string, payload?: unknown) => {
  const r = await app.inject({ method, url, payload: payload as any });
  return { status: r.statusCode, body: r.json(), raw: r.body };
};
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
function writeUser(cfg: Record<string, unknown>): void {
  mkdirSync(dirname(userConfigPath()), { recursive: true });
  writeFileSync(userConfigPath(), JSON.stringify({ version: 1, ...cfg }, null, 2));
}
function registerConsumer(id: string, extra: Record<string, unknown> = {}): void {
  atomicWrite0600(consumerFile(id), JSON.stringify({ id, failurePolicy: "fail-open", ...extra }));
}
function writeFixtures(n: number): string {
  const dir = join(tmpdir(), `s1-fx-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true });
  const cases = Array.from({ length: n }, (_, i) => ({
    state: i % 2 ? "yes it is" : "no it is not",
    questions: { q: { type: "noul", instructions: "is it?" } },
    expected: { q: i % 2 === 1 },
  }));
  const p = join(dir, "fx.json");
  writeFileSync(p, JSON.stringify(cases));
  return p;
}

describe("E19 built-in preset seeding (5.1)", () => {
  it("GET offers the seed; the first PUT writes it", async () => {
    const g = await req("GET", "/api/system-one/config");
    expect(g.body).toMatchObject({ revision: "absent", exists: false });
    const p = await req("PUT", "/api/system-one/config", { config: g.body.config, baseRevision: g.body.revision });
    expect(p.status).toBe(200);
    const file = JSON.parse(readFileSync(userConfigPath(), "utf8"));
    expect(Object.keys(file.presets).sort()).toEqual(["hosted", "local-only"]);
    expect(file).toMatchObject({ activePreset: "local-only", allowOffMachine: false, version: 1 });
    expect(file.presets.hosted.chain).toEqual(["jev", "fast"]);
  });
});

describe("E20 config reads hide keys (5.2)", () => {
  it("neither /config nor /keys carries the key or a 4+ char prefix", async () => {
    writeUser({ backends: { jev: { kind: "http", url: "https://api.typesafe.ai/v1/systemone", model: "jev-1.13.0" } }, presets: { p: { chain: ["jev"] } }, activePreset: "p" });
    writeKey("TYPESAFE_API_KEY", "ts_TESTKEY123");
    const c = await req("GET", "/api/system-one/config");
    const k = await req("GET", "/api/system-one/keys");
    for (const raw of [c.raw, k.raw]) {
      for (let n = 4; n <= "ts_TESTKEY123".length; n++) expect(raw).not.toContain("ts_TESTKEY123".slice(0, n));
    }
    expect(k.body.keys.TYPESAFE_API_KEY).toEqual({ set: true, source: "file" });
  });

  it("refuses to overwrite an env key; stores a file key", async () => {
    process.env.TYPESAFE_API_KEY = "envkey";
    expect((await req("POST", "/api/system-one/keys/TYPESAFE_API_KEY", { value: "x" })).status).toBe(409);
    delete process.env.TYPESAFE_API_KEY;
    const r = await req("POST", "/api/system-one/keys/TYPESAFE_API_KEY", { value: "secret" });
    expect(r.body).toEqual({ status: { set: true, source: "file" } });
    expect(r.raw).not.toContain("secr");
    expect((await req("POST", "/api/system-one/keys/bad-ref", { value: "x" })).status).toBe(400);
  });
});

describe("E21 revision + merge (5.3)", () => {
  it("match replaces managed keys and keeps others; stale → 409 without writing", async () => {
    writeUser({
      note: "hand-written ✓",
      backends: { x: { kind: "http", url: "http://127.0.0.1:18480/v1/systemone", model: "kev", timeoutMs: 900 } },
      presets: { p: { chain: ["x"] } },
      activePreset: "p",
    });
    const g = await req("GET", "/api/system-one/config");
    const cfg = { ...g.body.config, allowOffMachine: true };
    const ok = await req("PUT", "/api/system-one/config", { config: cfg, baseRevision: g.body.revision });
    expect(ok.status).toBe(200);
    const file = JSON.parse(readFileSync(userConfigPath(), "utf8"));
    expect(file.note).toBe("hand-written ✓");
    expect(file.allowOffMachine).toBe(true);
    expect(file.backends.x.timeoutMs).toBe(900);

    const before = sha(userConfigPath());
    const stale = await req("PUT", "/api/system-one/config", { config: cfg, baseRevision: g.body.revision });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: "stale-revision" });
    expect(sha(userConfigPath())).toBe(before);
  });
});

describe("E22 calibration route (5.4)", () => {
  it("rejects a pre-persist revision; a fresh one merges only its record", async () => {
    registerConsumer("c");
    writeUser({ backends: { jev: { kind: "http", url: "https://api.typesafe.ai/v1/systemone", model: "jev-1.13.0" }, v: { kind: "managed", engine: "von" } }, presets: { p: { chain: ["jev"] } }, activePreset: "p" });
    const g = await req("GET", "/api/system-one/config");
    // supervisor persists a port after the page loaded
    mergeWrite((doc: any) => {
      doc.backends.v.port = 18401;
    });
    const body = { backendId: "jev", consumerId: "c", mode: "shadow", thresholds: { q: 0.6 }, model: "jev-1.13.0" };
    const stale = await req("POST", "/api/system-one/calibration", { ...body, baseRevision: g.body.revision });
    expect(stale.status).toBe(409);
    const file1 = JSON.parse(readFileSync(userConfigPath(), "utf8"));
    expect(file1.backends.v.port).toBe(18401);
    expect(file1.calibration).toBeUndefined();

    const fresh = (await req("GET", "/api/system-one/config")).body.revision;
    const ok = await req("POST", "/api/system-one/calibration", { ...body, baseRevision: fresh });
    expect(ok.status).toBe(200);
    const file2 = JSON.parse(readFileSync(userConfigPath(), "utf8"));
    expect(Object.keys(file2.calibration)).toEqual(["jev::c"]);
    expect(file2.calibration["jev::c"]).toMatchObject({ mode: "shadow", thresholds: { q: 0.6 }, model: "jev-1.13.0" });
    expect({ ...file2, calibration: undefined }).toEqual({ ...file1, calibration: undefined });
  });
});

describe("calibration rejects an unknown backend (review)", () => {
  it("400 unknown-backend, nothing written", async () => {
    registerConsumer("c");
    writeUser({ backends: { b: { kind: "http", url: "http://127.0.0.1:9/v1/systemone", model: "x" } }, presets: { p: { chain: ["b"] } }, activePreset: "p" });
    const rev = (await req("GET", "/api/system-one/config")).body.revision;
    const r = await req("POST", "/api/system-one/calibration", { backendId: "ghost", consumerId: "c", mode: "shadow", thresholds: {}, model: "m", baseRevision: rev });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("unknown-backend");
    expect(JSON.parse(readFileSync(userConfigPath(), "utf8")).calibration).toBeUndefined();
  });
});

describe("E23 URL validation (5.5)", () => {
  for (const [url, ok] of [
    ["file:///etc/passwd", false],
    ["data:,x", false],
    ["javascript:1", false],
    ["ftp://h", false],
    ["https://h/v1/systemone", true],
  ] as const) {
    it(`${url} → ${ok ? 200 : 400}`, async () => {
      const config = { allowOffMachine: false, backends: { b: { kind: "http", url, model: "m" } }, presets: { p: { chain: ["b"] } }, activePreset: "p" };
      const r = await req("PUT", "/api/system-one/config", { config, baseRevision: "absent" });
      expect(r.status).toBe(ok ? 200 : 400);
      if (!ok) expect(r.body).toMatchObject({ error: "invalid-url", backendId: "b" });
    });
  }
});

describe("E24 catalog (5.6)", () => {
  it("resolves capabilities, overrides and egress per backend", async () => {
    writeUser({
      backends: {
        jev: { kind: "http", url: "https://api.typesafe.ai/v1/systemone", model: "jev-1.13.0" },
        laya: { kind: "managed", engine: "laya" },
        custom: { kind: "http", url: "http://127.0.0.1:18480/v1/systemone", model: "mystery" },
        laya2: { kind: "managed", engine: "laya", capabilities: { maxContextTokens: 1000 } },
        fast: { kind: "llm", role: "@fast" },
      },
      presets: { p: { chain: ["jev"] } },
      activePreset: "p",
    });
    const b = (await req("GET", "/api/system-one/config")).body.backends;
    expect(b.jev).toMatchObject({
      capabilities: { maxContextTokens: 32000, maxOptions: 255 },
      keyRef: "TYPESAFE_API_KEY",
      priceUsdPerMTok: 0.042,
      offMachine: true,
      egress: "hosted",
    });
    expect(b.laya.capabilities.maxContextTokens).toBe(512);
    expect(b.laya.egress).toBe("loopback");
    expect(b.custom.capabilities).toEqual({ maxContextTokens: null, maxOptions: null, languages: null, primitives: null });
    expect(b.custom).toMatchObject({ offMachine: false, egress: "loopback (user-declared)" });
    expect(b.laya2.capabilities.maxContextTokens).toBe(1000);
    expect(b.fast).toMatchObject({ offMachine: true, egress: "cloud model" });
    expect(b.laya.managed).toEqual({ state: "stopped" });
  });
});

describe("E25 consumer list (5.7)", () => {
  it("always lists selftest; skips invalid files; flags missing fixtures", async () => {
    const fx = writeFixtures(3);
    registerConsumer("a:one", { fixtures: fx });
    registerConsumer("a:two", { fixtures: "/nope/missing.json" });
    const dir = join(stateDir(), "consumers");
    writeFileSync(join(dir, "broken.json"), "{nope");
    const list = (await req("GET", "/api/system-one/consumers")).body.consumers as any[];
    const ids = list.map((c) => c.id).sort();
    expect(ids).toEqual(["a:one", "a:two", "system-one:selftest"]);
    const self = list.find((c) => c.id === "system-one:selftest");
    expect(self.test.enabled).toBe(true);
    expect(self.test.cases).toBeGreaterThanOrEqual(20);
    expect(list.find((c) => c.id === "a:one").test).toEqual({ enabled: true, cases: 3 });
    expect(list.find((c) => c.id === "a:two").test).toMatchObject({ enabled: false, reason: "fixtures-missing" });
  });
});

describe("E26 eval report and case cap (5.8)", () => {
  for (const [n, sent] of [
    [499, 499],
    [500, 500],
    [501, 500],
  ] as const) {
    it(`${n} cases → ${sent} requests`, async () => {
      const f = await fake();
      f.respondWith((b) => ({ model: "jev-1.13.0", answers: { q: { noul: String(b.state).startsWith("yes") ? 0.8 : 0.3 } } }));
      registerConsumer("c", { fixtures: writeFixtures(n) });
      writeUser({ backends: { b: { kind: "http", url: f.url, model: "jev-1.13.0" } }, presets: { p: { chain: ["b"] } }, activePreset: "p" });
      const r = await req("POST", "/api/system-one/eval", { consumerId: "c", backendId: "b" });
      expect(r.status).toBe(200);
      expect(f.requests).toHaveLength(sent);
      const rep = r.body;
      expect(rep).toMatchObject({ cases: sent, failures: 0, model: "jev-1.13.0" });
      expect(rep.questions.q.accuracy).toBe(1);
      expect(rep.questions.q.auc).toBe(1);
      expect(rep.thresholds.q).toBeGreaterThan(0.3);
      expect(rep.thresholds.q).toBeLessThanOrEqual(0.8);
      expect(typeof rep.latencyMs.p50).toBe("number");
      expect(typeof rep.latencyMs.p90).toBe("number");
      expect(rep.estimatedCostUsd).toBeCloseTo((0.042 * rep.inputChars) / 4 / 1e6, 12);
    });
  }
});

describe("E27 eval egress + enforce confirmation (5.9)", () => {
  type Where = "loopback" | "off-machine";
  type Save = "shadow" | "enforce+confirm" | "enforce-no-confirm";

  /** Seed a consumer + one backend (loopback fake answering model `m-run`, or an intercepted remote) and run Test. */
  async function runEvalCell(where: Where, sw: boolean) {
    const f = await fake();
    f.respondWith((b) => autoAnswer(b, "m-run"));
    registerConsumer("c", { fixtures: writeFixtures(4) });
    const url = where === "loopback" ? f.url : "https://remote.example/v1/systemone";
    writeUser({ allowOffMachine: sw, backends: { b: { kind: "http", url, model: "x" } }, presets: { p: { chain: ["b"] } }, activePreset: "p" });
    return req("POST", "/api/system-one/eval", { consumerId: "c", backendId: "b" });
  }

  /** Save the run's calibration; returns the response and the file afterwards. */
  async function saveCell(save: Save, run: { body: any }) {
    const rev = (await req("GET", "/api/system-one/config")).body.revision;
    const mode = save === "shadow" ? "shadow" : "enforce";
    const model = run.body.model ?? "m-run";
    const res = await req("POST", "/api/system-one/calibration", {
      backendId: "b",
      consumerId: "c",
      mode,
      thresholds: run.body.thresholds,
      model,
      baseRevision: rev,
      ...(save === "enforce+confirm" ? { confirm: true } : {}),
    });
    return { res, mode, model, file: JSON.parse(readFileSync(userConfigPath(), "utf8")) };
  }

  const cells = (["loopback", "off-machine"] as Where[]).flatMap((where) =>
    [false, true].flatMap((sw) => (["shadow", "enforce+confirm", "enforce-no-confirm"] as Save[]).map((save) => ({ where, sw, save }))),
  );

  for (const { where, sw, save } of cells.filter((c) => c.where === "off-machine" && !c.sw)) {
    it(`${where} switch=${sw} save=${save} → refused before any request`, async () => {
      const icpt = interceptOffMachine();
      try {
        const r = await runEvalCell(where, sw);
        expect(r.status).toBe(409);
        expect(r.body.error).toBe("off-machine");
        expect(icpt.offMachine).toHaveLength(0);
      } finally {
        icpt.restore();
      }
    });
  }

  for (const { where, sw, save } of cells.filter((c) => !(c.where === "off-machine" && !c.sw))) {
    it(`${where} switch=${sw} save=${save}`, async () => {
      const icpt = interceptOffMachine();
      try {
        const r = await runEvalCell(where, sw);
        expect(r.status).toBe(200);
        const { res, mode, model, file } = await saveCell(save, r);
        const written = save !== "enforce-no-confirm";
        expect(res.status).toBe(written ? 200 : 400);
        // Written: exactly the one record; refused: no calibration key at all.
        expect(file.calibration).toEqual(written ? { "b::c": expect.objectContaining({ mode, model }) } : undefined);
        // A loopback run records the model string the backend actually answered with.
        if (written && where === "loopback") expect(file.calibration["b::c"].model).toBe("m-run");
      } finally {
        icpt.restore();
      }
    });
  }

  it("refuses a managed backend that is not ready, sending nothing", async () => {
    const f = await fake();
    registerConsumer("c", { fixtures: writeFixtures(2) });
    writeUser({ backends: { v: { kind: "managed", engine: "von", port: f.port } }, presets: { p: { chain: ["v"] } }, activePreset: "p" });
    managedState = "stopped";
    const r = await req("POST", "/api/system-one/eval", { consumerId: "c", backendId: "v" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("not-running");
    expect(f.connections).toBe(0);
    managedState = "ready";
    expect((await req("POST", "/api/system-one/eval", { consumerId: "c", backendId: "v" })).status).toBe(200);
  });
});
