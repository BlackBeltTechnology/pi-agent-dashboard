import fs from "node:fs";
/**
 * Plugin event-forward registry (L1). Folded from test-plan.md E1–E8, P1, X1–X3.
 * See change: add-plugin-bridge-contributions.
 */

import {
  BRIDGE_READY_CHANNEL,
  REGISTER_EVENT_FORWARD_CHANNEL,
} from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";
import { describe, expect, it } from "vitest";
import { REGISTER_TOOL_UPDATE_FILTER_CHANNEL } from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";
import { PluginForwardRegistry } from "../plugin-event-forward-registry.js";
import { ToolUpdateFilterRegistry } from "../tool-update-filter-registry.js";
import { readBridgeSource } from "./helpers/bridge-source.js";

type Handler = (data: unknown) => void;

/** Minimal shared bus: every `on` sees every `emit` (like pi's EventBus). */
function makeBus() {
  const handlers = new Map<string, Set<Handler>>();
  const onCalls: string[] = [];
  return {
    onCalls,
    on(channel: string, h: Handler) {
      onCalls.push(channel);
      let set = handlers.get(channel);
      if (!set) handlers.set(channel, (set = new Set()));
      set.add(h);
      return () => set!.delete(h);
    },
    emit(channel: string, data: unknown) {
      for (const h of [...(handlers.get(channel) ?? [])]) h(data);
    },
    count(channel: string) {
      return handlers.get(channel)?.size ?? 0;
    },
  };
}

function makeRegistry(
  bus = makeBus(),
  state = { ready: true, active: true, connected: true },
  coreChannels: Record<string, string> = { "subagents:started": "subagent_started" },
  /** The server's ownership table; `false` = it has not arrived yet. */
  ownership: { eventTypes: Record<string, string> } | false = { eventTypes: { "subagent_*": "subagents" } },
) {
  const sent: Array<{ eventType: string; data: Record<string, unknown>; pluginId?: string }> = [];
  const registry = new PluginForwardRegistry(bus, {
    send: (eventType, data, pluginId) => sent.push({ eventType, data, pluginId }),
    isSessionReady: () => state.ready,
    isActive: () => state.active,
    isConnected: () => state.connected,
    isCoreChannel: (c) => c in coreChannels,
  });
  if (ownership) registry.setOwnership(ownership);
  return { bus, state, sent, registry };
}

/** `sent` entries without the stamp (the existing assertions predate it). */
const unstamped = (sent: Array<{ eventType: string; data: Record<string, unknown> }>) =>
  sent.map(({ eventType, data }) => ({ eventType, data }));

const ENTRY_DECL = {
  pluginId: "subagents",
  channels: {
    "subagents:entry": { as: "subagent_entry", delivery: "stream", key: "agentId" },
    "subagents:delta": { as: "subagent_delta", delivery: "stream", key: "agentId" },
  },
};

/**
 * @structural-pin bridge.ts cannot be instantiated in a test; the plugin event forwarding registration is pinned in its text
 */
describe("PluginForwardRegistry", () => {
  it("forwards a declared channel with its mapped type (E1)", () => {
    const { bus, sent, registry } = makeRegistry();
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, ENTRY_DECL);
    bus.emit("subagents:entry", { agentId: "a", index: 0 });
    expect(unstamped(sent)).toEqual([{ eventType: "subagent_entry", data: { agentId: "a", index: 0 } }]);
  });

  it("is idempotent for a repeated declaration (E2)", () => {
    const { bus, sent, registry } = makeRegistry();
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, ENTRY_DECL);
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, ENTRY_DECL);
    expect(bus.onCalls.filter((c) => c === "subagents:entry")).toHaveLength(1);
    bus.emit("subagents:entry", { agentId: "a" });
    expect(sent).toHaveLength(1);
  });

  it("keeps the first owner on conflict and counts it (E3)", () => {
    const { bus, sent, registry } = makeRegistry();
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, {
      pluginId: "evil",
      channels: { "subagents:started": { as: "x_y", delivery: "live" } },
    });
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, {
      pluginId: "a",
      channels: { "a:x": { as: "a_x", delivery: "live" } },
    });
    expect(() =>
      bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, {
        pluginId: "b",
        channels: { "a:x": { as: "b_x", delivery: "live" } },
      }),
    ).not.toThrow();
    expect(registry.stats.conflicts).toBe(2);
    expect(bus.count("subagents:started")).toBe(0);
    bus.emit("a:x", {});
    expect(sent.map((s) => s.eventType)).toEqual(["a_x"]);
  });

  it("rejects malformed entries but applies valid ones (E4)", () => {
    const { bus, registry } = makeRegistry();
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, {
      pluginId: "p",
      channels: {
        "p:ok": { delivery: "live" },
        "Bad Name": { delivery: "live" },
        nocolon: { delivery: "live" },
        [`p:${"x".repeat(62)}`]: { delivery: "live" }, // 64 chars
        [`p:${"x".repeat(63)}`]: { delivery: "live" }, // 65 chars
        "p:hijack": { as: "message_update", delivery: "live" },
        "p:nokey": { delivery: "stream" },
      },
    });
    expect(registry.declaredChannels().sort()).toEqual(["p:ok", `p:${"x".repeat(62)}`].sort());
    expect(registry.stats.rejected).toBe(5);
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, { pluginId: "Bad!", channels: { "q:a": { delivery: "live" } } });
    expect(registry.declaredChannels()).not.toContain("q:a");
    expect(registry.stats.rejectedDeclarations).toBe(1);
  });

  it("enforces per-plugin and total caps (E5)", () => {
    const { bus, registry } = makeRegistry();
    registry.attach();
    const many = (pid: string, n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`${pid}:c${i}`, { delivery: "live" }]));
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, { pluginId: "p", channels: many("p", 33) });
    expect(registry.declaredChannels()).toHaveLength(32);
    for (let i = 0; i < 8; i++) {
      bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, { pluginId: `q${i}`, channels: many(`q${i}`, 32) });
    }
    expect(registry.declaredChannels()).toHaveLength(256);
    expect(registry.stats.rejected).toBe(1 + 32);
  });

  it("validates key values and keeps prototype names inert (E6)", () => {
    const state = { ready: true, active: true, connected: false };
    const { bus, sent, registry } = makeRegistry(makeBus(), state);
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, ENTRY_DECL);
    bus.emit("subagents:entry", { agentId: { x: 1 } });
    bus.emit("subagents:entry", { agentId: "y".repeat(129) });
    bus.emit("subagents:entry", { agentId: "__proto__", n: 1 });
    bus.emit("subagents:entry", { agentId: 7, n: 2 });
    expect(registry.stats.buffer.keyRejected).toBe(2);
    state.connected = true;
    registry.flush();
    expect(sent.map((s) => s.data.n)).toEqual([1, 2]);
    expect(({} as Record<string, unknown>).n).toBeUndefined();
  });

  it("latest keeps only the newest per key (E7)", () => {
    const state = { ready: true, active: true, connected: false };
    const { bus, sent, registry } = makeRegistry(makeBus(), state);
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, {
      pluginId: "p",
      channels: { "p:snap": { as: "p_snap", delivery: "latest", key: "id" } },
    });
    for (const n of [1, 2, 3]) bus.emit("p:snap", { id: "a", n });
    bus.emit("p:snap", { id: "b", n: 9 });
    state.connected = true;
    registry.flush();
    expect(sent.map((s) => [s.data.id, s.data.n])).toEqual([
      ["a", 3],
      ["b", 9],
    ]);
  });

  it("preserves interleaving across stream channels (E8)", () => {
    const state = { ready: false, active: true, connected: true };
    const { bus, sent, registry } = makeRegistry(makeBus(), state);
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, ENTRY_DECL);
    bus.emit("subagents:delta", { agentId: "a", n: 1 });
    bus.emit("subagents:delta", { agentId: "a", n: 2 });
    bus.emit("subagents:entry", { agentId: "a", n: 3 });
    bus.emit("subagents:delta", { agentId: "a", n: 4 });
    state.ready = true;
    registry.flush();
    expect(sent.map((s) => `${s.eventType}:${s.data.n}`)).toEqual([
      "subagent_delta:1",
      "subagent_delta:2",
      "subagent_entry:3",
      "subagent_delta:4",
    ]);
  });

  it("bounds stream retention and key cardinality (P1)", () => {
    const state = { ready: false, active: true, connected: true };
    const { bus, registry } = makeRegistry(makeBus(), state);
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, ENTRY_DECL);
    for (let i = 0; i < 2500; i++) bus.emit("subagents:entry", { agentId: "a", i });
    expect(registry.stats.buffer.retained).toBe(2000);
    expect(registry.stats.buffer.dropped).toBe(500);
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, {
      pluginId: "p",
      channels: { "p:snap": { delivery: "latest", key: "id" } },
    });
    for (let i = 0; i < 10_000; i++) bus.emit("p:snap", { id: `k${i}` });
    // Budgets are per plugin: `p` holds ≤ 64 keys, plus the subagents stream key.
    expect(registry.stats.buffer.keys).toBeLessThanOrEqual(64 + 1);
    expect(registry.stats.buffer.evictedKeys).toBeGreaterThanOrEqual(10_000 - 64);
  });

  it("drops live-delivery messages while not ready (generic rule)", () => {
    const state = { ready: false, active: true, connected: true };
    const { bus, sent, registry } = makeRegistry(makeBus(), state);
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, { pluginId: "p", channels: { "p:l": { delivery: "live" } } });
    bus.emit("p:l", { x: 1 });
    state.ready = true;
    registry.flush();
    expect(sent).toEqual([]);
  });

  it("drops live-delivery messages while disconnected (never buffered for reconnect)", () => {
    const state = { ready: true, active: true, connected: false };
    const { bus, sent, registry } = makeRegistry(makeBus(), state);
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, { pluginId: "p", channels: { "p:l": { delivery: "live" } } });
    bus.emit("p:l", { x: 1 });
    state.connected = true;
    registry.flush();
    expect(sent).toEqual([]);
  });

  it("recovers a declaration emitted before attach via the ready handshake (X1)", () => {
    const bus = makeBus();
    // Plugin bridge: declares on activate and on every bridge-ready.
    const declare = () => bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, ENTRY_DECL);
    bus.on(BRIDGE_READY_CHANNEL, declare);
    declare(); // lost: registry not attached yet
    const { sent, registry } = makeRegistry(bus);
    registry.attach(); // attaches listener, then emits bridge-ready
    bus.emit("subagents:entry", { agentId: "a" });
    expect(sent).toHaveLength(1);
    expect(bus.count("subagents:entry")).toBe(1);
  });

  it("re-declares after a bridge reload without duplicates (X2)", () => {
    const bus = makeBus();
    bus.on(BRIDGE_READY_CHANNEL, () => bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, ENTRY_DECL));
    const first = makeRegistry(bus);
    first.registry.attach();
    first.registry.dispose();
    expect(bus.count("subagents:entry")).toBe(0);
    const second = makeRegistry(bus);
    second.registry.attach();
    bus.emit("subagents:entry", { agentId: "a" });
    expect(first.sent).toHaveLength(0);
    expect(second.sent).toHaveLength(1);
  });

  it("reports declared / rejected / dropped counters (X6)", () => {
    const state = { ready: false, active: true, connected: true };
    const { bus, registry } = makeRegistry(makeBus(), state);
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, {
      pluginId: "p",
      channels: {
        "p:a": { delivery: "stream", key: "id" },
        "p:b": { delivery: "live" },
        "Bad Name": { delivery: "live" },
      },
    });
    for (let i = 0; i < 2003; i++) bus.emit("p:a", { id: "k", i });
    expect(registry.stats.declared).toBe(2);
    expect(registry.stats.rejected).toBe(1);
    expect(registry.stats.buffer.dropped).toBe(3);
  });

  it("flushes a disconnect gap in order without duplicates (X3)", () => {
    const state = { ready: true, active: true, connected: true };
    const { bus, sent, registry } = makeRegistry(makeBus(), state);
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, ENTRY_DECL);
    state.connected = false;
    for (let i = 0; i < 50; i++) bus.emit("subagents:entry", { agentId: "a", i });
    state.connected = true;
    registry.flush();
    registry.flush();
    expect(sent.map((s) => s.data.i)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });
});

// CodeRabbit (PR #838): `onReconnect` skips the first open, so the primary
// connection's `onOpen` must drain retained plugin messages (source pin: the
// bridge wiring has no isolated harness for the open callback).
describe("bridge wiring: first-open drain", () => {
  it("primary onOpen schedules a registry flush after the lane comes up", () => {
    const src = readBridgeSource("bridge.ts");
    const open = src.indexOf("onOpen: () => {\n      if (!isActive() || connection !== primaryConnection) return;");
    expect(open).toBeGreaterThan(-1);
    const body = src.slice(open, src.indexOf("onClose:", open));
    expect(body).toMatch(/queueMicrotask\([\s\S]*pluginForwardRegistry\.flush\(\)/);
  });
});

/**
 * Flow channels through the generic registry (core holds no flow map).
 * The declaration mirrors the flows plugin bridge's; core tests may not import
 * plugin code. See change: update-flows-plugin (test-plan E1–E3, P1–P3, X1, X2).
 */
const FLOW_DECL = {
  pluginId: "flows",
  channels: {
    "flow:flow-started": { as: "flow_started", delivery: "stream", key: "flowName" },
    "flow:agent-started": { as: "flow_agent_started", delivery: "stream", key: "stepId" },
    "flow:agent-complete": { as: "flow_agent_complete", delivery: "stream", key: "stepId" },
    "flow:assistant-text": { as: "flow_assistant_text", delivery: "stream", key: "stepId" },
    "flow:thinking-text": { as: "flow_thinking_text", delivery: "stream", key: "stepId" },
    "flow:decision": { as: "flow_decision", delivery: "stream", key: "stepId" },
    "flow:complete": { as: "flow_complete", delivery: "stream", key: "flowName" },
    "flow:summary-ready": { as: "flow_summary_ready", delivery: "live" },
  },
};

describe("PluginForwardRegistry: plugin-declared flow channels", () => {
  it("accepts flow_* as types; only the reserved entry is rejected (flow E1)", () => {
    const { bus, sent, registry } = makeRegistry();
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, {
      pluginId: "flows",
      channels: {
        "flow:flow-started": { as: "flow_started", delivery: "stream", key: "flowName" },
        "flows:x": { as: "message_update", delivery: "live" },
      },
    });
    expect(registry.stats.rejected).toBe(1);
    bus.emit("flow:flow-started", { flowName: "research" });
    expect(unstamped(sent)).toEqual([{ eventType: "flow_started", data: { flowName: "research" } }]);
  });

  const FLOWS_DECISION = {
    pluginId: "flows",
    channels: { "flow:decision": { as: "flow_decision", delivery: "stream", key: "stepId" } },
  };
  const OTHER_DECISION = {
    pluginId: "other",
    channels: {
      "other:x": { as: "flow_decision", delivery: "stream", key: "stepId" },
      "other:ok": { as: "other_ok", delivery: "live" },
    },
  };

  it("first owner of an as type wins across plugins — flows first (flow E2a)", () => {
    const { bus, sent, registry } = makeRegistry();
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, FLOWS_DECISION);
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, OTHER_DECISION);
    expect(registry.stats.conflicts).toBe(1);
    bus.emit("flow:decision", { stepId: "t" });
    bus.emit("other:x", { stepId: "t" });
    bus.emit("other:ok", {});
    expect(sent.map((s) => s.eventType)).toEqual(["flow_decision", "other_ok"]);
    expect(sent[0].data).toEqual({ stepId: "t" });
  });

  it("first owner of an as type wins across plugins — other first (flow E2b)", () => {
    const { bus, sent, registry } = makeRegistry();
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, OTHER_DECISION);
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, {
      pluginId: "flows",
      channels: {
        ...FLOWS_DECISION.channels,
        "flow:complete": { as: "flow_complete", delivery: "stream", key: "flowName" },
      },
    });
    expect(registry.stats.conflicts).toBe(1);
    bus.emit("flow:decision", { stepId: "t" });
    bus.emit("other:x", { stepId: "t" });
    bus.emit("flow:complete", { flowName: "r" });
    expect(sent.map((s) => s.eventType)).toEqual(["flow_decision", "flow_complete"]);
    expect(sent[0].data).toEqual({ stepId: "t" });
    expect(registry.declaredChannels()).not.toContain("flow:decision");
  });

  it("same-plugin re-declare is idempotent (flow E3)", () => {
    const { bus, sent, registry } = makeRegistry();
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, FLOWS_DECISION);
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, FLOWS_DECISION);
    expect(registry.stats.rejected).toBe(0);
    expect(registry.stats.conflicts).toBe(0);
    expect(bus.onCalls.filter((c) => c === "flow:decision")).toHaveLength(1);
    bus.emit("flow:decision", { stepId: "t" });
    expect(sent).toHaveLength(1);
  });

  it.each([
    [1999, 1999, 0],
    [2000, 2000, 0],
    [2001, 2000, 1],
  ])("retains %i fan-out text frames of one stepId → flushes %i, drops %i (flow P1)", (n, flushed, dropped) => {
    const state = { ready: true, active: true, connected: false };
    const { bus, sent, registry } = makeRegistry(makeBus(), state);
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, FLOW_DECL);
    for (let i = 0; i < n; i++) bus.emit("flow:assistant-text", { stepId: "review", itemIndex: i % 3, i });
    expect(registry.stats.buffer.dropped).toBe(dropped);
    state.connected = true;
    expect(registry.flush()).toBe(flushed);
    expect(sent).toHaveLength(flushed);
    expect(sent[0].data.i).toBe(n - flushed);
  });

  // The shared 64-key budget this test used to pin is replaced by per-plugin
  // budgets (move-subagents-to-plugin D1): flows keeps its own 64 keys and a
  // busy subagents plugin can no longer evict a flow key.
  it("budgets keys per plugin: flows and subagents never evict each other (flow P2)", () => {
    const state = { ready: true, active: true, connected: false };
    const { bus, sent, registry } = makeRegistry(makeBus(), state);
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, ENTRY_DECL);
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, FLOW_DECL);
    for (let i = 1; i <= 64; i++) bus.emit("subagents:entry", { agentId: `a${i}` });
    for (let i = 1; i <= 5; i++) bus.emit("flow:agent-started", { stepId: `s${i}` });
    expect(registry.stats.buffer.keys).toBe(69);
    expect(registry.stats.buffer.evictedKeys).toBe(0);
    bus.emit("subagents:entry", { agentId: "a65" }); // evicts a1 (subagents' own oldest)
    expect(registry.stats.buffer.evictedKeys).toBe(1);
    state.connected = true;
    registry.flush();
    const keys = sent.map((s) => (s.data.agentId ?? s.data.stepId) as string);
    expect(keys).toHaveLength(69);
    expect(keys).not.toContain("a1");
    expect(keys.filter((k) => k.startsWith("s"))).toEqual(["s1", "s2", "s3", "s4", "s5"]);
  });

  it("bounds a stepId key at 2 MiB, newest frame always kept (flow P3)", () => {
    const state = { ready: true, active: true, connected: false };
    const { bus, sent, registry } = makeRegistry(makeBus(), state);
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, FLOW_DECL);
    const MiB = 1024 * 1024;
    // JSON size of each frame is just under 1 MiB.
    const frame = (n: number) => ({ stepId: "t", n, text: "x".repeat(MiB - 64) });
    const frameBytes = JSON.stringify(frame(0)).length;
    expect(frameBytes).toBeLessThanOrEqual(MiB);
    const droppedAfter: number[] = [];
    for (let n = 0; n < 3; n++) {
      bus.emit("flow:thinking-text", frame(n));
      expect(registry.stats.buffer.retained * frameBytes).toBeLessThanOrEqual(2 * MiB);
      droppedAfter.push(registry.stats.buffer.dropped);
    }
    expect(droppedAfter).toEqual([0, 0, 1]);
    state.connected = true;
    registry.flush();
    expect(sent.map((s) => s.data.n)).toEqual([1, 2]);
  });

  it("forwards keyed flow events after a reconnect in order; drops live (flow X1)", () => {
    const state = { ready: true, active: true, connected: false };
    const { bus, sent, registry } = makeRegistry(makeBus(), state);
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, {
      ...FLOW_DECL,
      channels: { ...FLOW_DECL.channels },
    });
    const events: Array<[string, Record<string, unknown>]> = [
      ["flow:agent-started", { stepId: "build" }],
      ["flow:agent-complete", { stepId: "build" }],
      ["flow:decision", { stepId: "triage" }],
      ["flow:complete", { flowName: "research" }],
      ["flow:summary-ready", {}],
    ];
    for (const [ch, data] of events) bus.emit(ch, data);
    state.connected = true;
    registry.flush();
    expect(unstamped(sent)).toEqual([
      { eventType: "flow_agent_started", data: { stepId: "build" } },
      { eventType: "flow_agent_complete", data: { stepId: "build" } },
      { eventType: "flow_decision", data: { stepId: "triage" } },
      { eventType: "flow_complete", data: { flowName: "research" } },
    ]);
  });

  it("does not retain a frame missing its key (flow X2)", () => {
    const state = { ready: true, active: true, connected: false };
    const { bus, sent, registry } = makeRegistry(makeBus(), state);
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, FLOW_DECL);
    expect(() => bus.emit("flow:agent-started", { agentName: "a" })).not.toThrow();
    expect(registry.stats.buffer.keyRejected).toBe(1);
    expect(registry.stats.buffer.retained).toBe(0);
    state.connected = true;
    expect(registry.flush()).toBe(0);
    expect(sent).toEqual([]);
  });
});

describe("PluginForwardRegistry: declared replay entry types", () => {
  it("collects a declaration's replayEntryTypes; malformed values contribute nothing", () => {
    const { bus, registry } = makeRegistry();
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, { ...FLOW_DECL, replayEntryTypes: ["flow-event"] });
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, { pluginId: "p", channels: {}, replayEntryTypes: "x" });
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, { pluginId: "q", channels: {}, replayEntryTypes: [1] });
    expect([...registry.replayEntryTypes()]).toEqual(["flow-event"]);
  });
});

/**
 * Manifest ownership of event types, latest groups and per-plugin budgets (D1).
 * See change: move-subagents-to-plugin (test-plan E1–E5).
 */
const lifecycleDecl = (pluginId: string, extra: Record<string, unknown> = {}) => ({
  pluginId,
  ...extra,
  channels: {
    "subagents:created": { as: "subagent_created", delivery: "latest", key: "id", group: "lifecycle" },
    "subagents:started": { as: "subagent_started", delivery: "latest", key: "id", group: "lifecycle" },
    "subagents:completed": { as: "subagent_completed", delivery: "latest", key: "id", group: "lifecycle" },
  },
});

describe("PluginForwardRegistry: manifest ownership (D1)", () => {
  it("E1: only the owner may forward as its manifest type; core types stay reserved", () => {
    const { bus, sent, registry } = makeRegistry();
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, {
      pluginId: "subagents",
      channels: { "subagents:created": { as: "subagent_created", delivery: "live" } },
    });
    expect(registry.declaredChannels()).toEqual(["subagents:created"]);
    expect(registry.stats.rejected).toBe(0);
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, {
      pluginId: "other",
      channels: { "other:created": { as: "subagent_created", delivery: "live" } },
    });
    expect(registry.declaredChannels()).toEqual(["subagents:created"]);
    expect(registry.stats.rejected).toBe(1);
    expect(() =>
      bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, {
        pluginId: "subagents",
        channels: { "subagents:end": { as: "tool_execution_end", delivery: "live" } },
      }),
    ).not.toThrow();
    expect(registry.declaredChannels()).toEqual(["subagents:created"]);
    expect(registry.stats.rejected).toBe(2);
    bus.emit("subagents:created", { id: "a" });
    expect(sent).toEqual([{ eventType: "subagent_created", data: { id: "a" }, pluginId: "subagents" }]);
  });

  it("E2: a declaration made before the ownership table is held, then becomes active (one forward)", () => {
    const { bus, sent, registry } = makeRegistry(makeBus(), undefined, {}, false);
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, lifecycleDecl("subagents"));
    expect(registry.declaredChannels()).toEqual([]);
    bus.emit("subagents:created", { id: "a" }); // no subscription yet
    expect(sent).toEqual([]);
    registry.setOwnership({ eventTypes: { "subagent_*": "subagents" } });
    expect(registry.declaredChannels()).toContain("subagents:created");
    bus.emit("subagents:created", { id: "a" });
    expect(sent.map((m) => m.eventType)).toEqual(["subagent_created"]);
  });

  it("E2b: a held non-owner declaration is refused when the table arrives", () => {
    const { bus, registry } = makeRegistry(makeBus(), undefined, {}, false);
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, lifecycleDecl("other"));
    registry.setOwnership({ eventTypes: { "subagent_*": "subagents" } });
    expect(registry.declaredChannels()).toEqual([]);
    expect(registry.stats.rejected).toBe(3);
  });

  it("E3: a latest group shares one slot per key — the completed frame supersedes created/started", () => {
    const state = { ready: true, active: true, connected: false };
    const { bus, sent, registry } = makeRegistry(makeBus(), state);
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, lifecycleDecl("subagents"));
    bus.emit("subagents:created", { id: "a1" });
    bus.emit("subagents:started", { id: "a1", n: 1 });
    bus.emit("subagents:started", { id: "a1", n: 2 });
    bus.emit("subagents:completed", { id: "a1" });
    state.connected = true;
    registry.flush();
    expect(unstamped(sent)).toEqual([{ eventType: "subagent_completed", data: { id: "a1" } }]);
  });

  it("E3b: a group is per key and per plugin (other keys and plugins keep their own slot)", () => {
    const state = { ready: true, active: true, connected: false };
    const { bus, sent, registry } = makeRegistry(makeBus(), state);
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, lifecycleDecl("subagents"));
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, {
      pluginId: "p",
      channels: { "p:a": { as: "p_a", delivery: "latest", key: "id", group: "lifecycle" } },
    });
    bus.emit("subagents:created", { id: "a1" });
    bus.emit("subagents:created", { id: "a2" });
    bus.emit("p:a", { id: "a1" });
    state.connected = true;
    registry.flush();
    expect(sent.map((m) => `${m.pluginId}:${m.eventType}:${m.data.id}`)).toEqual([
      "subagents:subagent_created:a1",
      "subagents:subagent_created:a2",
      "p:p_a:a1",
    ]);
  });

  it("E4: budgets are per plugin — 10 flows keys survive; subagents keeps 256 and drops 1 of 257", () => {
    const state = { ready: true, active: true, connected: false };
    const { bus, sent, registry } = makeRegistry(makeBus(), state);
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, FLOW_DECL);
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, lifecycleDecl("subagents", { maxKeys: 256 }));
    for (let i = 0; i < 10; i++) bus.emit("flow:agent-started", { stepId: `s${i}` });
    for (let i = 0; i < 257; i++) bus.emit("subagents:created", { id: `a${i}` });
    state.connected = true;
    registry.flush();
    expect(sent.filter((m) => m.pluginId === "flows")).toHaveLength(10);
    const subs = sent.filter((m) => m.pluginId === "subagents");
    expect(subs).toHaveLength(256);
    expect(subs.map((m) => m.data.id)).not.toContain("a0");
    expect(registry.stats.buffer.byPlugin.subagents?.dropped).toBe(1);
    expect(registry.stats.buffer.byPlugin.flows?.dropped ?? 0).toBe(0);
  });

  it("E4b: without maxKeys a plugin holds 64 keys", () => {
    const state = { ready: true, active: true, connected: false };
    const { bus, sent, registry } = makeRegistry(makeBus(), state);
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, lifecycleDecl("subagents"));
    for (let i = 0; i < 65; i++) bus.emit("subagents:created", { id: `a${i}` });
    state.connected = true;
    registry.flush();
    expect(sent).toHaveLength(64);
  });

  it("E5: maxKeys 257 is clamped to 256 and counted; no throw", () => {
    const state = { ready: true, active: true, connected: false };
    const { bus, sent, registry } = makeRegistry(makeBus(), state);
    registry.attach();
    expect(() =>
      bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, lifecycleDecl("subagents", { maxKeys: 257 })),
    ).not.toThrow();
    expect(registry.stats.rejected).toBe(1);
    for (let i = 0; i < 300; i++) bus.emit("subagents:created", { id: `a${i}` });
    state.connected = true;
    registry.flush();
    expect(sent).toHaveLength(256);
  });

  it("stamps the declaring pluginId on every plugin forward", () => {
    const { bus, sent, registry } = makeRegistry();
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, FLOW_DECL);
    bus.emit("flow:flow-started", { flowName: "r" });
    expect(sent[0].pluginId).toBe("flows");
  });

  it("applies a later ownership table (re-register) without dropping accepted channels", () => {
    const { bus, registry } = makeRegistry();
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, ENTRY_DECL);
    registry.setOwnership({ eventTypes: { "subagent_*": "subagents" } });
    expect(registry.declaredChannels()).toEqual(["subagents:entry", "subagents:delta"]);
  });
});

/**
 * Plugin-declared per-tool `tool_execution_update` filter (D5).
 * See change: move-subagents-to-plugin (test-plan E6–E9, E43, P1).
 */
const AGENT_FILTER = {
  pluginId: "subagents",
  toolName: "Agent",
  dropPaths: ["partialResult.details.entries", "details.entries"],
  when: { path: "partialResult.details.status", in: ["queued", "running"] },
};

function makeFilters(claims: Record<string, string> | false = { Agent: "subagents" }) {
  const bus = makeBus();
  const filters = new ToolUpdateFilterRegistry(bus);
  filters.attach();
  if (claims) filters.setClaims(claims);
  const declare = (d: unknown) => bus.emit(REGISTER_TOOL_UPDATE_FILTER_CHANNEL, d);
  return { bus, filters, declare };
}

const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: "tool", i }));

describe("ToolUpdateFilterRegistry (D5)", () => {
  it("E6: drops entries of a running Agent update on a copy; the original keeps them", () => {
    const { filters, declare } = makeFilters();
    declare(AGENT_FILTER);
    const original = {
      toolName: "Agent",
      partialResult: { details: { status: "running", entries: entries(40), toolUses: 3 } },
    };
    const out = filters.apply("Agent", original) as typeof original;
    expect(out).not.toBe(original);
    expect(out.partialResult.details).toEqual({ status: "running", toolUses: 3 });
    expect(original.partialResult.details.entries).toHaveLength(40);
    // top-level details too (sibling status)
    const top = { toolName: "Agent", details: { status: "queued", entries: entries(40), id: "x" } };
    const out2 = filters.apply("Agent", top) as typeof top;
    expect(out2.details).toEqual({ status: "queued", id: "x" });
    expect(top.details.entries).toHaveLength(40);
    expect("entries" in out2.details).toBe(false);
  });

  it("E7: condition not met → the very same payload (byte-identical)", () => {
    const { filters, declare } = makeFilters();
    declare(AGENT_FILTER);
    const done = { toolName: "Agent", partialResult: { details: { status: "completed", entries: entries(5) } } };
    expect(filters.apply("Agent", done)).toBe(done);
    const noStatus = { toolName: "Agent", partialResult: { details: { entries: entries(5) } } };
    expect(filters.apply("Agent", noStatus)).toBe(noStatus);
  });

  it("other tools are untouched by the Agent filter", () => {
    const { filters, declare } = makeFilters();
    declare(AGENT_FILTER);
    const bash = { toolName: "bash", partialResult: { details: { status: "running", entries: entries(2) } } };
    expect(filters.apply("bash", bash)).toBe(bash);
  });

  it("E8: validation — 16 paths accepted; bad toolName, empty and 17 paths refused and counted", () => {
    const sixteen = Array.from({ length: 16 }, (_, i) => `a.p${i}`);
    for (const [decl, ok] of [
      [{ ...AGENT_FILTER, toolName: 5 }, false],
      [{ ...AGENT_FILTER, dropPaths: [] }, false],
      [{ ...AGENT_FILTER, dropPaths: [...sixteen, "a.p16"] }, false],
      [{ ...AGENT_FILTER, dropPaths: sixteen }, true],
    ] as const) {
      const { filters, declare } = makeFilters();
      expect(() => declare(decl)).not.toThrow();
      expect(filters.stats).toMatchObject({ declared: ok ? 1 : 0, refused: ok ? 0 : 1 });
    }
  });

  it("E8b: unsafe or malformed paths and conditions are refused", () => {
    for (const bad of [
      { ...AGENT_FILTER, dropPaths: ["__proto__.x"] },
      { ...AGENT_FILTER, dropPaths: ["a..b"] },
      { ...AGENT_FILTER, dropPaths: [7] },
      { ...AGENT_FILTER, when: { path: "a.status", in: [] } },
      { ...AGENT_FILTER, when: { path: "a.status", in: [5] } },
      { ...AGENT_FILTER, when: "running" },
      null,
    ]) {
      const { filters, declare } = makeFilters();
      expect(() => declare(bad)).not.toThrow();
      expect(filters.stats).toMatchObject({ declared: 0, refused: 1 });
    }
  });

  it("E9: only the claiming plugin may filter a tool; the claimant's filter stays in force", () => {
    const { filters, declare } = makeFilters({ Agent: "subagents" });
    declare({ ...AGENT_FILTER, pluginId: "other", dropPaths: ["partialResult.details.status"] });
    expect(filters.stats.refused).toBe(1);
    declare(AGENT_FILTER);
    declare({ ...AGENT_FILTER, pluginId: "other" });
    expect(filters.stats.refused).toBe(2);
    const update = { partialResult: { details: { status: "running", entries: entries(3) } } };
    const out = filters.apply("Agent", update) as typeof update;
    expect(out.partialResult.details).toEqual({ status: "running" });
  });

  it("holds declarations until the claims table arrives", () => {
    const { filters, declare } = makeFilters(false);
    declare(AGENT_FILTER);
    const update = { partialResult: { details: { status: "running", entries: entries(3) } } };
    expect(filters.apply("Agent", update)).toBe(update);
    filters.setClaims({ Agent: "subagents" });
    expect(filters.stats.declared).toBe(1);
    expect(filters.apply("Agent", update)).not.toBe(update);
  });

  it("an unclaimed tool cannot be filtered", () => {
    const { filters, declare } = makeFilters({});
    declare(AGENT_FILTER);
    expect(filters.stats).toMatchObject({ declared: 0, refused: 1 });
  });

  it("E43: a producer-shaped subagents:started progress tick forwards deep-equal (no core strip)", () => {
    const { bus, sent, registry } = makeRegistry(makeBus(), undefined, {});
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, lifecycleDecl("subagents"));
    const tick = {
      id: "ag1",
      details: { agentId: "ag1", status: "running", toolUses: 4, entries: entries(40), activity: "reading" },
    };
    bus.emit("subagents:started", tick);
    expect(sent).toHaveLength(1);
    expect(sent[0].data).toEqual(tick);
    expect(sent[0].data).toBe(tick);
  });

  it("P1: broadcast bytes per Agent tick grow ≤ 2x from 10 → 100 timeline entries", () => {
    const { filters, declare } = makeFilters();
    declare(AGENT_FILTER);
    const bytes = (n: number) =>
      JSON.stringify({
        type: "event_forward",
        event: {
          eventType: "tool_execution_update",
          data: filters.apply("Agent", {
            toolName: "Agent",
            partialResult: { details: { status: "running", entries: entries(n).map((e) => ({ ...e, out: "x".repeat(600) })) } },
          }),
        },
      }).length;
    expect(bytes(100) / bytes(10)).toBeLessThanOrEqual(2);
  });
});
