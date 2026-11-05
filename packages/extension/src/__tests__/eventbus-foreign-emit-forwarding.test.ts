/**
 * EventBus forwarding must observe emissions made by OTHER extensions.
 *
 * pi's extension loader gives every extension its own `events` surface
 * (`createExtensionAPI` → `events: { emit, on }`) over ONE shared bus. This
 * suite reproduces that exact topology: one `node:events` emitter, two
 * independent facades. The bridge wiring gets facade A; the "flows extension"
 * emits through facade B. A mechanism that mutates facade A's `emit` sees
 * nothing of B's emissions — which is the proven production defect.
 *
 * This is NOT a mirror test: it drives the production wiring
 * (`registerEventBusForwarding` / `forwardBusEvent`) and the event originates
 * from a foreign facade, i.e. the exact link that fails.
 * See change: fix-automation-run-lifecycle.
 */
import { REGISTER_EVENT_FORWARD_CHANNEL } from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";
import { describe, expect, it } from "vitest";
import * as wiring from "../flow-event-wiring.js";
import {
  EVENT_BUS_MAP_FOR_TEST,
  forwardBusEvent,
  forwardedBusChannels,
  registerEventBusForwarding,
} from "../flow-event-wiring.js";
import { PluginForwardRegistry } from "../plugin-event-forward-registry.js";
import { makeDeps, makeHost } from "./helpers/event-bus-host.js";

describe("EventBus forwarding across per-extension facades", () => {
  it("forwards subagents:completed emitted by a FOREIGN extension facade", () => {
    const host = makeHost();
    const { deps, sent } = makeDeps();
    registerEventBusForwarding(host.bridgeEvents, deps);

    host.foreignEvents.emit("subagents:completed", { agentId: "a1", status: "success" });

    expect(sent.find((s) => s.channel === "subagents:completed")?.data).toEqual({
      agentId: "a1",
      status: "success",
    });
  });

  it("forwards a foreign subagent channel and marks it forwarded", () => {
    const host = makeHost();
    const { deps, sent, marked } = makeDeps();
    registerEventBusForwarding(host.bridgeEvents, deps);

    host.foreignEvents.emit("subagents:completed", { id: "a1" });

    expect(sent.map((s) => s.channel)).toContain("subagents:completed");
    expect(marked.map((s) => s.channel)).toContain("subagents:completed");
  });

  it("does not forward a foreign emission while the session is not ready", () => {
    const host = makeHost();
    const { deps, sent, buffered } = makeDeps({ isSessionReady: () => false });
    registerEventBusForwarding(host.bridgeEvents, deps);

    host.foreignEvents.emit("subagents:started", { id: "a1" });

    expect(sent).toHaveLength(0);
    // subagent frames are reconcilable state → buffered, not dropped
    expect(buffered.map((s) => s.channel)).toEqual(["subagents:started"]);
  });

  it("forwards the bridge's OWN emission exactly once (no double-forward)", () => {
    const host = makeHost();
    const { deps, sent } = makeDeps();
    registerEventBusForwarding(host.bridgeEvents, deps);

    host.bridgeEvents.emit("subagents:completed", { id: "a1" });

    expect(sent.filter((s) => s.channel === "subagents:completed")).toHaveLength(1);
  });

  it("subscribes every channel in the rename mapping", () => {
    const host = makeHost();
    const { deps, sent } = makeDeps();
    registerEventBusForwarding(host.bridgeEvents, deps);

    const channels = forwardedBusChannels();
    expect(channels.length).toBeGreaterThan(0);
    for (const channel of channels) host.foreignEvents.emit(channel, { probe: channel });

    expect(sent.map((s) => s.channel).sort()).toEqual([...channels].sort());
    // and the mapping itself is the declaration point
    expect(Object.keys(EVENT_BUS_MAP_FOR_TEST).sort()).toEqual([...channels].sort());
  });

  it("keeps delivering to other subscribers when forwarding throws", () => {
    const host = makeHost();
    const { deps } = makeDeps({
      sendEventForward: () => {
        throw new Error("transport down");
      },
    });
    // Assert the isolation in `forwardBusEvent` ITSELF: the host wraps `on`
    // handlers in its own try/catch, so going through the bus would still pass
    // if forwardBusEvent lost its catch block. See CodeRabbit review, PR #456.
    expect(() => forwardBusEvent(deps, "subagents:completed", { id: "a1" })).not.toThrow();
    registerEventBusForwarding(host.bridgeEvents, deps);

    const seen: unknown[] = [];
    host.foreignEvents.on("subagents:completed", (d) => seen.push(d));

    expect(() => host.foreignEvents.emit("subagents:completed", { id: "a1" })).not.toThrow();
    expect(seen).toEqual([{ id: "a1" }]);
  });

  it("dispose releases the wiring and stops forwarding", () => {
    const host = makeHost();
    const { deps, sent } = makeDeps();
    const dispose = registerEventBusForwarding(host.bridgeEvents, deps);
    dispose();

    host.foreignEvents.emit("subagents:completed", { id: "a1" });

    expect(sent).toHaveLength(0);
  });
});

/**
 * E49: the core map holds only subagent channels; flow channels reach the
 * dashboard only through the flows plugin's declaration.
 * See change: update-flows-plugin (test-plan E49).
 */
describe("core forwards no flow channel (E49)", () => {
  it("exports SUBAGENT_EVENT_MAP and no FLOW_EVENT_MAP; every core key is subagents:", () => {
    expect(wiring.SUBAGENT_EVENT_MAP).toBeDefined();
    expect("FLOW_EVENT_MAP" in wiring).toBe(false);
    for (const k of forwardedBusChannels()) expect(k.startsWith("subagents:"), k).toBe(true);
  });

  function wire(flowsEnabled: boolean) {
    const host = makeHost();
    const { deps, sent } = makeDeps();
    registerEventBusForwarding(host.bridgeEvents, deps);
    const pluginSent: string[] = [];
    const registry = new PluginForwardRegistry(host.bridgeEvents, {
      send: (eventType) => pluginSent.push(eventType),
      isSessionReady: () => true,
      isActive: () => true,
      isConnected: () => true,
      isCoreChannel: (c) => c in wiring.SUBAGENT_EVENT_MAP,
    });
    registry.attach();
    if (flowsEnabled) {
      host.foreignEvents.emit(REGISTER_EVENT_FORWARD_CHANNEL, {
        pluginId: "flows",
        channels: { "flow:flow-started": { as: "flow_started", delivery: "stream", key: "flowName" } },
      });
    }
    return { host, sent, pluginSent };
  }

  it("flows disabled: subagent forwarded, flow:flow-started not, no error", () => {
    const { host, sent, pluginSent } = wire(false);
    expect(() => {
      host.foreignEvents.emit("subagents:created", { agentId: "a" });
      host.foreignEvents.emit("flow:flow-started", { flowName: "r" });
    }).not.toThrow();
    expect(sent.map((s) => s.channel)).toEqual(["subagents:created"]);
    expect(pluginSent).toEqual([]);
  });

  it("flows enabled: exactly one flow_started through the plugin path", () => {
    const { host, sent, pluginSent } = wire(true);
    host.foreignEvents.emit("flow:flow-started", { flowName: "r" });
    expect(pluginSent).toEqual(["flow_started"]);
    expect(sent).toEqual([]);
  });
});
