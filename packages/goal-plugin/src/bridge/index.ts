/**
 * goal-plugin · bridge entry.
 *
 * Auto-registered as a pi extension (manifest `bridge` entry → mirrored into
 * `settings.json#dashboardPluginBridges` → `packages[]`). Runs in-session
 * alongside the required `@ricoyudog/pi-goal-hermes` extension.
 *
 * Behavior (intentionally thin): observe the extension's
 * `pi-goal-hermes:event` custom messages (emitted via `pi.sendMessage`, which
 * fires `message_end`), normalize their `details` into a clean
 * `GoalStatusSnapshot`, and forward it to the plugin SERVER over the generic
 * `dashboard:plugin-message` channel added in the main bridge.
 *
 * This entry NEVER runs a judge and NEVER calls `pi.sendUserMessage` —
 * continuation injection stays owned by `@ricoyudog/pi-goal-hermes`. The
 * `enqueueSystemFollowup` primitive in the main bridge is the collision-safe
 * fallback if a future plugin needs to route a continuation itself.
 *
 * See change: add-goal-continuation-plugin (design.md Decision 3).
 */
import {
  GOAL_PLUGIN_ID,
  GOAL_STATUS_MESSAGE,
  GOAL_HERMES_EVENT_CUSTOM_TYPE,
  detailsToSnapshot,
  type GoalHermesEventDetails,
} from "../shared/goal-types.js";

interface PiLike {
  on?: (event: string, handler: (event: unknown, ctx: unknown) => void) => void;
  events?: { emit: (name: string, payload: unknown) => void };
}

export default function activate(ctx: unknown): void {
  const c = ctx as { pi?: PiLike } | PiLike;
  const pi = ((c as { pi?: PiLike }).pi ?? c) as PiLike;
  if (!pi || typeof pi.on !== "function" || !pi.events) return;

  pi.on("message_end", (event: unknown) => {
    const message = (event as { message?: { customType?: string; details?: unknown } })?.message;
    if (!message || message.customType !== GOAL_HERMES_EVENT_CUSTOM_TYPE) return;
    const details = message.details as GoalHermesEventDetails | undefined;
    if (!details || typeof details.eventType !== "string") return;

    pi.events!.emit("dashboard:plugin-message", {
      pluginId: GOAL_PLUGIN_ID,
      messageType: GOAL_STATUS_MESSAGE,
      payload: detailsToSnapshot(details),
    });
  });
}
