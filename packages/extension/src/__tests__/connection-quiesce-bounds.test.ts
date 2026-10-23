/**
 * Auto-start quiesce bounds (B21): the bound lives INSIDE `pauseAutoStart`, so
 * the `server_restarting` handler, the inbound dispatch path and a direct call
 * all yield the same verdict.
 *
 * Covers test-plan BE1–BE7, BE9, BP5.
 * See change: harden-bridge-inbound-and-discovery (D17).
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../connection.js";
import { type AutoStartDeps, autoStartServer } from "../server-auto-start.js";
import { makeStubInstance } from "./helpers/bridge-instance-stub.js";

vi.mock("../bridge.js", () => {
  throw new Error("bridge.ts (the entry point) was loaded by an extracted handler module");
});
vi.mock("../provider-register.js", () => ({
  reloadProviders: vi.fn(async () => ({ added: [], removed: [], changed: [] })),
  buildProviderCatalogue: vi.fn(() => []),
  toModelInfo: vi.fn((m: unknown) => m),
}));
vi.mock("../model-refresh.js", () => ({ refreshAfterCredentialsReload: vi.fn(async () => {}) }));

const dispatchModule = import("../bridge-handlers/dispatch.js");

const T0 = 1_000_000;
let now = T0;

function makeCm(): ConnectionManager {
  now = T0; // every pause is issued at T0; assertions are offsets from it
  return new ConnectionManager({
    url: "ws://localhost:9999",
    WebSocketImpl: class FakeWS { constructor() { /* never connects */ } onopen?: any; onmessage?: any; onclose?: any; onerror?: any; close() { /* no-op */ } },
    watchdogTimeout: 0,
  });
}

/** Suppression verdict `t` ms after the pause was issued (fractional ok). */
const suppressedAt = (cm: ConnectionManager, t: number): boolean => {
  now = T0 + t;
  return cm.shouldSuppressAutoStart();
};

function makeDeps(cm: ConnectionManager): AutoStartDeps {
  return {
    discoverDashboard: vi.fn().mockResolvedValue([]),
    isDashboardRunning: vi.fn().mockResolvedValue({ running: false }),
    launchServer: vi.fn().mockResolvedValue({ success: true, message: "ok" }),
    notify: vi.fn(),
    resolveCliPath: () => join(tmpdir(), "host-install", "packages", "server", "src", "cli.ts"),
    lockDir: mkdtempSync(join(tmpdir(), "auto-start-lock-")),
    lossPollIntervalMs: 5,
    shouldSuppressAutoStart: () => cm.shouldSuppressAutoStart(),
  };
}
const baseConfig = { piPort: 9999, port: 8000, autoStart: true };

beforeEach(() => {
  now = T0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => vi.restoreAllMocks());

async function viaDispatch(cm: ConnectionManager, msg: Record<string, unknown>): Promise<void> {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const { inst } = makeStubInstance({ connection: cm as never });
  (await dispatchModule).handleInboundMessage(inst, { type: "server_restarting", reason: "restart", ...msg });
}

describe("BE1: invalid quiesceMs is ignored", () => {
  const invalid: Array<[string, Record<string, unknown>]> = [
    ["0", { quiesceMs: 0 }],
    ["-1", { quiesceMs: -1 }],
    ["-0.5", { quiesceMs: -0.5 }],
    ["NaN", { quiesceMs: Number.NaN }],
    ['"5000"', { quiesceMs: "5000" }],
    ["null", { quiesceMs: null }],
    ["absent", {}],
    ["{}", { quiesceMs: {} }],
    ["true", { quiesceMs: true }],
  ];
  for (const [label, msg] of invalid) {
    it(`${label}: no pause, launchServer called once, existing pause not extended`, async () => {
      const cm = makeCm();
      await viaDispatch(cm, msg);
      const deps = makeDeps(cm);
      now = T0 + 1;
      await autoStartServer(baseConfig, deps);
      expect(deps.launchServer).toHaveBeenCalledTimes(1);

      // a pre-set 3000 ms pause keeps its original deadline
      const cm2 = makeCm();
      cm2.pauseAutoStart(3000);
      await viaDispatch(cm2, msg);
      expect(suppressedAt(cm2, 3000)).toBe(true);
      expect(suppressedAt(cm2, 3001)).toBe(false);
    });
  }
});

describe("BE2: quiesceMs 5000 — inclusive floor", () => {
  it("suppressed at 4999 and 5000, executes at 5001; discovery + health keep running", async () => {
    const cm = makeCm();
    await viaDispatch(cm, { quiesceMs: 5000 });
    const deps = makeDeps(cm);
    const spies: Array<[number, boolean]> = [[4999, true], [5000, true], [5001, false]];
    for (const [t, suppressed] of spies) {
      (deps.launchServer as ReturnType<typeof vi.fn>).mockClear();
      (deps.discoverDashboard as ReturnType<typeof vi.fn>).mockClear();
      now = T0 + t;
      await autoStartServer(baseConfig, deps);
      expect((deps.launchServer as ReturnType<typeof vi.fn>).mock.calls.length).toBe(suppressed ? 0 : 1);
      expect((deps.discoverDashboard as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    }
  });
});

describe("BE3: non-integer quiesce rounds UP", () => {
  it("5000.1 / 5000.2 → 5001 ms, suppressed at 5000.5", () => {
    for (const v of [5000.1, 5000.2]) {
      const cm = makeCm();
      expect(cm.pauseAutoStart(v)).toBe(5001);
      expect(suppressedAt(cm, 5000.5)).toBe(true);
      expect(suppressedAt(cm, 5001.5)).toBe(false);
    }
  });
  it("0.2 → 1 ms (accepted, not dropped)", () => {
    const cm = makeCm();
    expect(cm.pauseAutoStart(0.2)).toBe(1);
    expect(suppressedAt(cm, 0.5)).toBe(true);
    expect(suppressedAt(cm, 1.5)).toBe(false);
  });
  it("4999.9 → 5000 ms", () => {
    const cm = makeCm();
    expect(cm.pauseAutoStart(4999.9)).toBe(5000);
    expect(suppressedAt(cm, 4999.95)).toBe(true);
    expect(suppressedAt(cm, 5000.5)).toBe(false);
  });
});

describe("BE4: shutdown-sized quiesce honoured in full", () => {
  it("60000 → suppressed at 59 s, executes at 60001 ms", async () => {
    const cm = makeCm();
    await viaDispatch(cm, { reason: "shutdown", quiesceMs: 60000 });
    expect(suppressedAt(cm, 59000)).toBe(true);
    expect(suppressedAt(cm, 60000)).toBe(true);
    expect(suppressedAt(cm, 60001)).toBe(false);
  });
});

describe("BE5: 120000 is the maximum honoured", () => {
  for (const v of [120000, 120001]) {
    it(`${v}: suppressed at 119999, executes at 120001`, () => {
      const cm = makeCm();
      cm.pauseAutoStart(v);
      expect(suppressedAt(cm, 119999)).toBe(true);
      expect(suppressedAt(cm, 120001)).toBe(false);
    });
  }
});

describe("BE6: absurdly large / Infinite quiesce is clamped, not ignored", () => {
  for (const v of [1e15, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER, 1e308]) {
    it(`${String(v)}: suppressed at 119 s, spawn executes at 121 s`, async () => {
      const cm = makeCm();
      cm.pauseAutoStart(v);
      expect(suppressedAt(cm, 119_000)).toBe(true);
      const deps = makeDeps(cm);
      now = T0 + 121_000;
      await autoStartServer(baseConfig, deps);
      expect(deps.launchServer).toHaveBeenCalledTimes(1);
    });
  }
});

describe("BE7: the bound applies regardless of caller", () => {
  const values: unknown[] = [0, -1, Number.NaN, "5000", 5000, 5000.1, 120000, 120001, 1e15, Number.POSITIVE_INFINITY];
  type Caller = (cm: ConnectionManager, v: unknown) => Promise<void>;
  const callers: Array<[string, Caller]> = [
    ["server_restarting handler", async (cm, v) => viaDispatch(cm, { quiesceMs: v })],
    ["inbound dispatch (shutdown)", async (cm, v) => viaDispatch(cm, { reason: "shutdown", quiesceMs: v })],
    ["direct pauseAutoStart", async (cm, v) => { cm.pauseAutoStart(v as number); }],
  ];
  const verdict = async (call: Caller, v: unknown) => {
    const cm = makeCm();
    await call(cm, v);
    return [suppressedAt(cm, 1), suppressedAt(cm, 121_000)];
  };
  for (const v of values) {
    it(`value ${String(v)}: all 3 callers agree; nothing holds past 120000 ms`, async () => {
      const verdicts = await Promise.all(callers.map(([, c]) => verdict(c, v)));
      expect(verdicts[1]).toEqual(verdicts[0]);
      expect(verdicts[2]).toEqual(verdicts[0]);
      expect(verdicts[0][1]).toBe(false);
      const invalid = typeof v !== "number" || Number.isNaN(v) || v <= 0;
      expect(verdicts[0][0]).toBe(!invalid);
    });
  }
});

describe("BE9: later pause never shortens an active one", () => {
  it("A=60000 then B=5000: A's deadline kept", () => {
    const cm = makeCm();
    now = T0 + 1000;
    cm.pauseAutoStart(60000);
    cm.pauseAutoStart(5000);
    now = T0 + 10_000;
    expect(cm.shouldSuppressAutoStart()).toBe(true);
    now = T0 + 61_000;
    expect(cm.shouldSuppressAutoStart()).toBe(true);
    now = T0 + 61_001;
    expect(cm.shouldSuppressAutoStart()).toBe(false);
  });
  it("B=5000 at 1 s then A=60000 at 2 s: deadline extended to 62 s", () => {
    const cm = makeCm();
    now = T0 + 1000;
    cm.pauseAutoStart(5000);
    now = T0 + 2000;
    cm.pauseAutoStart(60000);
    now = T0 + 62_000;
    expect(cm.shouldSuppressAutoStart()).toBe(true);
    now = T0 + 62_001;
    expect(cm.shouldSuppressAutoStart()).toBe(false);
  });
});

describe("BP5: pause is a deadline, never a timer", () => {
  it("1000 pauses with hostile values schedule no timer of any length", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const cm = makeCm();
    const before = setTimeoutSpy.mock.calls.length;
    const values = [1e15, Number.POSITIVE_INFINITY, 120001, 5000.1];
    for (let i = 0; i < 1000; i++) cm.pauseAutoStart(values[i % values.length]);
    const scheduled = setTimeoutSpy.mock.calls.slice(before).map((c) => c[1] as number);
    expect(scheduled.filter((d) => d > 120_000)).toEqual([]);
    expect(scheduled.length).toBeLessThanOrEqual(1);
  });
});
