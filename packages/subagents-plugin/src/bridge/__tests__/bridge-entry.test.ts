/**
 * subagents-plugin bridge entry declares the step + delta streams (test-plan #E26).
 * See change: add-plugin-bridge-contributions.
 *
 * Registry snapshot via `subagents:list` (test-plan #E28). The stop-answer
 * verdict combiner and `subagents:registry` query tests were deleted with their code.
 * See change: move-subagents-to-plugin (D6, D7).
 */

import {
  BRIDGE_READY_CHANNEL,
  REGISTER_EVENT_FORWARD_CHANNEL,
  RESERVED_EVENT_TYPES,
} from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";
import { describe, expect, it } from "vitest";
import { PluginForwardRegistry } from "../../../../extension/src/plugin-event-forward-registry.js";
import { ToolUpdateFilterRegistry } from "../../../../extension/src/tool-update-filter-registry.js";
import activate, { LIST_CHANNEL, REGISTRY_SNAPSHOT_CHANNEL, SUBAGENTS_FORWARD_DECLARATION } from "../index.js";

type Handler = (d: unknown) => void;

/** A synchronous EventEmitter-shaped bus, like pi's (listeners in registration order). */
function fakePi() {
  const emitted: Array<{ channel: string; data: unknown }> = [];
  const handlers = new Map<string, Handler[]>();
  return {
    emitted,
    handlers,
    events: {
      emit: (channel: string, data: unknown) => {
        emitted.push({ channel, data });
        for (const h of handlers.get(channel) ?? []) h(data);
      },
      on: (channel: string, h: Handler) => {
        handlers.set(channel, [...(handlers.get(channel) ?? []), h]);
        return () => handlers.set(channel, (handlers.get(channel) ?? []).filter((x) => x !== h));
      },
    },
  };
}

const ofChannel = (pi: ReturnType<typeof fakePi>, channel: string) =>
  pi.emitted.filter((e) => e.channel === channel).map((e) => e.data as Record<string, unknown>);

const LIFECYCLE = { delivery: "latest", key: "id", group: "lifecycle" };
const EXPECTED_DECLARATION = {
  pluginId: "subagents",
  maxKeys: 256,
  channels: {
    "subagents:created": { as: "subagent_created", ...LIFECYCLE },
    "subagents:started": { as: "subagent_started", ...LIFECYCLE },
    "subagents:completed": { as: "subagent_completed", ...LIFECYCLE },
    "subagents:failed": { as: "subagent_failed", ...LIFECYCLE },
    "subagents:entry": { as: "subagent_entry", delivery: "stream", key: "agentId" },
    "subagents:delta": { as: "subagent_delta", delivery: "stream", key: "agentId" },
    "subagents:registry_snapshot": { as: "subagent_registry_snapshot", delivery: "latest", key: "scope" },
  },
};

describe("subagents-plugin bridge entry", () => {
  it("declares entry + delta streams on activate and on every bridge-ready", () => {
    const pi = fakePi();
    activate(pi);
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    const decls = pi.emitted.filter((e) => e.channel === REGISTER_EVENT_FORWARD_CHANNEL);
    expect(decls).toHaveLength(3);
    for (const d of decls) {
      expect(d.data).toEqual(EXPECTED_DECLARATION);
    }
    expect(SUBAGENTS_FORWARD_DECLARATION.pluginId).toBe("subagents");
  });

  // 1.3: the four lifecycle channels forward under their subagent_* names, and
  // only the newest frame per agent flushes after a reconnect (core maps none).
  it("forwards the lifecycle channels as subagent_* and flushes only the newest frame per agent", () => {
    const pi = fakePi();
    const state = { connected: true };
    const sent: Array<{ eventType: string; data: Record<string, unknown>; pluginId: string }> = [];
    const registry = new PluginForwardRegistry(pi.events, {
      send: (eventType, data, pluginId) => sent.push({ eventType, data, pluginId }),
      isSessionReady: () => true,
      isActive: () => true,
      isConnected: () => state.connected,
    });
    registry.setOwnership({ eventTypes: { "subagent_*": "subagents" } });
    registry.attach(); // re-declares on bridge-ready
    activate(pi);
    for (const [ch, eventType] of [
      ["subagents:created", "subagent_created"],
      ["subagents:started", "subagent_started"],
      ["subagents:completed", "subagent_completed"],
      ["subagents:failed", "subagent_failed"],
    ] as const) {
      pi.events.emit(ch, { id: `x-${ch}` });
      expect(sent.at(-1)).toEqual({ eventType, data: { id: `x-${ch}` }, pluginId: "subagents" });
    }
    sent.length = 0;
    state.connected = false;
    pi.events.emit("subagents:created", { id: "a1" });
    pi.events.emit("subagents:started", { id: "a1", n: 1 });
    pi.events.emit("subagents:started", { id: "a1", n: 2 });
    pi.events.emit("subagents:completed", { id: "a1" });
    pi.events.emit("subagents:created", { id: "a2" });
    state.connected = true;
    registry.flush();
    expect(sent.map((m) => [m.eventType, m.data.id])).toEqual([
      ["subagent_completed", "a1"],
      ["subagent_created", "a2"],
    ]);
  });

  // 2.2: the Agent filter the plugin declares drops the timeline of a running agent.
  it("declares the Agent tool-update filter that drops entries of a running agent", () => {
    const pi = fakePi();
    const filters = new ToolUpdateFilterRegistry(pi.events);
    filters.attach();
    filters.setClaims({ Agent: "subagents" });
    activate(pi);
    const running = { toolName: "Agent", partialResult: { details: { status: "running", entries: [1, 2] } } };
    const out = filters.apply("Agent", running) as typeof running;
    expect(out.partialResult.details).toEqual({ status: "running" });
    expect(running.partialResult.details.entries).toHaveLength(2);
    const done = { toolName: "Agent", partialResult: { details: { status: "completed", entries: [1] } } };
    expect(filters.apply("Agent", done)).toBe(done);
  });

  it("accepts ctx wrapped as { pi } and is a no-op without an event bus", () => {
    const pi = fakePi();
    activate({ pi });
    expect(pi.emitted.some((e) => e.channel === REGISTER_EVENT_FORWARD_CHANNEL)).toBe(true);
    expect(() => activate({})).not.toThrow();
  });
});

describe("registry snapshot via subagents:list (#E28)", () => {
  /** A producer answering `subagents:list` from the first activation only (agent.ts: `out ??=`). */
  const listStub = (entries: Array<{ agentId: string; status: string }>) => (d: unknown) => {
    const q = d as { out?: unknown[] };
    q.out ??= entries;
  };
  const snaps = (pi: ReturnType<typeof fakePi>) => ofChannel(pi, REGISTRY_SNAPSHOT_CHANNEL);

  it("forwards an answered list as a background snapshot", () => {
    const pi = fakePi();
    activate(pi);
    pi.events.on(LIST_CHANNEL, listStub([{ agentId: "A", status: "running" }]));
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    const [snap, ...rest] = snaps(pi);
    expect(rest).toHaveLength(0);
    expect(snap.entries).toEqual([{ agentId: "A", status: "running" }]);
    expect(snap.scope).toBe("registry");
    expect(snap.background).toBe(true);
    expect(typeof snap.takenAt).toBe("number");
    expect(ofChannel(pi, LIST_CHANNEL)[0].out).toEqual([{ agentId: "A", status: "running" }]);
  });

  it("emits the query with `out` unset", () => {
    const pi = fakePi();
    let seen: { has: boolean; out: unknown } | undefined;
    pi.events.on(LIST_CHANNEL, (d) => {
      seen = { has: "out" in (d as object), out: (d as { out?: unknown }).out };
    });
    activate(pi);
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    expect(seen).toEqual({ has: true, out: undefined });
  });

  it("forwards an empty answered list (the session runs nothing)", () => {
    const pi = fakePi();
    activate(pi);
    pi.events.on(LIST_CHANNEL, listStub([]));
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    expect(snaps(pi)).toHaveLength(1);
    expect(snaps(pi)[0].entries).toEqual([]);
  });

  it("sends no snapshot when nothing answers, then retries once on the first lifecycle emission", () => {
    const pi = fakePi();
    activate(pi);
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    expect(snaps(pi)).toHaveLength(0);
    expect(ofChannel(pi, LIST_CHANNEL)).toHaveLength(1);
    // still no producer: one retry, then no more
    pi.events.emit("subagents:created", { id: "a1" });
    pi.events.emit("subagents:started", { id: "a1" });
    expect(ofChannel(pi, LIST_CHANNEL)).toHaveLength(2);
    expect(snaps(pi)).toHaveLength(0);
  });

  it("answers late: snapshot arrives after the first subagents:created", () => {
    const pi = fakePi();
    activate(pi);
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    expect(snaps(pi)).toHaveLength(0);
    pi.events.on(LIST_CHANNEL, listStub([{ agentId: "A", status: "running" }]));
    pi.events.emit("subagents:created", { id: "A" });
    expect(snaps(pi)).toHaveLength(1);
    expect(snaps(pi)[0].entries).toEqual([{ agentId: "A", status: "running" }]);
    pi.events.emit("subagents:started", { id: "A" });
    expect(snaps(pi)).toHaveLength(1);
  });

  it("does not retry when bridge-ready was answered", () => {
    const pi = fakePi();
    activate(pi);
    pi.events.on(LIST_CHANNEL, listStub([]));
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    pi.events.emit("subagents:created", { id: "a1" });
    expect(ofChannel(pi, LIST_CHANNEL)).toHaveLength(1);
  });

  it("keeps an `idle` entry as idle and maps other producer statuses", () => {
    const pi = fakePi();
    activate(pi);
    const statuses = ["queued", "running", "idle", "completed", "error", "aborted", "stopped", "bogus"];
    pi.events.on(LIST_CHANNEL, listStub(statuses.map((status, i) => ({ agentId: `a${i}`, status }))));
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    expect((snaps(pi)[0].entries as Array<{ status: string }>).map((e) => e.status)).toEqual([
      "created", "running", "idle", "completed", "failed", "failed", "stopped",
    ]);
  });

  it("uses only the first activation's answer (partial list accepted)", () => {
    const pi = fakePi();
    activate(pi);
    pi.events.on(LIST_CHANNEL, listStub([{ agentId: "A", status: "running" }]));
    pi.events.on(LIST_CHANNEL, listStub([{ agentId: "B", status: "running" }]));
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    expect(snaps(pi)[0].entries).toEqual([{ agentId: "A", status: "running" }]);
  });

  it("emits the snapshot after that bridge-ready's declare, never on plain activation", () => {
    const pi = fakePi();
    pi.events.on(LIST_CHANNEL, listStub([]));
    activate(pi);
    expect(snaps(pi)).toHaveLength(0);
    const mark = pi.emitted.length;
    pi.events.emit(BRIDGE_READY_CHANNEL, {});
    const after = pi.emitted.slice(mark).map((e) => e.channel);
    expect(after.indexOf(REGISTRY_SNAPSHOT_CHANNEL)).toBeGreaterThan(after.indexOf(REGISTER_EVENT_FORWARD_CHANNEL));
  });

  it("declares the snapshot channel as `latest`, outside the reserved types; no stop_result", () => {
    const ch = SUBAGENTS_FORWARD_DECLARATION.channels;
    expect(ch["subagents:registry_snapshot"]).toEqual({ as: "subagent_registry_snapshot", delivery: "latest", key: "scope" });
    expect(ch["subagents:stop_result"]).toBeUndefined();
    expect(RESERVED_EVENT_TYPES.has("subagent_registry_snapshot")).toBe(false);
  });

  it("survives a stale runtime whose on/emit throw", () => {
    const emitted: string[] = [];
    const stale = {
      emit: (channel: string) => {
        emitted.push(channel);
        throw new Error("stale runtime");
      },
      on: () => {
        throw new Error("stale runtime");
      },
    };
    expect(() => activate({ events: stale })).not.toThrow();
    expect(emitted.filter((c) => c === REGISTRY_SNAPSHOT_CHANNEL)).toHaveLength(0);
  });
});
