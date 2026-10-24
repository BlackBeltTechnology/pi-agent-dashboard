/**
 * POST/GET /api/csp-violations — authenticated, rate-limited, counters only
 * (change: harden-client-sinks, design D8, test-plan #E24).
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCspViolationRoutes } from "../routes/csp-violations-routes.js";

let now = 1_000_000;
let app: FastifyInstance;
const logged: string[] = [];

const recordShadow = vi.fn();

async function build() {
  app = Fastify({ logger: false });
  recordShadow.mockClear();
  registerCspViolationRoutes(app, {
    recordShadow,
    // Stand-in for the network guard: only requests carrying x-auth are admitted.
    networkGuard: async (req, reply) => {
      if (!req.headers["x-auth"]) await reply.code(401).send({ success: false, error: "unauthorized" });
    },
    principalOf: (req) => String(req.headers["x-auth"]),
    now: () => now,
    log: { warn: (msg: string) => logged.push(msg) },
  });
  await app.ready();
  return app;
}

afterEach(async () => {
  await app?.close();
  logged.length = 0;
});

const entry = (sink = "Element innerHTML") => ({ directive: "require-trusted-types-for", sink, source: "https://h/a.js:1", count: 1 });
const post = (body: unknown, who: string | null = "alice") =>
  app.inject({
    method: "POST",
    url: "/api/csp-violations",
    headers: { "content-type": "application/json", ...(who ? { "x-auth": who } : {}) },
    payload: typeof body === "string" ? body : JSON.stringify(body),
  });
const total = async () => {
  const res = await app.inject({ method: "GET", url: "/api/csp-violations", headers: { "x-auth": "op" } });
  return (res.json().counters as { count: number }[]).reduce((n, c) => n + c.count, 0);
};

describe("POST /api/csp-violations (#E24)", () => {
  it("burst: 3 accepted, the 4th → 429 with counters unchanged", async () => {
    await build();
    for (let i = 0; i < 3; i++) expect((await post({ entries: [entry()] })).statusCode).toBe(200);
    const before = await total();
    expect((await post({ entries: [entry()] })).statusCode).toBe(429);
    expect(await total()).toBe(before);
  });

  it("per minute: 12 accepted, the 13th within 60 s → 429", async () => {
    await build();
    for (let i = 0; i < 12; i++) {
      expect((await post({ entries: [entry()] })).statusCode, `post ${i + 1}`).toBe(200);
      now += 5_000 - 100;
    }
    const before = await total();
    expect((await post({ entries: [entry()] })).statusCode).toBe(429);
    expect(await total()).toBe(before);
  });

  it("the limit is per principal", async () => {
    await build();
    for (let i = 0; i < 3; i++) await post({ entries: [entry()] }, "alice");
    expect((await post({ entries: [entry()] }, "bob")).statusCode).toBe(200);
  });

  it("8192 B accepted, 8193 B rejected and not logged", async () => {
    await build();
    const pad = (n: number) => {
      const base = JSON.stringify({ entries: [entry()], pad: "" });
      return JSON.stringify({ entries: [entry()], pad: "x".repeat(n - base.length) });
    };
    const ok = pad(8192);
    expect(Buffer.byteLength(ok)).toBe(8192);
    expect((await post(ok)).statusCode).toBe(200);
    const big = pad(8193);
    expect(Buffer.byteLength(big)).toBe(8193);
    const res = await post(big, "bob");
    expect(res.statusCode).toBe(413);
    expect(logged.join("\n")).not.toContain("xxxx");
  });

  it("a `sample` field is dropped, never stored", async () => {
    await build();
    const res = await post({ entries: [{ ...entry(), sample: "secret-markup" }] });
    expect([200, 400]).toContain(res.statusCode);
    const get = await app.inject({ method: "GET", url: "/api/csp-violations", headers: { "x-auth": "op" } });
    expect(get.body).not.toContain("secret-markup");
  });

  it("malformed body → 400, not logged", async () => {
    await build();
    expect((await post({ entries: "nope-secret" })).statusCode).toBe(400);
    expect((await post({ entries: [{ directive: 1 }] })).statusCode).toBe(400);
    expect(logged.join("\n")).not.toContain("nope-secret");
  });

  it("unauthenticated → rejected, no counter change", async () => {
    await build();
    const res = await post({ entries: [entry()] }, null);
    expect(res.statusCode).toBe(401);
    expect(await total()).toBe(0);
  });

  it("GET returns aggregated counters (directive, sink, source, count) and overflow", async () => {
    await build();
    await post({ entries: [entry(), { ...entry(), count: 4 }], overflow: 2 });
    const res = await app.inject({ method: "GET", url: "/api/csp-violations", headers: { "x-auth": "op" } });
    const counters = res.json().counters as { directive: string; sink: string; source: string; count: number }[];
    expect(counters.find((c) => c.sink === "Element innerHTML")?.count).toBe(5);
    expect(counters.find((c) => c.sink === "overflow")?.count).toBe(2);
  });
});

const shadowEntry = (sink = "would-block-script-url", source = "https://h/a.js:1") => ({ directive: "trusted-types-shadow", sink, source, count: 1 });

describe("shadow aggregate (#E15, #E16, #E17; change: add-trusted-types-shadow-enforce)", () => {
  it("E15: known keys feed recordShadow, unknown are ignored, record() paths untouched; detail-only → no call", async () => {
    await build();
    const res = await post({ entries: [shadowEntry()], shadow: { "would-block-script-url": 2, "would-foo": 3 } });
    expect(res.statusCode).toBe(200);
    expect(recordShadow).toHaveBeenCalledTimes(1);
    expect(recordShadow).toHaveBeenCalledWith("would-block-script-url", 2);
    await post({ entries: [shadowEntry()] }, "bob");
    expect(recordShadow).toHaveBeenCalledTimes(1);
  });

  it("E15: a report with only a shadow aggregate and no entries is accepted", async () => {
    await build();
    expect((await post({ entries: [], shadow: { "would-alter-html": 1 } })).statusCode).toBe(200);
    expect(recordShadow).toHaveBeenCalledWith("would-alter-html", 1);
  });

  it("E16: valid counts 1 and 1,000,000 pass", async () => {
    await build();
    expect((await post({ entries: [], shadow: { "would-block-script": 1 } }, "a")).statusCode).toBe(200);
    expect((await post({ entries: [], shadow: { "would-block-script": 1_000_000 } }, "b")).statusCode).toBe(200);
    expect(recordShadow).toHaveBeenCalledTimes(2);
  });

  it.each([[0], [1_000_001], [1.5], ["2"], [-1]])("E16: invalid count %j → 400, nothing recorded", async (bad) => {
    await build();
    expect((await post({ entries: [], shadow: { "would-alter-html": bad } })).statusCode).toBe(400);
    expect(recordShadow).not.toHaveBeenCalled();
  });

  it.each([[[]], ["x"], [5], [null]])("E16: non-object shadow %j → 400, nothing recorded", async (bad) => {
    await build();
    expect((await post({ entries: [], shadow: bad })).statusCode).toBe(400);
    expect(recordShadow).not.toHaveBeenCalled();
  });

  it("E16: a burst-excess report → 429 and recordShadow is not called for it", async () => {
    await build();
    for (let i = 0; i < 3; i++) await post({ entries: [], shadow: { "would-alter-html": 1 } });
    recordShadow.mockClear();
    expect((await post({ entries: [], shadow: { "would-alter-html": 1 } })).statusCode).toBe(429);
    expect(recordShadow).not.toHaveBeenCalled();
  });

  it("E17: 501 distinct shadow-detail entries never evict a violation counter", async () => {
    await build();
    await post({ entries: [entry("Element innerHTML")] }, "v");
    for (let i = 0; i < 501; i += 50) {
      const entries = Array.from({ length: Math.min(50, 501 - i) }, (_, j) => shadowEntry("would-alter-html", `https://h/s${i + j}.js:1`));
      expect((await post({ entries }, `p${i}`)).statusCode).toBe(200);
    }
    const res = await app.inject({ method: "GET", url: "/api/csp-violations", headers: { "x-auth": "op" } });
    const counters = res.json().counters as { sink: string; directive: string }[];
    expect(counters.some((c) => c.sink === "Element innerHTML")).toBe(true);
    expect(counters.filter((c) => c.directive === "trusted-types-shadow")).toHaveLength(500);
  });
});
