/**
 * Windowed-replay plugin carry — test-plan E19-E21, E23, P2/P3, F3, X1 for
 * change: move-subagents-to-plugin (D2). Drives `sendEventBatches` (the sole
 * emitter of `history_window` + `event_replay`) with the process-wide plugin
 * policy registry swapped for an isolated one.
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSubagentsReplayCarry } from "../../../subagents-plugin/src/server/replay-carry.js";
import { sendEventBatches } from "../browser-handlers/subscription-handler.js";
import type { StoredEvent } from "../persistence/memory-event-store.js";
import { createPluginPolicyRegistry, resetPluginPolicyRegistry } from "../plugin-policy-registry.js";

const ev = (eventType: string, data: Record<string, unknown> = {}, ts = 1): DashboardEvent => ({ eventType, timestamp: ts, data });
const stored = (seq: number, e: DashboardEvent): StoredEvent => ({ bytes: 0, seq, event: e });

/** 3000 non-compactable fillers; `extra` replaces the filler at its seq. */
function stream(extra: StoredEvent[] = [], n = 3000): StoredEvent[] {
  const out = Array.from({ length: n }, (_, i) => stored(i + 1, ev("tool_execution_end", {}, i + 1)));
  for (const x of extra) out[x.seq - 1] = x;
  return out;
}

const openWs = (bufferedAmount = 0) => ({ readyState: 1, OPEN: 1, bufferedAmount }) as any;

async function deliver(events: StoredEvent[], limit = 500, ws = openWs()) {
  const sent: ServerToBrowserMessage[] = [];
  await sendEventBatches(ws, "S", events, (_w, m) => sent.push(m), limit);
  const carries = sent.filter((m): m is Extract<ServerToBrowserMessage, { type: "plugin_event_carry" }> => m.type === "plugin_event_carry");
  return { sent, carries };
}

function install() {
  const r = createPluginPolicyRegistry();
  r.setOwnership("subagents", { eventTypes: ["subagent_*"], tools: [] });
  r.setOwnership("other", { eventTypes: ["other_*"], tools: [] });
  resetPluginPolicyRegistry(r);
  return r;
}

afterEach(() => {
  resetPluginPolicyRegistry();
  vi.restoreAllMocks();
});

const owned = (seq: number, type = "subagent_created", data: Record<string, unknown> = { id: `a${seq}` }) => stored(seq, ev(type, data, seq));

describe("plugin_event_carry", () => {
  it("E19: only owned types are sent; the refusal is counted", async () => {
    const r = install();
    r.registerReplayCarry("subagents", (c) => c.getGapEvents().filter((e) => [900, 901, 902].includes(e.seq)));
    const { carries } = await deliver(stream([owned(900), owned(901), stored(902, ev("tool_execution_end"))]));
    expect(carries).toHaveLength(1);
    expect(carries[0].pluginId).toBe("subagents");
    expect(carries[0].events.map((e) => e.seq)).toEqual([900, 901]);
    expect(r.stats().replayCarry.refused).toBe(1);
  });

  it("E20: per-plugin 2000-event bound truncates in handler order; another plugin is unaffected", async () => {
    const r = install();
    const identity = Array.from({ length: 40 }, (_, i) => owned(100 + i));
    const entries = Array.from({ length: 2500 }, (_, i) => owned(200 + i, "subagent_entry", { agentId: "a", index: i }));
    r.registerReplayCarry("subagents", () => [...identity, ...entries]);
    r.registerReplayCarry("other", () => Array.from({ length: 10 }, (_, i) => stored(10 + i, ev("other_x", {}, i))));
    const { carries } = await deliver(stream([], 5000));
    const sub = carries.find((c) => c.pluginId === "subagents")!;
    expect(sub.events).toHaveLength(2000);
    expect(sub.events.slice(0, 40).every((e) => e.event.eventType === "subagent_created")).toBe(true);
    expect(sub.events.filter((e) => e.event.eventType === "subagent_entry")).toHaveLength(1960);
    expect(r.stats().replayCarry.dropped).toBe(540);
    expect(carries.find((c) => c.pluginId === "other")!.events).toHaveLength(10);
  });

  it("E20b: the 2 MiB byte bound also truncates", async () => {
    const r = install();
    const big = "x".repeat(100_000);
    r.registerReplayCarry("subagents", () => Array.from({ length: 50 }, (_, i) => owned(100 + i, "subagent_entry", { agentId: "a", index: i, big })));
    const { carries } = await deliver(stream());
    expect(carries[0].events.length).toBeLessThan(50);
    expect(Buffer.byteLength(JSON.stringify(carries[0].events))).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it("E21: a full-stream replay (under the window) calls no handler and sends no carry", async () => {
    const r = install();
    const handler = vi.fn(() => []);
    r.registerReplayCarry("subagents", handler);
    const { carries } = await deliver(stream([], 300), 500);
    expect(handler).not.toHaveBeenCalled();
    expect(carries).toHaveLength(0);
  });

  it("E23: a trimmed gap carries the pinned identity, no error, no missing entries", async () => {
    const r = install();
    r.registerReplayCarry("subagents", createSubagentsReplayCarry());
    // Gap holds only a1's pinned created + started; its entries were trimmed.
    const events = stream([owned(900, "subagent_created", { id: "a1" }), owned(901, "subagent_started", { id: "a1" })]).filter(
      (e) => e.seq <= 100 || e.seq === 900 || e.seq === 901 || e.seq > 2500,
    );
    const { carries } = await deliver(events);
    expect(carries).toHaveLength(1);
    expect(carries[0].events.map((e) => e.event.eventType)).toEqual(["subagent_created", "subagent_started"]);
  });

  it("P3: a result later than 200 ms is discarded and logged; head and tail still delivered", async () => {
    const r = install();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    r.registerReplayCarry("subagents", () => new Promise((res) => setTimeout(() => res([owned(900)]), 250)));
    const { sent, carries } = await deliver(stream([owned(900)]));
    expect(carries).toHaveLength(0);
    expect(sent.some((m) => m.type === "history_window")).toBe(true);
    expect(sent.filter((m) => m.type === "event_replay").length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(r.stats().replayCarry.discarded).toBe(1);
  });

  it("X1: a throwing handler is skipped with one log line; head and tail delivered", async () => {
    const r = install();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    r.registerReplayCarry("subagents", () => {
      throw new Error("boom");
    });
    const { sent, carries } = await deliver(stream());
    expect(carries).toHaveLength(0);
    expect(sent.filter((m) => m.type === "event_replay").length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("F3: under back-pressure the order is history_window, plugin_event_carry, first event_replay", async () => {
    const r = install();
    r.registerReplayCarry("subagents", (c) => c.getGapEvents().filter((e) => e.seq === 900));
    // Saturated until the first batch has been sent; then it drains.
    let reads = 0;
    const ws = { readyState: 1, OPEN: 1, get bufferedAmount() { return reads++ < 3 ? 2 * 1024 * 1024 : 0; } } as any;
    const { sent } = await deliver(stream([owned(900)]), 500, ws);
    const types = sent.map((m) => m.type).filter((t) => ["history_window", "plugin_event_carry", "event_replay"].includes(t));
    expect(types.slice(0, 3)).toEqual(["history_window", "plugin_event_carry", "event_replay"]);
  });
});
