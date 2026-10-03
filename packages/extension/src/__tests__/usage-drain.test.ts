/**
 * Bridge usage drain: cursor, baseline + seed from one snapshot, allowlist,
 * drain-point handlers and shutdown ordering. Real `UsageDrain`,
 * `handleSessionChange` and `sendStateSync` against a fake session manager and
 * a recording connection (harness: session-sync.test.ts,
 * bridge-resume-disconnect.test.ts).
 *
 * test-plan #E7 #E8 #E10 #E11 #E12 #E13 #E14 #E15 #E16 #P1.
 * See change: count-non-message-usage.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSessionChange, sendStateSync } from "../session-sync.js";
import {
  UsageDrain,
  drainUsageAndSend,
  makeCacheWarmingDecisionHandler,
  sendShutdownUsageThenUnregister,
} from "../usage-drain.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const usage = (u: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number; cost?: number }) => ({
  input: u.input ?? 0,
  output: u.output ?? 0,
  cacheRead: u.cacheRead ?? 0,
  cacheWrite: u.cacheWrite ?? 0,
  totalTokens: u.totalTokens ?? 0,
  cost: { total: u.cost ?? 0 },
});

/** Fake pi session manager: `getEntries()` returns a copy, like pi's. */
function makeSm(sessionId: string, initial: any[] = []) {
  const entries = [...initial];
  let file: string | undefined;
  return {
    entries,
    getSessionId: () => sessionId,
    getEntries: () => entries.slice(),
    getBranch: () => entries.slice(),
    getSessionFile: () => file,
    getSessionDir: () => undefined,
    setFile: (f: string) => { file = f; },
    append: (e: any) => { entries.push(e); },
  };
}

const usageEntry = (id: string, cacheRead = 50000, cost = 0.015) => ({
  type: "usage", id, kind: "cache_warm", provider: "anthropic", model: "claude-sonnet-4", usage: usage({ cacheRead, cost }),
});

function makeBc(sm: ReturnType<typeof makeSm>, cwd: string) {
  const sent: any[] = [];
  const bc = {
    pi: { getSessionName: () => "n", getCommands: () => [], getThinkingLevel: () => undefined },
    connection: { send: (m: any) => sent.push(m) },
    sessionId: sm.getSessionId(),
    attachedChange: null,
    cachedCtx: { sessionManager: sm, cwd },
    cachedModelRegistry: null,
    cachedHasUI: false,
    hasRegisteredOnce: true,
    dashboardSpawned: false,
  } as any;
  return { bc, sent };
}

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "usage-drain-")); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe("#E7 drain allowlist", () => {
  it("forwards usage / compaction / branch_summary with usage only; provider/model only on usage entries", () => {
    const sm = makeSm("A", [{ type: "message", id: "h1", message: { role: "user", content: "x" } }]);
    const d = new UsageDrain();
    d.baseline(sm);
    sm.append(usageEntry("e1"));
    sm.append({ type: "compaction", id: "e2", summary: "s", firstKeptEntryId: "h1", tokensBefore: 1, usage: usage({ input: 40000 }) });
    sm.append({ type: "branch_summary", id: "e3", fromId: "h1", summary: "b", usage: usage({ input: 700 }) });
    sm.append({ type: "compaction", id: "e4", summary: "s", firstKeptEntryId: "h1", tokensBefore: 1 });
    sm.append({ type: "message", id: "e5", message: { role: "toolResult", toolCallId: "t", content: [], usage: usage({ input: 300 }) } });
    const out = d.drain(sm);
    expect(out.map((m) => m.kind)).toEqual(["usage:cache_warm", "compaction", "branch_summary"]);
    expect(out[0]).toMatchObject({ type: "usage_recorded", sessionId: "A", provider: "anthropic", model: "claude-sonnet-4", entryId: "e1" });
    expect(out[1]).not.toHaveProperty("provider");
    expect(out[1]).not.toHaveProperty("model");
    expect(out[2]).not.toHaveProperty("provider");
    expect(out.some((m) => m.entryId === "e5")).toBe(false);
    // Advanced: a second drain forwards nothing.
    expect(d.drain(sm)).toEqual([]);
  });
});

describe("#E8 baseline + seed share one snapshot (init / reload)", () => {
  it("seed = full totals of every kind; nothing in the snapshot is forwarded", () => {
    const sm = makeSm("A", [
      { type: "message", id: "1", message: { role: "user", content: "x" } },
      { type: "message", id: "2", message: { role: "assistant", content: [], usage: usage({ input: 1000, output: 100, cacheRead: 5, cost: 0.01 }) } },
      usageEntry("3", 50000, 0.015),
      { type: "compaction", id: "4", summary: "s", firstKeptEntryId: "2", tokensBefore: 1, usage: usage({ input: 40000, cacheWrite: 9, cost: 0.12 }) },
      { type: "message", id: "5", message: { role: "user", content: "y" } },
    ]);
    const d = new UsageDrain();
    const seed = d.baseline(sm);
    expect(seed.tokensIn).toBe(41000);
    expect(seed.tokensOut).toBe(100);
    expect(seed.cacheRead).toBe(50005);
    expect(seed.cacheWrite).toBe(9);
    expect(seed.cost).toBeCloseTo(0.145, 10);
    expect(d.drain(sm)).toEqual([]);
    expect(d.getCursor()).toEqual({ sessionId: "A", lastEntryId: "5" });
  });

  it("bridge.ts baselines in session_start before any register and sends usageSeed on the init register", () => {
    const src = fs.readFileSync(path.join(here, "..", "bridge.ts"), "utf8");
    const start = src.indexOf('pi.on("session_start"');
    const baseline = src.indexOf("usageDrain.baseline(ctx.sessionManager)", start);
    const change = src.indexOf("handleSessionChange(ctx, usageSeed)", start);
    const initRegister = src.indexOf('type: "session_register"', start);
    const seedSpread = src.indexOf("...(usageSeed ? { usageSeed } : {})", start);
    expect(baseline).toBeGreaterThan(start);
    expect(change).toBeGreaterThan(baseline);
    expect(initRegister).toBeGreaterThan(baseline);
    expect(seedSpread).toBeGreaterThan(initRegister);
  });
});

describe("#E10 lazy session file is not a session switch", () => {
  it("every usage entry forwarded once across the file appearing", () => {
    const sm = makeSm("A");
    const d = new UsageDrain();
    d.baseline(sm);
    sm.append(usageEntry("e1"));
    const first = d.drain(sm);
    sm.setFile(path.join(tmp, "a.jsonl"));
    sm.append(usageEntry("e2"));
    const second = d.drain(sm);
    expect([...first, ...second].map((m) => m.entryId)).toEqual(["e1", "e2"]);
  });
});

describe("#E11 / #E12 fork: drain outgoing, then baseline incoming", () => {
  it("A's usage before A's unregister; B seeded from its snapshot; copied entries not forwarded; later B usage forwarded once", () => {
    const smA = makeSm("A", [{ type: "message", id: "h1", message: { role: "user", content: "x" } }]);
    const d = new UsageDrain();
    d.baseline(smA);
    smA.append(usageEntry("a-late", 100, 0.001)); // undrained when the fork happens

    const { bc, sent } = makeBc(smA, tmp);
    const send = (m: any) => bc.connection.send(m);
    // Outgoing runtime: session_shutdown{reason:"fork"}.
    sendShutdownUsageThenUnregister(
      () => drainUsageAndSend(d, smA, send),
      () => send({ type: "session_unregister", sessionId: "A" }),
    );

    // Incoming runtime: session_start{reason:"fork"} — copied history.
    const smB = makeSm("B", [...smA.entries]);
    const seed = d.baseline(smB);
    handleSessionChange(bc, { sessionManager: smB, cwd: tmp }, () => [], seed);

    const types = sent.map((m) => `${m.type}:${m.sessionId}`);
    const aUsage = types.indexOf("usage_recorded:A");
    const aUnreg = types.indexOf("session_unregister:A");
    expect(aUsage).toBeGreaterThanOrEqual(0);
    expect(aUsage).toBeLessThan(aUnreg);
    const bReg = sent.find((m) => m.type === "session_register" && m.sessionId === "B");
    expect(bReg.usageSeed).toMatchObject({ cacheRead: 100 });
    expect(bReg.usageSeed.cost).toBeCloseTo(0.001, 10);
    expect(sent.filter((m) => m.type === "usage_recorded" && m.sessionId === "B")).toEqual([]);

    // #E12 — usage right after the fork, drained at agent_settled.
    smB.append(usageEntry("b1"));
    drainUsageAndSend(d, smB, send);
    drainUsageAndSend(d, smB, send);
    const bUsage = sent.filter((m) => m.type === "usage_recorded" && m.sessionId === "B");
    expect(bUsage.map((m) => m.entryId)).toEqual(["b1"]);
  });
});

describe("#E13 vanished cursor id re-baselines", () => {
  it("forwards nothing, moves the cursor to the snapshot end, resends no seed", () => {
    const sm = makeSm("A", [usageEntry("old")]);
    const d = new UsageDrain();
    d.baseline(sm);
    sm.entries.length = 0;
    sm.append(usageEntry("x1"));
    sm.append(usageEntry("x2"));
    const sent: any[] = [];
    drainUsageAndSend(d, sm, (m) => sent.push(m));
    expect(sent).toEqual([]);
    expect(d.getCursor()).toEqual({ sessionId: "A", lastEntryId: "x2" });
    sm.append(usageEntry("x3"));
    expect(d.drain(sm).map((m) => m.entryId)).toEqual(["x3"]);
  });
});

describe("#E14 reconnect keeps the cursor", () => {
  it("usage recorded while disconnected is forwarded exactly once after reconnect; reattach register carries no seed", () => {
    const sm = makeSm("A", [{ type: "message", id: "h1", message: { role: "user", content: "x" } }]);
    const d = new UsageDrain();
    d.baseline(sm);
    const { bc, sent } = makeBc(sm, tmp);
    sm.append(usageEntry("while-down")); // connection down
    sendStateSync(bc, () => []); // onReconnect → reattach register
    drainUsageAndSend(d, sm, (m) => bc.connection.send(m));
    drainUsageAndSend(d, sm, (m) => bc.connection.send(m));
    const reg = sent.find((m) => m.type === "session_register");
    expect(reg.registerReason).toBe("reattach");
    expect(reg).not.toHaveProperty("usageSeed");
    expect(sent.filter((m) => m.type === "usage_recorded").map((m) => m.entryId)).toEqual(["while-down"]);
  });
});

describe("#E15 shutdown drain precedes unregister", () => {
  it("usage_recorded is sent before session_unregister on quit", () => {
    const sm = makeSm("A");
    const d = new UsageDrain();
    d.baseline(sm);
    sm.append(usageEntry("q1"));
    const sent: any[] = [];
    sendShutdownUsageThenUnregister(
      () => drainUsageAndSend(d, sm, (m) => sent.push(m)),
      () => sent.push({ type: "session_unregister", sessionId: "A" }),
    );
    expect(sent.map((m) => m.type)).toEqual(["usage_recorded", "session_unregister"]);
  });

  it("a throwing drain still sends session_unregister", () => {
    const sent: string[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendShutdownUsageThenUnregister(
      () => { throw new Error("boom"); },
      () => sent.push("session_unregister"),
    );
    expect(sent).toEqual(["session_unregister"]);
  });

  it("bridge.ts session_shutdown routes its unregister through the drain-first helper", () => {
    const src = fs.readFileSync(path.join(here, "..", "bridge.ts"), "utf8");
    const start = src.indexOf('pi.on("session_shutdown"');
    const end = src.indexOf("connection.disconnect()", start);
    const body = src.slice(start, end);
    expect(body).toContain("sendShutdownUsageThenUnregister(");
    expect(body.match(/type: "session_unregister"/g)).toHaveLength(1);
    expect(body.indexOf("drainUsage(ctx)")).toBeLessThan(body.indexOf('type: "session_unregister"'));
  });
});

describe("#E16 observe-only cache_warming_decision", () => {
  it("returns undefined and never throws when the drain throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = makeCacheWarmingDecisionHandler(() => { throw new Error("drain failed"); });
    let result: unknown = "unset";
    expect(() => { result = handler({ type: "cache_warming_decision", action: "warm" }, {}); }).not.toThrow();
    expect(result).toBeUndefined();
  });

  it("a throwing session manager inside drainUsageAndSend is contained", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = new UsageDrain();
    const bad = { getSessionId: () => "A", getEntries: () => { throw new Error("stale ctx"); } };
    expect(() => drainUsageAndSend(d, bad, () => {})).not.toThrow();
  });

  it("drains as usage_recorded only; bridge.ts never forwards cache_warming_decision as event_forward", () => {
    const sm = makeSm("A");
    const d = new UsageDrain();
    d.baseline(sm);
    sm.append(usageEntry("w1"));
    const sent: any[] = [];
    const handler = makeCacheWarmingDecisionHandler(() => drainUsageAndSend(d, sm, (m) => sent.push(m)));
    expect(handler({ action: "warm" }, {})).toBeUndefined();
    expect(sent.map((m) => m.type)).toEqual(["usage_recorded"]);

    const src = fs.readFileSync(path.join(here, "..", "bridge.ts"), "utf8");
    const lists = src.slice(src.indexOf("const enrichedEventTypes = ["), src.indexOf("// Excluded from subscription"));
    expect(lists).not.toContain('"cache_warming_decision"');
    expect(src).toContain('pi.on("cache_warming_decision", makeCacheWarmingDecisionHandler(');
  });
});

describe("review B1: a failed send does not skip usage", () => {
  it("the cursor advances only past entries handed off; the failed one and the rest retry next drain", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sm = makeSm("A");
    const d = new UsageDrain();
    d.baseline(sm);
    sm.append(usageEntry("u1"));
    sm.append({ type: "message", id: "m1", message: { role: "user", content: "x" } });
    sm.append(usageEntry("u2"));
    sm.append(usageEntry("u3"));
    const delivered: string[] = [];
    let failNext = "u2";
    const send = (m: any) => {
      if (m.entryId === failNext) {
        failNext = "";
        throw new Error("socket send failed");
      }
      delivered.push(m.entryId);
    };
    drainUsageAndSend(d, sm, send);
    expect(delivered).toEqual(["u1"]);
    drainUsageAndSend(d, sm, send);
    expect(delivered).toEqual(["u1", "u2", "u3"]);
    drainUsageAndSend(d, sm, send);
    expect(delivered).toEqual(["u1", "u2", "u3"]);
  });
});

describe("#P1 drain budget", () => {
  it("10,000 entries, cursor at end, no new entries: p95 ≤ 5 ms over 200 drains", () => {
    const entries: any[] = [];
    for (let i = 0; i < 10_000; i++) {
      entries.push(i % 50 === 0 ? usageEntry(`e${i}`) : { type: "message", id: `e${i}`, message: { role: "user", content: "x" } });
    }
    const sm = makeSm("A", entries);
    const d = new UsageDrain();
    d.baseline(sm);
    const samples: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      const out = d.drain(sm);
      samples.push(performance.now() - t0);
      expect(out).toHaveLength(0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    expect(p95).toBeLessThanOrEqual(5);
  });
});
