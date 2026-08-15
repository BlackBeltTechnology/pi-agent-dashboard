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
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  EVENT_BUS_MAP_FOR_TEST,
  type EventBusForwardingDeps,
  forwardBusEvent,
  forwardedBusChannels,
  registerEventBusForwarding,
} from "../flow-event-wiring.js";

/** One shared bus + N independent per-extension facades — pi's real shape. */
function makeHost() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const facade = () => ({
    emit: (channel: string, data: unknown) => {
      emitter.emit(channel, data);
    },
    on: (channel: string, handler: (data: unknown) => void) => {
      const safe = (data: unknown) => {
        try {
          handler(data);
        } catch {
          /* host swallows handler errors */
        }
      };
      emitter.on(channel, safe);
      return () => emitter.off(channel, safe);
    },
  });
  return { emitter, bridgeEvents: facade(), foreignEvents: facade() };
}

interface Sent {
  channel: string;
  data: Record<string, unknown>;
}

function makeDeps(over: Partial<EventBusForwardingDeps> = {}) {
  const sent: Sent[] = [];
  const buffered: Sent[] = [];
  const marked: Sent[] = [];
  const deps: EventBusForwardingDeps = {
    sendEventForward: (channel, data) => {
      sent.push({ channel, data });
    },
    isSessionReady: () => true,
    isActive: () => true,
    isConnected: () => true,
    subagent: {
      isSubagentChannel: (c) => c.startsWith("subagents:"),
      markForwarded: (channel, data) => {
        marked.push({ channel, data });
      },
      buffer: (channel, data) => {
        buffered.push({ channel, data });
        return true;
      },
      // Identity by default: this suite characterises FORWARDING, not the
      // strip. See change: reduce-subagent-details-payload.
      stripForForward: (data) => data,
    },
    ...over,
  };
  return { deps, sent, buffered, marked };
}

describe("EventBus forwarding across per-extension facades", () => {
  it("forwards flow:complete emitted by a FOREIGN extension facade", () => {
    const host = makeHost();
    const { deps, sent } = makeDeps();
    registerEventBusForwarding(host.bridgeEvents, deps);

    // The flows extension emits through ITS OWN facade over the same bus.
    host.foreignEvents.emit("flow:complete", { flowName: "ns:demo", status: "success" });

    expect(sent.map((s) => s.channel)).toContain("flow:complete");
    expect(sent.find((s) => s.channel === "flow:complete")?.data).toEqual({
      flowName: "ns:demo",
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

    host.foreignEvents.emit("flow:complete", { status: "success" });
    host.foreignEvents.emit("subagents:started", { id: "a1" });

    expect(sent).toHaveLength(0);
    // subagent frames are reconcilable state → buffered, not dropped
    expect(buffered.map((s) => s.channel)).toEqual(["subagents:started"]);
  });

  it("forwards the bridge's OWN emission exactly once (no double-forward)", () => {
    const host = makeHost();
    const { deps, sent } = makeDeps();
    registerEventBusForwarding(host.bridgeEvents, deps);

    host.bridgeEvents.emit("flow:complete", { status: "success" });

    expect(sent.filter((s) => s.channel === "flow:complete")).toHaveLength(1);
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
    expect(() => forwardBusEvent(deps, "flow:complete", { status: "success" })).not.toThrow();
    registerEventBusForwarding(host.bridgeEvents, deps);

    const seen: unknown[] = [];
    host.foreignEvents.on("flow:complete", (d) => seen.push(d));

    expect(() => host.foreignEvents.emit("flow:complete", { status: "success" })).not.toThrow();
    expect(seen).toEqual([{ status: "success" }]);
  });

  it("dispose releases the wiring and stops forwarding", () => {
    const host = makeHost();
    const { deps, sent } = makeDeps();
    const dispose = registerEventBusForwarding(host.bridgeEvents, deps);
    dispose();

    host.foreignEvents.emit("flow:complete", { status: "success" });

    expect(sent).toHaveLength(0);
  });
});
