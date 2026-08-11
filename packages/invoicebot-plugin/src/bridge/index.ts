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

/** Startup-race buffer cap — boot emissions are few; bound the queue hard. */
const PRE_READY_BUFFER_MAX = 64;

export default function activate(ctx: unknown): void {
  const c = ctx as { pi?: PiLike } | PiLike;
  const pi = ((c as { pi?: PiLike }).pi ?? c) as PiLike;
  const events = pi?.events;
  if (!events || typeof events.on !== "function" || typeof events.emit !== "function") return;

  // Startup-ordering hazard (measured live): this entry activates at extension
  // load, but the MAIN bridge registers its `dashboard:plugin-message` listener
  // only inside its `session_start` handler (~tens of ms later). An `ib:*`
  // emission in that window — engine init emissions like
  // `ib:connector-registered` fire during extension load — would be re-emitted
  // into a listenerless channel and silently dropped. Buffer until the main
  // bridge announces `dashboard:plugin-listener-ready`, then flush in order.
  // A re-announce (bridge re-init / reload) is an idempotent flush of an empty
  // queue. See change: relocate-ib-domain-events-to-plugin (startup race).
  let listenerReady = false;
  const preReady: Array<{ eventType: string; data: unknown }> = [];

  const send = (eventType: string, data: unknown): void => {
    try {
      events.emit("dashboard:plugin-message", {
        pluginId: IB_PLUGIN_ID,
        messageType: IB_DOMAIN_EVENT_MESSAGE,
        payload: { eventType, data },
      });
    } catch {
      /* forwarding failure must never break the emitter */
    }
  };

  events.on("dashboard:plugin-listener-ready", () => {
    listenerReady = true;
    while (preReady.length > 0) {
      const f = preReady.shift()!;
      send(f.eventType, f.data);
    }
  });

  for (const channel of IB_CHANNELS) {
    const eventType = renameIbChannel(channel);
    events.on(channel, (data: unknown) => {
      if (listenerReady) {
        send(eventType, data);
      } else if (preReady.length < PRE_READY_BUFFER_MAX) {
        preReady.push({ eventType, data });
      }
      // over cap: drop oldest-boot-noise-last semantics not needed — cap guards
      // against a never-ready session leaking memory; normal boot emits < 20.
    });
  }
}
