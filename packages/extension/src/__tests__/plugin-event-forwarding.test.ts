/**
 * Plugin event-forward registry (L1). Folded from test-plan.md E1–E8, P1, X1–X3.
 * See change: add-plugin-bridge-contributions.
 */

import {
  BRIDGE_READY_CHANNEL,
  REGISTER_EVENT_FORWARD_CHANNEL,
} from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";
import { describe, expect, it } from "vitest";
import { PluginForwardRegistry } from "../plugin-event-forward-registry.js";

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
) {
  const sent: Array<{ eventType: string; data: Record<string, unknown> }> = [];
  const registry = new PluginForwardRegistry(bus, {
    send: (eventType, data) => sent.push({ eventType, data }),
    isSessionReady: () => state.ready,
    isActive: () => state.active,
    isConnected: () => state.connected,
    isCoreChannel: (c) => c in coreChannels,
  });
  return { bus, state, sent, registry };
}

const ENTRY_DECL = {
  pluginId: "subagents",
  channels: {
    "subagents:entry": { as: "subagent_entry", delivery: "stream", key: "agentId" },
    "subagents:delta": { as: "subagent_delta", delivery: "stream", key: "agentId" },
  },
};

describe("PluginForwardRegistry", () => {
  it("forwards a declared channel with its mapped type (E1)", () => {
    const { bus, sent, registry } = makeRegistry();
    registry.attach();
    bus.emit(REGISTER_EVENT_FORWARD_CHANNEL, ENTRY_DECL);
    bus.emit("subagents:entry", { agentId: "a", index: 0 });
    expect(sent).toEqual([{ eventType: "subagent_entry", data: { agentId: "a", index: 0 } }]);
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
    expect(registry.stats.buffer.keys).toBeLessThanOrEqual(64);
    expect(registry.stats.buffer.evictedKeys).toBeGreaterThanOrEqual(10_000 - 63);
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
