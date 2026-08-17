/**
 * P1/P2 — the spec bound: an intermediate subagent tick must be O(1) in
 * timeline length, asserted on the SERIALIZED broadcast payload.
 *
 * Measuring the in-memory object instead of the serialized frame would make the
 * bound vacuous, so the harness below builds the exact `event_forward` message
 * the bridge puts on the wire and measures its JSON bytes.
 *
 * See change: reduce-subagent-details-payload.
 */
import { afterEach, describe, expect, it } from "vitest";
import { stripForForward } from "../subagent-frame-strip.js";

/** One timeline entry of realistic weight (a tool call + its output). */
function entry(i: number): Record<string, unknown> {
  return {
    kind: "tool",
    toolName: "Read",
    input: { file_path: `/src/module-${i}/file-${i}.ts`, offset: i * 10 },
    output: `X`.repeat(600),
    ts: 1_700_000_000_000 + i,
  };
}

/** A running-subagent frame with an `n`-entry cumulative timeline. */
function tick(n: number): Record<string, unknown> {
  return {
    id: "ag1",
    details: {
      agentId: "ag1",
      agentSessionId: "sess-7",
      displayName: "Explore",
      description: "find the call sites",
      subagentType: "Explore",
      status: "running",
      activity: `reading /src/module-${n}/file-${n}.ts`,
      toolUses: n,
      tokens: "12.3k",
      durationMs: n * 900,
      entries: Array.from({ length: n }, (_, i) => entry(i)),
    },
  };
}

/**
 * Serialize exactly what the transport sends: the `event_forward` envelope
 * wrapping the (possibly stripped) frame.
 */
function broadcastBytes(data: Record<string, unknown>): number {
  const msg = {
    type: "event_forward",
    sessionId: "01a00607-932a-739d-8873-790e11e8cd56",
    event: { eventType: "subagent_started", timestamp: 1_700_000_000_000, data },
  };
  return Buffer.byteLength(JSON.stringify(msg));
}

const ratio10to100 = () =>
  broadcastBytes(stripForForward(tick(100))) / broadcastBytes(stripForForward(tick(10)));

afterEach(() => {
  delete process.env.PI_DASHBOARD_SUBAGENT_STRIP;
});

describe("subagent tick growth (serialized broadcast payload)", () => {
  it("P1: bytes(tick@100) / bytes(tick@10) ≤ 2.0", () => {
    expect(ratio10to100()).toBeLessThanOrEqual(2.0);
  });

  // P2 — anti-vacuity. With the strip OFF the SAME assertion must fail, else
  // P1 proves nothing about the strip.
  it("P2: with the strip flag OFF the same bound is violated (≈8–10x)", () => {
    process.env.PI_DASHBOARD_SUBAGENT_STRIP = "0";
    const ratio = ratio10to100();
    expect(ratio).toBeGreaterThan(2.0);
    // Pin the order of magnitude so a future change that quietly shrinks the
    // unstripped payload can no longer make this row pass by accident.
    expect(ratio).toBeGreaterThan(5.0);
  });

  it("stays flat far past the measured window (1000 entries)", () => {
    const ratio = broadcastBytes(stripForForward(tick(1000))) / broadcastBytes(stripForForward(tick(10)));
    expect(ratio).toBeLessThanOrEqual(2.0);
  });

  it("a TERMINAL tick still carries the full timeline (bytes grow with length)", () => {
    const terminal = (n: number) => {
      const frame = tick(n);
      (frame.details as Record<string, unknown>).status = "completed";
      return broadcastBytes(stripForForward(frame));
    };
    expect(terminal(100) / terminal(10)).toBeGreaterThan(5.0);
  });
});
