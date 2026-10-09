/**
 * subagents-plugin · bridge entry (runs inside every pi session as a pi extension).
 *
 * Declares the producer's per-step and in-progress-block streams to the main
 * dashboard bridge through the plugin event-forward registry, so core never
 * names these channels:
 *   - `subagents:entry` → `subagent_entry` (one finished timeline step)
 *   - `subagents:delta` → `subagent_delta` (append-only piece of the open block)
 * Both `stream` (every message kept in order while the bridge cannot forward),
 * keyed by `agentId` so one agent's deltas and entries keep their interleaving.
 *
 * Declares on activation AND on every `dashboard:bridge-ready` (load-order /
 * reload handshake). Producer contract: `pi-dashboard-subagents` ≥ 0.4.0
 * (`SubagentEntryEvent`, `SubagentDeltaEvent`).
 * See change: add-plugin-bridge-contributions.
 */
import {
  BRIDGE_READY_CHANNEL,
  type EventForwardDeclaration,
  REGISTER_EVENT_FORWARD_CHANNEL,
} from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";

export const SUBAGENTS_FORWARD_DECLARATION: EventForwardDeclaration = {
  pluginId: "subagents",
  channels: {
    "subagents:entry": { as: "subagent_entry", delivery: "stream", key: "agentId" },
    "subagents:delta": { as: "subagent_delta", delivery: "stream", key: "agentId" },
  },
};

interface EventsLike {
  emit: (channel: string, data: unknown) => void;
  on?: (channel: string, handler: (data: unknown) => void) => unknown;
}

export default function activate(ctx: unknown): void {
  const c = ctx as { pi?: { events?: EventsLike }; events?: EventsLike } | undefined;
  const events = c?.pi?.events ?? c?.events;
  if (!events || typeof events.emit !== "function") return;
  const declare = () => {
    try {
      events.emit(REGISTER_EVENT_FORWARD_CHANNEL, SUBAGENTS_FORWARD_DECLARATION);
    } catch {
      /* never break session start */
    }
  };
  declare();
  events.on?.(BRIDGE_READY_CHANNEL, declare);
}
