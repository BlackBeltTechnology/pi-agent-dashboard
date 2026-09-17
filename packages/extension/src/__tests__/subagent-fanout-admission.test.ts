/**
 * Subagent fan-out admission — L1 unit tests for the pure decision function and
 * the stateful gate the bridge wires onto `tool_call` / `tool_execution_end`.
 *
 * Covers the test-plan rows E1–E11 (cap arithmetic, disabled, malformed,
 * saturation), X1–X3 (abort release, fail-open, never-wait), X7 (no terminate),
 * P2 (decision latency) and P3 (admit path does no I/O).
 *
 * See change: bound-subagent-fanout-under-host-pressure.
 */
import { describe, expect, it, vi } from "vitest";
import {
  decideAdmission,
  effectiveCap,
  FanoutAdmissionGate,
  refusalReason,
  resolveAdmissionConfig,
  type AdmissionConfig,
} from "../subagent-fanout-admission.js";

const CAP2: AdmissionConfig = { maxConcurrentSubagents: 2, thresholds: {} };

const saturation = (saturated: boolean) => ({
  read: () => ({ saturated, reading: {} }),
});

function makeGate(opts: {
  config?: () => AdmissionConfig;
  saturated?: boolean;
  recordRefusal?: (r: any) => void;
}) {
  return new FanoutAdmissionGate({
    resolveConfig: opts.config ?? (() => CAP2),
    saturation: opts.saturated === undefined ? saturation(false) : saturation(opts.saturated),
    recordRefusal: opts.recordRefusal,
    now: () => 1234,
  });
}

const agentCall = (toolCallId: string, input: unknown = { prompt: "do work" }) => ({
  type: "tool_call",
  toolName: "Agent",
  toolCallId,
  input,
});

describe("decideAdmission — effective cap", () => {
  it("uses the configured cap when not saturated", () => {
    expect(effectiveCap(2, false)).toBe(2);
    expect(effectiveCap(5, false)).toBe(5);
  });

  it("narrows to 1 under saturation, never to 0", () => {
    expect(effectiveCap(2, true)).toBe(1);
    expect(effectiveCap(5, true)).toBe(1);
    expect(effectiveCap(1, true)).toBe(1);
  });

  it("treats disabled / malformed as uncapped (fail open)", () => {
    expect(effectiveCap(0, false)).toBe(Number.POSITIVE_INFINITY);
    expect(effectiveCap(-1, false)).toBe(Number.POSITIVE_INFINITY);
    expect(effectiveCap(Number.POSITIVE_INFINITY, false)).toBe(Number.POSITIVE_INFINITY);
    expect(effectiveCap(Number.NaN, false)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("decideAdmission — E1/E2/E3/E4 boundaries", () => {
  it("E1: admits N calls below the cap", () => {
    const cfg = { maxConcurrentSubagents: 2, thresholds: {} };
    expect(decideAdmission({ inFlight: 0, config: cfg, saturated: false })).toEqual({ action: "admit" });
    expect(decideAdmission({ inFlight: 1, config: cfg, saturated: false })).toEqual({ action: "admit" });
  });

  it("E2: refuses at the cap", () => {
    const cfg = { maxConcurrentSubagents: 2, thresholds: {} };
    const d = decideAdmission({ inFlight: 2, config: cfg, saturated: false });
    expect(d.action).toBe("refuse");
    if (d.action === "refuse") expect(d.cause).toBe("cap");
  });

  it("E4: a count keyed at admission admits exactly N of N+K", () => {
    const cfg = { maxConcurrentSubagents: 2, thresholds: {} };
    let inFlight = 0;
    const verdicts = [0, 1, 2, 3].map(() => {
      const d = decideAdmission({ inFlight, config: cfg, saturated: false });
      if (d.action === "admit") inFlight += 1;
      return d.action;
    });
    expect(verdicts).toEqual(["admit", "admit", "refuse", "refuse"]);
    expect(inFlight).toBe(2);
  });
});

describe("decideAdmission — E10/E11 saturation", () => {
  it("E10: saturation with zero in flight still admits the first child", () => {
    expect(
      decideAdmission({ inFlight: 0, config: CAP2, saturated: true }),
    ).toEqual({ action: "admit" });
  });

  it("E11: saturation refuses the second child and names the cause", () => {
    const d = decideAdmission({ inFlight: 1, config: CAP2, saturated: true });
    expect(d.action).toBe("refuse");
    if (d.action === "refuse") {
      expect(d.cause).toBe("saturation");
      expect(d.reason).toMatch(/resource saturation/i);
    }
  });
});

describe("refusalReason", () => {
  it("states host admission, the in-flight count and re-issue timing", () => {
    const reason = refusalReason("cap", 2, 2);
    expect(reason).toMatch(/host admission/i);
    expect(reason).toMatch(/2 subagents already running/);
    expect(reason).toMatch(/re-issue after/i);
  });
});

describe("FanoutAdmissionGate — cap arithmetic", () => {
  it("E1: admits up to the cap and leaves the input untouched", () => {
    const gate = makeGate({});
    const input = { prompt: "unchanged", nested: { a: 1 } };
    const snapshot = JSON.stringify(input);
    expect(gate.onToolCall(agentCall("a", input))).toBeUndefined();
    expect(gate.onToolCall(agentCall("b", input))).toBeUndefined();
    expect(gate.inFlight).toBe(2);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(gate.counters.fanoutAdmitted).toBe(2);
  });

  it("E2: refuses beyond the cap without taking a permit", () => {
    const gate = makeGate({});
    gate.onToolCall(agentCall("a"));
    gate.onToolCall(agentCall("b"));
    const verdict = gate.onToolCall(agentCall("c"));
    expect(verdict?.block).toBe(true);
    expect(gate.inFlight).toBe(2);
    expect(gate.counters.fanoutRefused).toBe(1);
  });

  it("E3: admission below the cap increments", () => {
    const gate = makeGate({});
    gate.onToolCall(agentCall("a"));
    expect(gate.onToolCall(agentCall("b"))).toBeUndefined();
    expect(gate.inFlight).toBe(2);
  });

  it("E4: the count rises at admission, not execution", () => {
    const gate = makeGate({});
    const verdicts = ["a", "b", "c", "d"].map((id) => gate.onToolCall(agentCall(id)));
    expect(verdicts[0]).toBeUndefined();
    expect(verdicts[1]).toBeUndefined();
    expect(verdicts[2]?.block).toBe(true);
    expect(verdicts[3]?.block).toBe(true);
    expect(gate.inFlight).toBe(2);
  });

  it("ignores non-Agent and malformed events without consuming a permit", () => {
    const gate = makeGate({});
    expect(gate.onToolCall({ toolName: "Bash", toolCallId: "b" })).toBeUndefined();
    expect(gate.onToolCall({ toolName: "Agent" })).toBeUndefined();
    expect(gate.inFlight).toBe(0);
    expect(gate.counters.fanoutAdmitted).toBe(0);
  });
});

describe("FanoutAdmissionGate — release E5/E6/X1", () => {
  it("E5: a finished child frees capacity", () => {
    const gate = makeGate({});
    gate.onToolCall(agentCall("a"));
    gate.onToolCall(agentCall("b"));
    gate.onExecutionEnd({ toolCallId: "a" });
    expect(gate.inFlight).toBe(1);
    expect(gate.onToolCall(agentCall("c"))).toBeUndefined();
    expect(gate.inFlight).toBe(2);
  });

  it("E6: a refused id returns no permit", () => {
    const gate = makeGate({});
    gate.onToolCall(agentCall("a"));
    gate.onToolCall(agentCall("b"));
    gate.onToolCall(agentCall("r"));
    gate.onExecutionEnd({ toolCallId: "r" });
    expect(gate.inFlight).toBe(2);
  });

  it("X1: an aborted child (execution_end, no tool_result) frees capacity", () => {
    const gate = makeGate({});
    gate.onToolCall(agentCall("a"));
    gate.onToolCall(agentCall("b"));
    // Abort path: pi emits tool_execution_end but never tool_result.
    gate.onExecutionEnd({ toolCallId: "a" });
    gate.onExecutionEnd({ toolCallId: "b" });
    expect(gate.inFlight).toBe(0);
    expect(gate.onToolCall(agentCall("c"))).toBeUndefined();
  });
});

describe("FanoutAdmissionGate — E7 disabled is an exact no-op", () => {
  it("admits unbounded, never reads saturation, never writes", () => {
    let cap = 100;
    let saturated = false;
    const read = vi.fn(() => ({ saturated, reading: {} }));
    const recordRefusal = vi.fn();
    const gate = new FanoutAdmissionGate({
      resolveConfig: () => ({ maxConcurrentSubagents: cap, thresholds: { loadAvg1m: 1 } }),
      saturation: { read },
      recordRefusal,
    });
    for (let i = 0; i < 50; i++) gate.onToolCall(agentCall(`pre-${i}`));
    expect(gate.inFlight).toBe(50); // 50 children already in flight when we disable

    // Switch to the explicit disable value with 50 children in flight, and a
    // saturation reading above every threshold.
    cap = 0;
    saturated = true;
    read.mockClear();
    const verdict = gate.onToolCall(agentCall("x"));
    expect(verdict).toBeUndefined();
    expect(recordRefusal).not.toHaveBeenCalled();
    // The sampler must not even be consulted while disabled.
    expect(read).not.toHaveBeenCalled();
    expect(gate.counters.fanoutRefused).toBe(0);
  });
});

describe("FanoutAdmissionGate — E8/E9 config resolution", () => {
  it("E8: absent config is active at a default that is defined, ≥ 2 and < 3", () => {
    const cfg = resolveAdmissionConfig(undefined);
    expect(Number.isFinite(cfg.maxConcurrentSubagents)).toBe(true);
    expect(cfg.maxConcurrentSubagents).toBeGreaterThanOrEqual(2);
    expect(cfg.maxConcurrentSubagents).toBeLessThan(3);

    const gate = makeGate({ config: () => cfg });
    const n = cfg.maxConcurrentSubagents;
    const verdicts = Array.from({ length: n + 1 }, (_, i) => gate.onToolCall(agentCall(`c-${i}`)));
    expect(verdicts.slice(0, n).every((v) => v === undefined)).toBe(true);
    expect(verdicts[n]?.block).toBe(true);
  });

  it("E9: malformed config fails open for every invalid partition", () => {
    for (const raw of [-1, 1.5, "two", null, {}]) {
      const cfg = resolveAdmissionConfig({ maxConcurrentSubagents: raw });
      const d = decideAdmission({ inFlight: 0, config: cfg, saturated: false });
      expect(d.action).toBe("admit");
      // Malformed is NOT the explicit-disable path.
      expect(cfg.maxConcurrentSubagents).not.toBe(0);
    }
  });

  it("E7: explicit 0 disables (uncapped)", () => {
    const cfg = resolveAdmissionConfig({ maxConcurrentSubagents: 0 });
    expect(cfg.maxConcurrentSubagents).toBe(0);
    expect(decideAdmission({ inFlight: 1_000, config: cfg, saturated: false }).action).toBe("admit");
  });
});

describe("FanoutAdmissionGate — fail-open & never wait", () => {
  it("X2: a raising decision path admits and nothing propagates", () => {
    const gate = new FanoutAdmissionGate({
      resolveConfig: () => {
        throw new Error("boom");
      },
      saturation: saturation(false),
    });
    expect(() => gate.onToolCall(agentCall("a"))).not.toThrow();
    expect(gate.onToolCall(agentCall("a"))).toBeUndefined();
  });

  it("X2: a raising sampler admits", () => {
    const gate = new FanoutAdmissionGate({
      resolveConfig: () => CAP2,
      saturation: {
        read: () => {
          throw new Error("sampler boom");
        },
      },
    });
    expect(gate.onToolCall(agentCall("a"))).toBeUndefined();
  });

  it("X3: the decision never consults a child and never returns a promise", () => {
    const gate = makeGate({});
    gate.onToolCall(agentCall("hangs-1"));
    gate.onToolCall(agentCall("hangs-2"));
    const started = performance.now();
    const verdict = gate.onToolCall(agentCall("hangs-3"));
    const elapsed = performance.now() - started;
    expect(verdict?.block).toBe(true);
    expect((verdict as unknown as { then?: unknown })?.then).toBeUndefined();
    expect(elapsed).toBeLessThan(50);
  });
});

describe("FanoutAdmissionGate — X7 no termination", () => {
  it("never sets terminate, even when every call in a batch is refused", () => {
    const gate = makeGate({});
    const verdicts = ["a", "b", "c", "d"].map((id) => gate.onToolCall(agentCall(id)));
    for (const v of verdicts) {
      if (v) expect("terminate" in v).toBe(false);
    }
  });
});

describe("FanoutAdmissionGate — observability", () => {
  it("P3: the admit path performs no durable write", () => {
    const recordRefusal = vi.fn();
    const gate = new FanoutAdmissionGate({
      resolveConfig: () => ({ maxConcurrentSubagents: 1000, thresholds: {} }),
      saturation: saturation(false),
      recordRefusal,
    });
    for (let i = 0; i < 100; i++) gate.onToolCall(agentCall(`a-${i}`));
    expect(recordRefusal).not.toHaveBeenCalled();
    expect(gate.counters.fanoutAdmitted).toBe(100);
  });

  it("counts refusals and distinguishes the saturation cause; records durably", () => {
    const recordRefusal = vi.fn();
    const gate = makeGate({ saturated: true, recordRefusal });
    gate.onToolCall(agentCall("a")); // first admitted under saturation (cap floors at 1)
    gate.onToolCall(agentCall("b")); // refused — saturation
    expect(gate.counters.fanoutAdmitted).toBe(1);
    expect(gate.counters.fanoutRefused).toBe(1);
    expect(gate.counters.fanoutSaturationRefused).toBe(1);
    expect(recordRefusal).toHaveBeenCalledTimes(1);
    expect(recordRefusal.mock.calls[0][0]).toMatchObject({ cause: "saturation", toolCallId: "b" });
  });

  it("a throwing recorder still refuses (observability cannot flip the verdict)", () => {
    const gate = makeGate({
      recordRefusal: () => {
        throw new Error("fs boom");
      },
    });
    gate.onToolCall(agentCall("a"));
    gate.onToolCall(agentCall("b"));
    expect(gate.onToolCall(agentCall("c"))?.block).toBe(true);
  });

  it("P2: 1000 admit decisions stay under the latency budget", () => {
    const cfg = { maxConcurrentSubagents: 1_000_000, thresholds: {} };
    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const t0 = performance.now();
      expect(decideAdmission({ inFlight: 0, config: cfg, saturated: false }).action).toBe("admit");
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    const p99 = samples[Math.floor(samples.length * 0.99)];
    expect(p95).toBeLessThan(1);
    expect(p99).toBeLessThan(5);
  });
});
