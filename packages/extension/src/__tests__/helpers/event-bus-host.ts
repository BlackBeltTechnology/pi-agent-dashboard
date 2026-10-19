/**
 * Two-facade EventBus host + forwarding deps for the bridge forwarding suites.
 *
 * pi's extension loader gives every extension its own `events` surface
 * (`createExtensionAPI` → `events: { emit, on }`) over ONE shared bus; `makeHost`
 * reproduces that topology. `makeDeps` builds `EventBusForwardingDeps` that
 * record every forwarded / buffered / marked frame.
 *
 * See change: skip-rpc-probes-in-event-forwarder.
 */
import { EventEmitter } from "node:events";
import type { EventBusForwardingDeps } from "../../flow-event-wiring.js";

/** One shared bus + N independent per-extension facades — pi's real shape. */
export function makeHost() {
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

export interface Sent {
  channel: string;
  data: Record<string, unknown>;
}

export function makeDeps(over: Partial<EventBusForwardingDeps> = {}) {
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
      // Identity by default: these suites characterise FORWARDING, not the
      // strip. See change: reduce-subagent-details-payload.
      stripForForward: (data: Record<string, unknown>) => data,
    },
    ...over,
  };
  return { deps, sent, buffered, marked };
}
