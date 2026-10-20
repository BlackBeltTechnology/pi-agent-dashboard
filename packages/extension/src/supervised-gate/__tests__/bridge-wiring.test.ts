/**
 * Supervised gate bridge wiring — source-level invariants + the assembled gate.
 * Test-plan: X4 (registered 4th, after the path gate, WITHOUT safe()), X20 (bridge
 * clears per-session state on shutdown), E12 (config default starts a session
 * Supervised), E15's bus-timeout accessor, plus a real-PromptBus round trip.
 * See change: add-supervised-tool-approval (design D8, D10).
 * @structural-pin handler registration ORDER and the absence of safe() in bridge.ts are load-bearing and only observable in source text.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { PromptBus } from "../../prompt-bus.js";
import { createSupervisedGateForBridge } from "../index.js";
import { flush } from "./harness.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");

describe("#X4 bridge registration", () => {
  const bridge = read("bridge.ts");
  /** Each `pi.on("tool_call", …)` registration, up to the next `pi.on(`. */
  const registrations = (() => {
    const out: string[] = [];
    let from = 0;
    for (;;) {
      const at = bridge.indexOf('pi.on("tool_call"', from);
      if (at === -1) return out;
      const next = bridge.indexOf("pi.on(", at + 5);
      out.push(bridge.slice(at, next === -1 ? undefined : next));
      from = at + 5;
    }
  })();

  it("registers the supervised gate after the fan-out admission and the path gate", () => {
    const idx = (needle: string) => registrations.findIndex((r) => r.includes(needle));
    const fanout = idx("fanoutAdmission.onToolCall");
    const path = idx("pathGate.handler");
    const sup = idx("supervisedGate.handler");
    expect(fanout).toBeGreaterThanOrEqual(0);
    expect(path).toBeGreaterThan(fanout);
    expect(sup).toBeGreaterThan(path);
    expect(sup).toBe(registrations.length - 1); // 4th overall: the pass-through forwarder registers first (forwarders.ts)
  });

  it("is NOT wrapped in the fail-open safe()", () => {
    const sup = registrations.find((r) => r.includes("supervisedGate.handler"))!;
    expect(sup).not.toMatch(/safe\(/);
    // control: the fan-out registration IS safe()-wrapped, so the predicate is not vacuous
    expect(registrations.find((r) => r.includes("fanoutAdmission.onToolCall"))).toMatch(/safe\(/);
  });

  it("session_shutdown clears the gate's per-session state", () => {
    expect(read("bridge-handlers/lifecycle.ts")).toMatch(/supervisedGate\.clearSession\(inst\.sessionId\)/);
  });

  // B2 wiring (mode restore, set_supervised dispatch, hand-off, owner report). Behaviour is pinned in
  // mode-control.test.ts / path-gate tests; these only pin that the bridge actually calls them.
  it("session_start restores the mode BEFORE the register / any tool call; shutdown clears the hand-off set", () => {
    const life = read("bridge-handlers/lifecycle.ts");
    const restoreAt = life.indexOf("supervisedGate.control.restore(newSessionId");
    expect(restoreAt).toBeGreaterThan(0);
    expect(restoreAt).toBeLessThan(life.indexOf("handleSessionChange(inst, ctx, usageSeed)"));
    expect(life).toMatch(/pathGate\.clearSession\(inst\.sessionId\)/);
    expect(life).toMatch(/supervisedGate\.control\.reportIfChanged\(\)/); // heartbeat re-report
  });

  it("set_supervised is dispatched to the control; registration, hand-off and the path accessor are wired", () => {
    expect(read("bridge-handlers/dispatch.ts")).toMatch(/type === "set_supervised"[\s\S]{0,200}supervisedGate\.control\.onSetSupervised\(msg\)/);
    expect(bridge).toMatch(/supervisedRegistration: \(sid\) => supervisedGate\.control\.registrationFields\(sid\)/);
    expect(bridge).toMatch(/consumeHandoff: \(sid, toolCallId\) => pathGate\.consumeHandoff\(sid, toolCallId\)/);
    expect(bridge).toMatch(/supervisedInEffect: \(sid, tool\) => inst\.supervisedGate\.inEffect\(sid, tool\)/);
    const sync = read("session-sync.ts");
    expect(sync.match(/supervisedRegistration\?\.\(bc\.sessionId\)/g)).toHaveLength(2); // sendStateSync + handleSessionChange
  });
});

function assembled(o: { cfgDefault?: "full" | "supervised"; bus?: PromptBus | undefined; sid?: () => string } = {}) {
  const state: Record<string, unknown> = {};
  const logs: string[] = [];
  const entries: Array<[string, unknown]> = [];
  const gate = createSupervisedGateForBridge({
    state: state as never,
    getSessionId: o.sid ?? (() => "S1"),
    getPromptBus: () => o.bus,
    readConfig: () => ({ default: o.cfgDefault ?? "full", timeoutSeconds: 120, tools: ["bash", "powershell", "write", "edit", "Agent"] }),
    configFile: "/nonexistent/config.json",
    redact: (s) => s,
    appendEntry: (t, d) => entries.push([t, d]),
    log: (l) => logs.push(l),
  });
  return { gate, state, logs, entries };
}
const ctx = { hasUI: true, cwd: "/w/repo" };

describe("assembled gate", () => {
  it("#E12 a configured default of supervised starts a session Supervised: the first bash requests a prompt", async () => {
    const bus = new PromptBus({ timeoutMs: 300_000 });
    const requested = vi.fn();
    bus.registerAdapter({ name: "t", onRequest: (p) => void requested(p), onResponse: () => {}, onCancel: () => {} });
    const { gate } = assembled({ cfgDefault: "supervised", bus });
    expect(gate.modes.get("S1")).toBe(true);
    const p = gate.handler({ toolName: "bash", toolCallId: "t1", input: { command: "ls" } }, ctx);
    await flush();
    expect(requested).toHaveBeenCalledTimes(1);
    const req = requested.mock.calls[0][0];
    expect(req.type).toBe("select");
    expect(req.options).toEqual(["Allow once", "Deny"]);
    bus.respond({ id: req.id, answer: "Allow once", source: "dashboard-default" });
    expect(await p).toBeUndefined();
  });

  it("the default `full` is inert, an explicit entry wins over the default, per session id", async () => {
    const bus = new PromptBus({ timeoutMs: 300_000 });
    const requested = vi.fn();
    bus.registerAdapter({ name: "t", onRequest: (p) => void requested(p), onResponse: () => {}, onCancel: () => {} });
    let sid = "S1";
    const { gate } = assembled({ cfgDefault: "full", bus, sid: () => sid });
    expect(await gate.handler({ toolName: "bash", toolCallId: "a", input: {} }, ctx)).toBeUndefined();
    expect(requested).not.toHaveBeenCalled();
    gate.modes.set("S1", true);
    expect(gate.modes.get("S1")).toBe(true);
    sid = "S2"; // a different session does not inherit S1's mode
    expect(gate.modes.get("S2")).toBe(false);
    expect(await gate.handler({ toolName: "bash", toolCallId: "b", input: {} }, ctx)).toBeUndefined();
    expect(requested).not.toHaveBeenCalled();
  });

  it("mode store: rev defaults to previous + 1, explicit rev kept, state lives on the passed (process-global) maps", () => {
    const { gate, state } = assembled();
    expect(gate.modes.rev("S1")).toBe(0);
    expect(gate.modes.set("S1", true)).toBe(1);
    expect(gate.modes.set("S1", false)).toBe(2);
    expect(gate.modes.set("S1", true, 9)).toBe(9);
    expect((state.supervisedModes as Map<string, boolean>).get("S1")).toBe(true);
    expect((state.supervisedRevs as Map<string, number>).get("S1")).toBe(9);
  });

  it("#X20 clearSession drops mode, rev, mutex chain and unclassified-log set for that session only", async () => {
    const bus = new PromptBus({ timeoutMs: 300_000 });
    const sid = "s1";
    const { gate } = assembled({ bus, sid: () => sid });
    gate.modes.set("s1", true);
    gate.modes.set("s2", true);
    await gate.handler({ toolName: "ctx_execute", toolCallId: "a", input: {} }, ctx); // unclassified log for s1
    const pending = gate.handler({ toolName: "bash", toolCallId: "b", input: {} }, ctx); // chain for s1
    await flush();
    expect(gate.hasSessionState("s1")).toEqual({ mode: true, chain: true, unclassified: true });
    gate.clearSession("s1");
    expect(gate.hasSessionState("s1")).toEqual({ mode: false, chain: false, unclassified: false });
    expect(gate.hasSessionState("s2").mode).toBe(true);
    expect(gate.modes.rev("s1")).toBe(0);
    bus.cancel([...(bus as never as { pending: Map<string, unknown> }).pending.keys()][0]);
    await pending;
  });

  it("no prompt bus ⇒ fail closed (supervised: error)", async () => {
    const { gate } = assembled({ bus: undefined });
    gate.modes.set("S1", true);
    expect(await gate.handler({ toolName: "bash", toolCallId: "a", input: {} }, ctx)).toEqual({ block: true, reason: "supervised: error" });
  });
});

describe("PromptBus timeout accessor + single clock against the REAL bus (#E15 #E9)", () => {
  it("getTimeoutMs reads the option (default 5 min; ≤0 stays as given)", () => {
    expect(new PromptBus({ timeoutMs: 42_000 }).getTimeoutMs()).toBe(42_000);
    expect(new PromptBus({ timeoutMs: -1 }).getTimeoutMs()).toBe(-1);
    expect(new PromptBus().getTimeoutMs()).toBe(5 * 60 * 1000);
  });

  it("with a 3 s bus timeout the gate's own timer (2 s) fires first: timeout, card cancelled via the bus", async () => {
    vi.useFakeTimers();
    try {
      const bus = new PromptBus({ timeoutMs: 3000 });
      const cancelled = vi.fn();
      bus.registerAdapter({ name: "t", onRequest: () => undefined, onResponse: () => {}, onCancel: cancelled });
      const { gate } = assembled({ bus });
      gate.modes.set("S1", true);
      const p = gate.handler({ toolName: "bash", toolCallId: "a", input: {} }, ctx);
      await vi.advanceTimersByTimeAsync(2000);
      expect(await p).toEqual({ block: true, reason: "supervised: timeout" });
      expect(cancelled).toHaveBeenCalledTimes(1);
      expect(bus.pendingCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an Allow once answered on the TUI adapter runs the tool; the record names the tui surface", async () => {
    const bus = new PromptBus({ timeoutMs: 300_000 });
    bus.registerAdapter({
      name: "tui",
      onRequest: (p) => {
        queueMicrotask(() => bus.respond({ id: p.id, answer: "Allow once", source: "tui" }));
        return undefined;
      },
      onResponse: () => {},
      onCancel: () => {},
    });
    const { gate, entries } = assembled({ bus });
    gate.modes.set("S1", true);
    expect(await gate.handler({ toolName: "bash", toolCallId: "a", input: { command: "ls" } }, ctx)).toBeUndefined();
    expect(entries).toHaveLength(1);
    expect(entries[0][0]).toBe("supervised-tool-decision");
    expect(entries[0][1]).toMatchObject({ sessionId: "S1", tool: "bash", outcome: "approved", answeredSurface: "tui", via: "supervised" });
  });
});
