/**
 * invoicebot-plugin · bridge entry.
 *
 * Auto-registered as a pi extension (manifest `bridge` entry → mirrored into
 * `settings.json#dashboardPluginBridges` → `packages[]`), running in-session
 * alongside the invoice engine extension.
 *
 * Behavior (intentionally thin, mirrors goal-plugin): subscribe to the
 * DECLARED `ib:*` lifecycle channels via `pi.events.on` — `on()` observes
 * every emitter on the shared bus, including the engine's foreign extension
 * facade (an emit intercept never would) — and re-emit each event on the
 * generic `dashboard:plugin-message` channel. The main bridge wraps that in a
 * `plugin_pi_message` envelope; the plugin SERVER rebroadcasts it app-level.
 *
 * Undeclared channels are NOT forwarded (declared-set semantics). The rename
 * is mechanical (`:`/`-` → `_`). See change:
 * relocate-ib-domain-events-to-plugin.
 */
import { IB_CHANNELS, IB_DOMAIN_EVENT_MESSAGE, IB_PLUGIN_ID, renameIbChannel } from "../shared/ib-events.js";

interface PiEventsLike {
  emit: (channel: string, data: unknown) => void;
  on: (channel: string, handler: (data: unknown) => void) => unknown;
}

interface PiLike {
  events?: PiEventsLike;
}

export default function activate(ctx: unknown): void {
  const c = ctx as { pi?: PiLike } | PiLike;
  const pi = ((c as { pi?: PiLike }).pi ?? c) as PiLike;
  const events = pi?.events;
  if (!events || typeof events.on !== "function" || typeof events.emit !== "function") return;

  for (const channel of IB_CHANNELS) {
    const eventType = renameIbChannel(channel);
    events.on(channel, (data: unknown) => {
      try {
        events.emit("dashboard:plugin-message", {
          pluginId: IB_PLUGIN_ID,
          messageType: IB_DOMAIN_EVENT_MESSAGE,
          payload: { eventType, data },
        });
      } catch {
        /* forwarding failure must never break the emitter */
      }
    });
  }
}
