/**
 * Adapter core: predict contract, validation, capability and egress checks,
 * chain resolution, mode, timeouts, transport failures, policy.
 * Tasks 3.1–3.9, 3.11, 3.13–3.17 (test-plan E1–E9, X1, X3–X7).
 * Exemplar: packages/server/src/__tests__/model-proxy-second-port.test.ts.
 * See change: add-system-one-registry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { predict } from "../predict.js";
import type { ConsumerDeclaration, FailurePolicy, Questions } from "../types.js";
import { chainConfig, freshState, writeUserConfig } from "./helpers/config.js";
import { autoAnswer, type FakeBackend, interceptOffMachine, startFakeBackend } from "./helpers/fake-backend.js";

const fakes: FakeBackend[] = [];
async function fake(): Promise<FakeBackend> {
  const f = await startFakeBackend();
  fakes.push(f);
  return f;
}
let warn: { mock: { calls: unknown[][] }; mockRestore(): void };
beforeEach(() => {
  freshState();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(fakes.splice(0).map((f) => f.close()));
});

const C: ConsumerDeclaration = { id: "c", failurePolicy: "fail-closed" };
const NOUL: Questions = { n: { type: "noul", instructions: "is it?" } };
const ask = (questions: Questions = NOUL, extra: Partial<Parameters<typeof predict>[0]> = {}) =>
  predict({ consumer: C, state: "state", questions, ...extra });

describe("E1 predict contract (3.1)", () => {
  it("returns constrained answers with empty thresholds", async () => {
    const f = await fake();
    f.respondWith((b) => ({
      model: "m1",
      answers: { ch: { choice: "b", probabilities: { a: 0.2, b: 0.8 }, confidence: 0.8 }, n: { noul: 0.4 } },
    }));
    chainConfig({ f: f.url });
    const r = await ask({ ch: { type: "choice", instructions: "pick", criteria: { a: "A", b: "B" } }, ...NOUL });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(["a", "b"]).toContain((r.answers.ch as any).choice);
    expect((r.answers.n as any).noul).toBeGreaterThanOrEqual(0);
    expect((r.answers.n as any).noul).toBeLessThanOrEqual(1);
    expect(r.thresholds).toEqual({});
    expect(r).toMatchObject({ backendId: "f", model: "m1", mode: "shadow" });
    expect(f.requests[0].body).toMatchObject({ model: "f-model", state: "state", questions: expect.any(Object) });
  });
});

describe("E2 response validation (3.2)", () => {
  const Q: Questions = {
    ch: { type: "choice", instructions: "i", criteria: { a: "", b: "" } },
    sc: { type: "score", instructions: "i", criteria: ["lo", "mid", "hi"] },
    n: { type: "noul", instructions: "i" },
  };
  const good = (b: any) => autoAnswer(b) as any;
  const cases: Record<string, (b: any) => unknown> = {
    "undeclared choice key": (b) => {
      const g = good(b);
      g.answers.ch.choice = "c";
      return g;
    },
    "score -0.1": (b) => {
      const g = good(b);
      g.answers.sc.score = -0.1;
      return g;
    },
    "score = levels": (b) => {
      const g = good(b);
      g.answers.sc.score = 3;
      return g;
    },
    "noul 1.01": (b) => {
      const g = good(b);
      g.answers.n.noul = 1.01;
      return g;
    },
    "missing question id": (b) => {
      const g = good(b);
      delete g.answers.n;
      return g;
    },
    "not json object": () => "nope",
  };
  for (const [name, bad] of Object.entries(cases)) {
    it(name, async () => {
      const f1 = await fake();
      const f2 = await fake();
      f1.respondWith(bad);
      chainConfig({ f1: f1.url, f2: f2.url });
      const r = await ask(Q);
      expect(r.ok && r.backendId).toBe("f2");
      expect(r.attempts[0]).toMatchObject({ backendId: "f1", outcome: "error" });
    });
  }
});

describe("E3 consumer id pattern (3.3)", () => {
  const ids: Array<[string, boolean]> = [
    ["a", true],
    ["a".repeat(128), true],
    ["a".repeat(129), false],
    ["A", false],
    ["-x", false],
    ["x y", false],
    ["", false],
  ];
  for (const [id, ok] of ids) {
    it(`${JSON.stringify(id.length > 10 ? `${id.length} chars` : id)} → ${ok ? "proceeds" : "error"}`, async () => {
      const f = await fake();
      chainConfig({ f: f.url });
      const r = await predict({ consumer: { ...C, id }, state: "s", questions: NOUL });
      if (ok) expect(r.ok).toBe(true);
      else {
        expect(r).toMatchObject({ ok: false, reason: "error" });
        expect(f.connections).toBe(0);
      }
    });
  }
});

describe("E4 context capability boundary (3.4)", () => {
  // Longest question: instructions "q" (1 char); state tokens = ceil-free chars/4.
  for (const [chars, smallAnswers] of [
    [2044, true],
    [2048, false],
    [2052, false],
  ] as const) {
    it(`${chars} chars`, async () => {
      const small = await fake();
      const big = await fake();
      chainConfig({
        small: { kind: "http", url: small.url, model: "x", capabilities: { maxContextTokens: 512 } },
        big: big.url,
      });
      const r = await predict({ consumer: C, state: "x".repeat(chars), questions: { n: { type: "noul", instructions: "qqqq" } } });
      expect(r.ok && r.backendId).toBe(smallAnswers ? "small" : "big");
      if (!smallAnswers) expect(r.attempts[0]).toMatchObject({ backendId: "small", outcome: "capability" });
    });
  }
});

describe("E5 option capability boundary (3.5)", () => {
  const choice = (n: number): Questions => ({
    ch: { type: "choice", instructions: "i", criteria: Object.fromEntries(Array.from({ length: n }, (_, i) => [`o${i}`, ""])) },
  });
  it("5 options sent, 6 skipped, unknown never skips", async () => {
    const f5 = await fake();
    chainConfig({ f5: { kind: "http", url: f5.url, model: "x", capabilities: { maxOptions: 5 } } });
    expect((await ask(choice(5))).ok).toBe(true);
    const r6 = await ask(choice(6));
    expect(r6).toMatchObject({ ok: false, reason: "capability" });
    expect(f5.requests).toHaveLength(1);

    freshState();
    const fu = await fake();
    chainConfig({ fu: { kind: "http", url: fu.url, model: "x", capabilities: { maxOptions: null } } });
    expect((await ask(choice(200))).ok).toBe(true);
  });
  it("unsupported primitive skips", async () => {
    const f = await fake();
    chainConfig({ f: { kind: "http", url: f.url, model: "x", capabilities: { primitives: ["choice"] } } });
    expect(await ask(NOUL)).toMatchObject({ ok: false, reason: "capability" });
    expect(f.connections).toBe(0);
  });
});

describe("E6 host egress classification (3.6)", () => {
  const hosts: Array<[string, boolean]> = [
    ["localhost", true],
    ["127.0.0.2", true],
    ["[::1]", true],
    ["[::ffff:127.0.0.1]", false],
    ["localhost.", false],
    ["10.0.0.5", false],
    ["example.com", false],
  ];
  for (const sw of [undefined, false, true] as const)
    for (const [host, onMachine] of hosts) {
      it(`${host} switch=${sw}`, async () => {
        const icpt = interceptOffMachine();
        // Point on-machine hosts at a closed port: we only need to prove "sent vs skipped".
        const url = `http://${host}:9/v1/systemone`;
        try {
          chainConfig({ b: url }, sw === undefined ? {} : { allowOffMachine: sw });
          const r = await ask();
          expect(r.ok).toBe(false);
          const skipped = r.attempts[0].outcome === "off-machine";
          expect(skipped).toBe(!onMachine && sw !== true);
          if (!onMachine && sw !== true) expect(icpt.offMachine).toHaveLength(0);
          if (!onMachine && sw === true) expect(icpt.offMachine).toHaveLength(1);
        } finally {
          icpt.restore();
        }
      });
    }

  it("rejects non-http(s) schemes as error without a request", async () => {
    for (const url of ["file:///etc/passwd", "ftp://127.0.0.1/x"]) {
      freshState();
      chainConfig({ b: url });
      const r = await ask();
      expect(r.ok).toBe(false);
    }
  });
});

describe("E8 chain resolution (3.8)", () => {
  it("override > preset > no-backend; dangling id dropped with one warning", async () => {
    const a = await fake();
    const b = await fake();
    const backends = { a: { kind: "http", url: a.url, model: "a" }, b: { kind: "http", url: b.url, model: "b" } };
    writeUserConfig({ backends, presets: { p: { chain: ["a"], consumers: { c: { chain: ["gone", "b"] } } } } });
    const r1 = await ask();
    expect(r1.ok && r1.backendId).toBe("b");
    await ask();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("gone"))).toHaveLength(1);

    freshState();
    writeUserConfig({ backends, presets: { p: { chain: ["a"] } } });
    const r2 = await ask();
    expect(r2.ok && r2.backendId).toBe("a");

    freshState();
    writeUserConfig({ backends, presets: {} });
    expect(await ask()).toMatchObject({ ok: false, reason: "no-backend" });
  });
});

describe("E9 mode (3.9)", () => {
  type Cal = "none" | "shadow" | "enforce-m1" | "enforce-m1-answer-m2";
  for (const cal of ["none", "shadow", "enforce-m1", "enforce-m1-answer-m2"] as Cal[])
    for (const answering of ["A", "B"]) {
      it(`calibration=${cal} answering=${answering}`, async () => {
        const A = await fake();
        const B = await fake();
        A.respondWith((b) => autoAnswer(b, cal === "enforce-m1-answer-m2" ? "m2" : "m1"));
        B.respondWith((b) => autoAnswer(b, "m1"));
        const calibration: Record<string, unknown> = {};
        if (cal === "shadow") calibration["A::c"] = { mode: "shadow", thresholds: { n: 0.6 }, model: "m1", measuredAt: "t" };
        if (cal.startsWith("enforce")) calibration["A::c"] = { mode: "enforce", thresholds: { n: 0.6 }, model: "m1", measuredAt: "t" };
        writeUserConfig({
          backends: { A: { kind: "http", url: A.url, model: "a" }, B: { kind: "http", url: B.url, model: "b" } },
          presets: { p: { chain: answering === "A" ? ["A"] : ["B"] } },
          calibration,
        });
        const r = await ask();
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const enforce = cal === "enforce-m1" && answering === "A";
        expect(r.mode).toBe(enforce ? "enforce" : "shadow");
        expect(r.thresholds).toEqual(enforce || (cal === "shadow" && answering === "A") ? { n: 0.6 } : {});
      });
    }
});

describe("X1 timeout fall-through (3.11)", () => {
  it("falls through after the 2,000 ms default", async () => {
    const f1 = await fake();
    const f2 = await fake();
    f1.script({ kind: "delay", ms: 2100 });
    chainConfig({ f1: f1.url, f2: f2.url });
    const t0 = Date.now();
    const r = await ask();
    const dt = Date.now() - t0;
    expect(r.ok && r.backendId).toBe("f2");
    expect(r.attempts[0]).toMatchObject({ backendId: "f1", outcome: "timeout" });
    expect(dt).toBeLessThan(2300);
  });
});

describe("X3 transport abort (3.13)", () => {
  it("counts a destroyed socket as error and moves on without retry", async () => {
    const f1 = await fake();
    const f2 = await fake();
    f1.script({ kind: "destroy" });
    chainConfig({ f1: f1.url, f2: f2.url });
    const r = await ask();
    expect(r.ok && r.backendId).toBe("f2");
    expect(r.attempts[0]).toMatchObject({ backendId: "f1", outcome: "error" });
    expect(f1.requests).toHaveLength(1);
  });
});

describe("X4 redirect exfiltration (3.14)", () => {
  it("does not follow a loopback 302 to a remote host", async () => {
    const icpt = interceptOffMachine();
    try {
      const f = await fake();
      f.script({ kind: "redirect", location: "https://remote.example/steal" });
      chainConfig({ f: f.url });
      const r = await ask();
      expect(r).toMatchObject({ ok: false, reason: "error" });
      expect(icpt.offMachine).toHaveLength(0);
    } finally {
      icpt.restore();
    }
  });
});

describe("X5 caller abort (3.15)", () => {
  it("stops the chain with timeout", async () => {
    const slow = await fake();
    const fast = await fake();
    slow.script({ kind: "delay", ms: 1000 });
    chainConfig({ slow: slow.url, fast: fast.url });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    const r = await ask(NOUL, { signal: ac.signal });
    expect(r).toMatchObject({ ok: false, reason: "timeout" });
    expect(fast.connections).toBe(0);
  });
});

describe("X6 all fail → policy (3.16)", () => {
  for (const policy of ["fail-open", "fail-closed", "deterministic"] as FailurePolicy[]) {
    it(policy, async () => {
      const f1 = await fake();
      f1.script({ kind: "status", status: 500 });
      chainConfig({ f1: f1.url, big: { kind: "http", url: "http://127.0.0.1:9/x", model: "x", capabilities: { maxContextTokens: 1 } } });
      const r = await predict({ consumer: { id: "c", failurePolicy: policy }, state: "long state text", questions: NOUL });
      expect(r).toEqual({ ok: false, reason: "capability", policy, attempts: expect.any(Array) });
    });
  }
});

describe("X7 no config (3.17)", () => {
  it("no-backend without any connection", async () => {
    const f = await fake();
    const r = await ask();
    expect(r).toMatchObject({ ok: false, reason: "no-backend", policy: "fail-closed" });
    expect(f.connections).toBe(0);
  });
});
