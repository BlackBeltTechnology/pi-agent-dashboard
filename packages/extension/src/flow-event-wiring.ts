/**
 * EventBus forwarding wiring for the CORE-mapped channels (pi-subagents
 * lifecycle only) plus the generic `dashboard:commands-changed` resend seam.
 *
 * pi-flows channels are NOT core: the flows plugin bridge declares them through
 * `dashboard:register-event-forward` (plugin-event-forward-registry.ts).
 * See change: update-flows-plugin (D1, D4).
 */

import { COMMANDS_CHANGED_CHANNEL } from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";
import type { BridgeContext } from "./bridge-context.js";
import { filterHiddenCommands } from "./bridge-context.js";

/**
 * Deps the EventBus forwarding wiring needs from the bridge. The bridge owns
 * the transport (`sendEventForward`), the readiness gates, and the subagent
 * frame buffer; this module owns WHICH channels are forwarded and HOW they are
 * observed. See change: fix-automation-run-lifecycle.
 */
export interface EventBusForwardingDeps {
  /** Send one frame as an `event_forward` (applies the channel rename map). */
  sendEventForward: (channel: string, data: Record<string, unknown>) => void;
  /** True once `session_start` established the session id. */
  isSessionReady: () => boolean;
  /** False once a newer bridge instance took over. */
  isActive: () => boolean;
  /** True while the WebSocket transport is actually open. */
  isConnected: () => boolean;
  /** Subagent-channel predicate + latest-wins buffer (reconcilable state). */
  subagent: {
    isSubagentChannel: (channel: string) => boolean;
    markForwarded: (channel: string, data: Record<string, unknown>) => void;
    buffer: (channel: string, data: Record<string, unknown>) => boolean;
    /**
     * Drop the cumulative `details.entries` timeline from a NON-terminal
     * subagent frame before it goes on the wire. MUST clone — the buffer
     * retains frames by reference, so the fat pull source stays fat.
     * See change: reduce-subagent-details-payload (D2).
     */
    stripForForward: (data: Record<string, unknown>, channel?: string) => Record<string, unknown>;
  };
}

/**
 * Forward one EventBus frame, applying the gates the bridge has always applied:
 * subagent frames forward live only when ready AND the transport is open (else
 * they are buffered latest-wins per agent); every other channel forwards when
 * ready. Forwarding failure MUST never propagate to the emitter.
 * See change: fix-automation-run-lifecycle.
 */
export function forwardBusEvent(
  deps: EventBusForwardingDeps,
  channel: string,
  data: unknown,
): void {
  try {
    const eventData = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    if (deps.subagent.isSubagentChannel(channel)) {
      if (deps.isSessionReady() && deps.isActive() && deps.isConnected()) {
        // Buffer the FAT frame, forward the thin one. The strip clones, so the
        // retained snapshot (the resync source) keeps its full timeline.
        deps.sendEventForward(channel, deps.subagent.stripForForward(eventData, channel));
        deps.subagent.markForwarded(channel, eventData);
      } else if (!deps.subagent.buffer(channel, eventData)) {
        console.warn(
          `[dashboard] subagent frame dropped (no agentId) channel=${channel} while not ready`,
        );
      }
    } else if (deps.isSessionReady() && deps.isActive()) {
      deps.sendEventForward(channel, eventData);
    }
  } catch {
    /* forwarding failure must never break event delivery */
  }
}

/** Map of pi-subagents event names to dashboard protocol event types */
export const SUBAGENT_EVENT_MAP: Record<string, string> = {
  "subagents:created": "subagent_created",
  "subagents:started": "subagent_started",
  "subagents:completed": "subagent_completed",
  "subagents:failed": "subagent_failed",
};

/** Minimal shape of the host event surface this module uses. */
interface PiEventsLike {
  emit: (channel: string, data: unknown) => void;
  on: (channel: string, handler: (data: unknown) => void) => (() => void) | void;
}

/**
 * Every EventBus channel the bridge forwards. Derived from the rename maps so a
 * mapped channel can never be silently unforwarded.
 * See change: fix-automation-run-lifecycle.
 */
export const EVENT_BUS_MAP_FOR_TEST: Record<string, string> = {
  ...SUBAGENT_EVENT_MAP,
};

export function forwardedBusChannels(extraMaps: Array<Record<string, string>> = []): string[] {
  const keys = new Set<string>();
  for (const map of [SUBAGENT_EVENT_MAP, ...extraMaps]) {
    for (const channel of Object.keys(map)) keys.add(channel);
  }
  return [...keys];
}

/**
 * Wire EventBus forwarding: ONE subscription per declared channel.
 *
 * MUST NOT wrap/replace `events.emit`. pi gives every extension its own
 * `events` facade (`createExtensionAPI` → `events: { emit, on }`) over a shared
 * bus, so mutating OUR `emit` only ever observes OUR OWN emissions — pi-flows'
 * `flow:complete` (and every other foreign emission) bypasses it entirely,
 * which left automation runs unfinalized until the max-age reaper.
 * `on()` observes every emitter. Returns a dispose releasing our subscriptions.
 * See change: fix-automation-run-lifecycle.
 */
export function registerEventBusForwarding(
  events: PiEventsLike | undefined,
  deps: EventBusForwardingDeps,
  extraMaps: Array<Record<string, string>> = [],
): () => void {
  if (!events) return () => {};
  const unsubscribers: Array<() => void> = [];
  for (const channel of forwardedBusChannels(extraMaps)) {
    const off = events.on(channel, (data: unknown) => forwardBusEvent(deps, channel, data));
    if (typeof off === "function") unsubscribers.push(off);
  }
  return () => {
    for (const off of unsubscribers) {
      try {
        off();
      } catch {
        /* keep releasing */
      }
    }
    unsubscribers.length = 0;
  };
}

/**
 * Resend `commands_list` whenever any plugin emits `dashboard:commands-changed`
 * (e.g. the flows plugin after pi-flows rediscovers or completes). The payload
 * is ignored — it is a bare signal. Core names no plugin channel here.
 * Must be called after session_start when pi.events is available.
 * See change: update-flows-plugin (D4).
 */
export function registerCommandsChangedListener(
  bc: BridgeContext,
  isSessionReady: () => boolean,
): void {
  const { pi, connection } = bc;
  if (!pi.events) return;
  pi.events.on(COMMANDS_CHANGED_CHANNEL, () => {
    if (!isSessionReady()) return;
    const commands = filterHiddenCommands(pi.getCommands());
    connection.send({ type: "commands_list", sessionId: bc.sessionId, commands });
  });
}
