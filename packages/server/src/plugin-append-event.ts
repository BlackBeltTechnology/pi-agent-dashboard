/**
 * `ctx.appendEvent` host side: store (and broadcast, unless the session is
 * replaying) an event of a type the calling plugin owns. Any other type — a pi
 * core type, a protocol type, a type another plugin owns, or one nobody owns —
 * is refused and counted, never thrown.
 *
 * See change: move-subagents-to-plugin (D4, spec plugin-synthetic-events).
 */
import type { PluginAppendResult } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { PluginPolicyRegistry } from "./plugin-policy-registry.js";

export interface PluginEventAppenderDeps {
  registry: () => PluginPolicyRegistry;
  eventStore: { insertEvent(sessionId: string, event: DashboardEvent): number };
  /** True while the session replays history: store, but do not broadcast. */
  isReplaying: (sessionId: string) => boolean;
  broadcastEvent: (sessionId: string, seq: number, event: DashboardEvent) => void;
}

export function createPluginEventAppender(
  deps: PluginEventAppenderDeps,
): (pluginId: string, sessionId: string, event: DashboardEvent) => PluginAppendResult {
  return (pluginId, sessionId, event) => {
    const registry = deps.registry();
    if (!event || typeof event.eventType !== "string" || !registry.ownsEventType(pluginId, event.eventType)) {
      registry.noteRefusedAppend();
      return { ok: false, reason: "not-owned" };
    }
    const seq = deps.eventStore.insertEvent(sessionId, event);
    const broadcast = !deps.isReplaying(sessionId);
    if (broadcast) deps.broadcastEvent(sessionId, seq, event);
    return { ok: true, seq, broadcast };
  };
}
