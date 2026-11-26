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
 * Core maps no plugin channel, so the mechanism is exercised with a generic
 * demo channel passed as an `extraMaps` entry.
 * See change: fix-automation-run-lifecycle, move-subagents-to-plugin.
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

const DEMO = { "demo:completed": "demo_completed" };

describe("EventBus forwarding across per-extension facades", () => {
  it("forwards a mapped channel emitted by a FOREIGN extension facade", () => {
    const host = makeHost();
    const { deps, sent } = makeDeps();
    registerEventBusForwarding(host.bridgeEvents, deps, [DEMO]);

    host.foreignEvents.emit("demo:completed", { agentId: "a1", status: "success" });

    expect(sent.find((s) => s.channel === "demo:completed")?.data).toEqual({
      agentId: "a1",
      status: "success",
    });
  });

  it("does not forward a foreign emission while the session is not ready", () => {
    const host = makeHost();
    const { deps, sent } = makeDeps({ isSessionReady: () => false });
    registerEventBusForwarding(host.bridgeEvents, deps, [DEMO]);

    host.foreignEvents.emit("demo:completed", { id: "a1" });

    expect(sent).toHaveLength(0);
  });

  it("forwards the bridge's OWN emission exactly once (no double-forward)", () => {
    const host = makeHost();
    const { deps, sent } = makeDeps();
    registerEventBusForwarding(host.bridgeEvents, deps, [DEMO]);

    host.bridgeEvents.emit("demo:completed", { id: "a1" });

    expect(sent.filter((s) => s.channel === "demo:completed")).toHaveLength(1);
  });

  it("subscribes every channel in the rename mapping", () => {
    const host = makeHost();
    const { deps, sent } = makeDeps();
    registerEventBusForwarding(host.bridgeEvents, deps, [DEMO]);

    const channels = forwardedBusChannels([DEMO]);
    expect(channels).toEqual(["demo:completed"]);
    for (const channel of channels) host.foreignEvents.emit(channel, { probe: channel });

    expect(sent.map((s) => s.channel).sort()).toEqual([...channels].sort());
    // the core declaration point maps nothing
    expect(Object.keys(EVENT_BUS_MAP_FOR_TEST)).toEqual([]);
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
    expect(() => forwardBusEvent(deps, "demo:completed", { id: "a1" })).not.toThrow();
    registerEventBusForwarding(host.bridgeEvents, deps, [DEMO]);

    const seen: unknown[] = [];
    host.foreignEvents.on("demo:completed", (d) => seen.push(d));

    expect(() => host.foreignEvents.emit("demo:completed", { id: "a1" })).not.toThrow();
    expect(seen).toEqual([{ id: "a1" }]);
  });

  it("dispose releases the wiring and stops forwarding", () => {
    const host = makeHost();
    const { deps, sent } = makeDeps();
    const dispose = registerEventBusForwarding(host.bridgeEvents, deps, [DEMO]);
    dispose();

    host.foreignEvents.emit("demo:completed", { id: "a1" });

    expect(sent).toHaveLength(0);
  });
});

/**
 * E41: core has no subagent map — with the subagents plugin absent, a
 * `subagents:created` emission is not forwarded.
 * See change: move-subagents-to-plugin (test-plan E41).
 */
describe("core forwards no subagent channel (E41)", () => {
  it("exports no SUBAGENT_EVENT_MAP and forwards nothing when the plugin is absent", () => {
    expect("SUBAGENT_EVENT_MAP" in wiring).toBe(false);
    const host = makeHost();
    const { deps, sent } = makeDeps();
    registerEventBusForwarding(host.bridgeEvents, deps);
    const pluginSent: string[] = [];
    const registry = new PluginForwardRegistry(host.bridgeEvents, {
      send: (eventType) => pluginSent.push(eventType),
      isSessionReady: () => true,
      isActive: () => true,
      isConnected: () => true,
    });
    registry.setOwnership({ eventTypes: { "subagent_*": "subagents" } });
    registry.attach();

    host.foreignEvents.emit("subagents:created", { id: "a1" });

    expect(sent).toEqual([]);
    expect(pluginSent).toEqual([]);
  });
});

/**
 * E49: core maps no channel at all; flow channels reach the dashboard only
 * through the flows plugin's declaration.
 * See change: update-flows-plugin (test-plan E49).
 */
describe("core forwards no flow channel (E49)", () => {
  it("exports no channel rename map; the core channel list is empty", () => {
    expect("FLOW_EVENT_MAP" in wiring).toBe(false);
    expect("SUBAGENT_EVENT_MAP" in wiring).toBe(false);
    expect(forwardedBusChannels()).toEqual([]);
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
    });
    registry.setOwnership({ eventTypes: {} });
    registry.attach();
    if (flowsEnabled) {
      host.foreignEvents.emit(REGISTER_EVENT_FORWARD_CHANNEL, {
        pluginId: "flows",
        channels: { "flow:flow-started": { as: "flow_started", delivery: "stream", key: "flowName" } },
      });
    }
    return { host, sent, pluginSent };
  }

  it("flows disabled: nothing forwarded, no error", () => {
    const { host, sent, pluginSent } = wire(false);
    expect(() => {
      host.foreignEvents.emit("subagents:created", { agentId: "a" });
      host.foreignEvents.emit("flow:flow-started", { flowName: "r" });
    }).not.toThrow();
    expect(sent).toEqual([]);
    expect(pluginSent).toEqual([]);
  });

  it("flows enabled: exactly one flow_started through the plugin path", () => {
    const { host, sent, pluginSent } = wire(true);
    host.foreignEvents.emit("flow:flow-started", { flowName: "r" });
    expect(pluginSent).toEqual(["flow_started"]);
    expect(sent).toEqual([]);
  });
});
