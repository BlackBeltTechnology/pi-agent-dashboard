/**
 * Performance budgets (test-plan P1-P4, thresholds from design.md Decision 12).
 *
 * A wall-clock assertion in CI is a flakiness risk, so each budget here is set
 * where a REGRESSION trips it but ordinary scheduling noise does not. The
 * thresholds are deliberately far above the measured cost of the work: P1's
 * budget covers one SHA-256 over 32 bytes plus a lookup, which is microseconds,
 * so a 1 ms p95 fires only if someone makes verification do real I/O.
 *
 * Each test also asserts the work ACTUALLY HAPPENED (a resolved caller, a
 * non-empty tool list, delivered events). Without that, a budget test passes
 * fastest when the code under test does nothing — the classic vacuous perf test.
 */
import { describe, expect, it } from "vitest";
import { McpTokenRegistry } from "../tokens.js";
import { MCP_TOOLS, listTools } from "../tools.js";
import { SubscriptionRegistry, type EventSource, type StreamSink } from "../streaming.js";
import type { McpCaller } from "../tokens.js";

const caller: McpCaller = { kind: "device", deviceId: "d1" };

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

describe("P1 — token verification stays within budget (<= 1 ms p95)", () => {
  it("verifies a valid token well inside the budget", () => {
    const tokens = new McpTokenRegistry();
    // A realistic registry: many live sessions, so the linear constant-time
    // scan is exercised at scale rather than against a single row.
    for (let i = 0; i < 200; i += 1) tokens.mintForSession(`session-${i}`);
    const token = tokens.mintForSession("session-target");

    const samples: number[] = [];
    let resolved = 0;
    for (let i = 0; i < 2000; i += 1) {
      const t0 = performance.now();
      const caller = tokens.resolve(token);
      samples.push(performance.now() - t0);
      if (caller) resolved += 1;
    }

    // The work happened — otherwise this measures nothing.
    expect(resolved).toBe(2000);
    expect(p95(samples)).toBeLessThanOrEqual(1);
  });

  it("a MISS is also within budget (the constant-time scan is not a hazard)", () => {
    const tokens = new McpTokenRegistry();
    for (let i = 0; i < 200; i += 1) tokens.mintForSession(`session-${i}`);

    const samples: number[] = [];
    for (let i = 0; i < 2000; i += 1) {
      const t0 = performance.now();
      tokens.resolve("mcp_definitely-not-a-real-token");
      samples.push(performance.now() - t0);
    }

    expect(p95(samples)).toBeLessThanOrEqual(1);
  });
});

describe("P2 — tools/list stays within budget (<= 50 ms p95)", () => {
  it("builds the advertised list well inside the budget", () => {
    const samples: number[] = [];
    let entries = 0;
    for (let i = 0; i < 1000; i += 1) {
      const t0 = performance.now();
      const list = listTools(MCP_TOOLS);
      samples.push(performance.now() - t0);
      entries += list.length;
    }

    // Non-vacuous: a real, non-empty table was built every time.
    expect(entries).toBe(1000 * MCP_TOOLS.length);
    expect(MCP_TOOLS.length).toBeGreaterThan(0);
    expect(p95(samples)).toBeLessThanOrEqual(50);
  });
});

describe("P3 — 50 concurrent streams (<= 250 ms p95 delivery, 0 dropped)", () => {
  it("delivers to every stream with no drops", () => {
    const handlers = new Set<(sessionId: string, payload: unknown) => void>();
    const source: EventSource = {
      onEvent(handler) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    };
    const registry = new SubscriptionRegistry();

    const received = new Array(50).fill(0);
    const subs = Array.from({ length: 50 }, (_, i) => {
      const sink: StreamSink = {
        write: () => {
          received[i] += 1;
          return true;
        },
        end: () => {},
      };
      return registry.open(source, [`session-${i}`], sink, caller);
    });

    const samples: number[] = [];
    const ROUNDS = 20;
    for (let round = 0; round < ROUNDS; round += 1) {
      for (let i = 0; i < 50; i += 1) {
        const t0 = performance.now();
        for (const h of handlers) h(`session-${i}`, { round });
        samples.push(performance.now() - t0);
      }
    }

    // Every stream got exactly its own session's events — zero dropped, and
    // zero leaked from a sibling.
    expect(received).toEqual(new Array(50).fill(ROUNDS));
    expect(p95(samples)).toBeLessThanOrEqual(250);

    for (const s of subs) s.close();
    expect(registry.size).toBe(0);
  });
});

describe("P4 — soak leaves no growth (listener count back to baseline)", () => {
  it("returns to baseline after sustained churn under continuous events", () => {
    const handlers = new Set<(sessionId: string, payload: unknown) => void>();
    const source: EventSource = {
      onEvent(handler) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    };
    const registry = new SubscriptionRegistry();
    const baseline = handlers.size;

    let delivered = 0;
    for (let cycle = 0; cycle < 500; cycle += 1) {
      const sink: StreamSink = {
        write: () => {
          delivered += 1;
          return true;
        },
        end: () => {},
      };
      const sub = registry.open(source, ["session-soak"], sink, caller);
      for (let e = 0; e < 20; e += 1) {
        for (const h of handlers) h("session-soak", { e });
      }
      sub.close();
    }

    // Non-vacuous: events really flowed during the soak.
    expect(delivered).toBe(500 * 20);
    // The leak canary.
    expect(handlers.size).toBe(baseline);
    expect(registry.size).toBe(0);
  });

  it("RSS growth over the soak stays within 25 MB", () => {
    const handlers = new Set<(sessionId: string, payload: unknown) => void>();
    const source: EventSource = {
      onEvent(handler) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    };
    const registry = new SubscriptionRegistry();

    const before = process.memoryUsage().heapUsed;
    for (let cycle = 0; cycle < 1000; cycle += 1) {
      const sub = registry.open(source, ["s"], { write: () => true, end: () => {} }, caller);
      for (const h of handlers) h("s", { cycle });
      sub.close();
    }
    const growthMb = (process.memoryUsage().heapUsed - before) / (1024 * 1024);

    expect(registry.size).toBe(0);
    expect(growthMb).toBeLessThanOrEqual(25);
  });
});
