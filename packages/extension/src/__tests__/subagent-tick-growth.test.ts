/**
 * P1/P2 — the spec bound: an intermediate subagent tick must be O(1) in
 * timeline length, asserted on the SERIALIZED broadcast payload.
 *
 * Measuring the in-memory object instead of the serialized frame would make the
 * bound vacuous, so the harness below builds the exact `event_forward` message
 * the bridge puts on the wire and measures its JSON bytes.
 *
 * The reduction now comes from the `Agent` filter the subagents plugin declares
 * (`dashboard:register-tool-update-filter`), applied to `tool_execution_update`.
 * See change: reduce-subagent-details-payload, move-subagents-to-plugin (P1).
 */
import { describe, expect, it } from "vitest";
import { ToolUpdateFilterRegistry } from "../tool-update-filter-registry.js";

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

/** An `Agent` `tool_execution_update` carrying an `n`-entry cumulative timeline. */
function tick(n: number, status = "running"): Record<string, unknown> {
  return {
    toolCallId: "tc1",
    toolName: "Agent",
    partialResult: {
      details: {
        agentId: "ag1",
        agentSessionId: "sess-7",
        displayName: "Explore",
        description: "find the call sites",
        subagentType: "Explore",
        status,
        activity: `reading /src/module-${n}/file-${n}.ts`,
        toolUses: n,
        tokens: "12.3k",
        durationMs: n * 900,
        entries: Array.from({ length: n }, (_, i) => entry(i)),
      },
    },
  };
}

/** Filter registry as the subagents plugin configures it (claim granted by the server table). */
function makeFilter(declared = true): ToolUpdateFilterRegistry {
  const handlers = new Map<string, (d: unknown) => void>();
  const reg = new ToolUpdateFilterRegistry({
    on: (channel, h) => {
      handlers.set(channel, h);
    },
  });
  reg.attach();
  reg.setClaims({ Agent: "subagents" });
  if (declared) {
    handlers.get("dashboard:register-tool-update-filter")?.({
      pluginId: "subagents",
      toolName: "Agent",
      dropPaths: ["partialResult.details.entries", "details.entries"],
      when: { path: "partialResult.details.status", in: ["queued", "running"] },
    });
  }
  return reg;
}

/**
 * Serialize exactly what the transport sends: the `event_forward` envelope
 * wrapping the (possibly stripped) frame.
 */
function broadcastBytes(data: Record<string, unknown>): number {
  const msg = {
    type: "event_forward",
    sessionId: "01a00607-932a-739d-8873-790e11e8cd56",
    event: { eventType: "tool_execution_update", timestamp: 1_700_000_000_000, data },
  };
  return Buffer.byteLength(JSON.stringify(msg));
}

const bytesVia = (filter: ToolUpdateFilterRegistry, n: number, status?: string) =>
  broadcastBytes(filter.apply("Agent", tick(n, status)));

const ratio10to100 = (filter: ToolUpdateFilterRegistry) => bytesVia(filter, 100) / bytesVia(filter, 10);

describe("subagent tick growth (serialized broadcast payload)", () => {
  it("P1: bytes(tick@100) / bytes(tick@10) ≤ 2.0", () => {
    expect(ratio10to100(makeFilter())).toBeLessThanOrEqual(2.0);
  });

  // P2 — anti-vacuity. With NO filter declared the SAME assertion must fail, else
  // P1 proves nothing about the filter.
  it("P2: with no filter declared the same bound is violated (≈8–10x)", () => {
    const ratio = ratio10to100(makeFilter(false));
    expect(ratio).toBeGreaterThan(2.0);
    // Pin the order of magnitude so a future change that quietly shrinks the
    // unstripped payload can no longer make this row pass by accident.
    expect(ratio).toBeGreaterThan(5.0);
  });

  it("stays flat far past the measured window (1000 entries)", () => {
    const f = makeFilter();
    const ratio = bytesVia(f, 1000) / bytesVia(f, 10);
    expect(ratio).toBeLessThanOrEqual(2.0);
  });

  // See change: stream-subagent-reasoning-and-stable-card (#P1).
  it("stays ≤ 2x from 10 to 100 entries with a 280-char liveTail present", () => {
    const filter = makeFilter();
    const withTail = (n: number) => {
      const f = tick(n);
      ((f.partialResult as Record<string, unknown>).details as Record<string, unknown>).liveTail = {
        kind: "thinking",
        text: "t".repeat(280),
      };
      return broadcastBytes(filter.apply("Agent", f));
    };
    expect(withTail(100) / withTail(10)).toBeLessThanOrEqual(2.0);
  });

  it("a TERMINAL tick still carries the full timeline (bytes grow with length)", () => {
    const filter = makeFilter();
    const terminal = (n: number) => bytesVia(filter, n, "completed");
    expect(terminal(100) / terminal(10)).toBeGreaterThan(5.0);
  });
});
