/**
 * flows-plugin SERVER entry.
 *
 * Owns canonical per-session flow state, emits intent broadcasts to all
 * connected clients via the bridge, handles plugin_action messages from
 * any client.
 *
 * See change: adopt-server-driven-intent-rendering.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { provideFlowsActions } from "./automation-actions.js";
import { readFlowInputs } from "./flow-inputs.js";
import { renderSessionFlowActions } from "./render-actions.js";
import { stateStore } from "./state-store.js";

const PLUGIN_ID = "flows";

/**
 * Resolve the flows available in a folder from the LIVE per-session flows list
 * (`stateStore`, populated by the bridge-forwarded `flows_list`), by mapping
 * the cwd to its running session(s) and unioning their reported `<ns>:<name>`
 * ids. Reflects package-bundled and event-registered flows that a static
 * `.pi/flows/flows` scan would miss; empty when no running session matches the
 * cwd. See change: fix-automation-flow-detection.
 */
export function makeFlowsForCwd(
  sessionManager: { listActive(): unknown[] },
  store: { getState(id: string): { flows?: Array<{ name?: unknown }> } | undefined },
): (cwd: string) => string[] {
  return (cwd: string): string[] => {
    const sessions = sessionManager.listActive() as Array<{ id?: unknown; cwd?: unknown }>;
    const ids = new Set<string>();
    for (const s of sessions) {
      if (!s || typeof s.id !== "string" || s.cwd !== cwd) continue;
      const flows = store.getState(s.id)?.flows;
      if (!flows) continue;
      for (const f of flows) {
        if (f && typeof f.name === "string") ids.add(f.name);
      }
    }
    return [...ids].sort();
  };
}

/**
 * Plugin entrypoint called by the dashboard plugin loader at boot.
 */
export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const { logger, broadcastToSubscribers, registerBrowserHandler } = ctx;
  logger.info("flows-plugin server entry activated (server-driven intents)");

  // Publish the flows automation action (flows.run) for the automation plugin
  // to collect. Pure publisher: no consume, no automation dependency, no load
  // order requirement. See change: decouple-automation-action-registry.
  // Availability + enum options resolve from the LIVE per-session flows list.
  // See change: fix-automation-flow-detection.
  const flowsForCwd = makeFlowsForCwd(ctx.sessionManager, stateStore);
  provideFlowsActions((name, value) => ctx.provide(name, value), (m) => logger.info(m), flowsForCwd);

  // Read-only endpoint: a flow's declared `inputs:` schema, for the automation
  // input-wiring UI. Never writes a flow file. See change:
  // wire-flow-inputs-in-automation.
  ctx.fastify.get("/api/plugins/flows/flow-inputs", async (req) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const cwd = typeof q.cwd === "string" ? q.cwd : process.cwd();
    const flow = typeof q.flow === "string" ? q.flow : "";
    return { inputs: flow ? readFlowInputs(cwd, flow) : [] };
  });

  /**
   * Broadcast the current intent tree for one session's slot.
   * Called from action handlers AND in response to event-store changes
   * (wired below).
   */
  function publishSessionFlowActions(sessionId: string): void {
    const state = stateStore.getState(sessionId);
    const intent = renderSessionFlowActions(state ?? { flows: [], commands: [] });
    broadcastToSubscribers({
      type: "plugin_intents",
      pluginId: PLUGIN_ID,
      sessionId,
      slot: "session-card-action-bar",
      intent,
    });
  }

  // Action handler: dispatched from any connected client.
  registerBrowserHandler("plugin_action", (msg) => {
    const m = msg as {
      pluginId?: string;
      sessionId?: string | null;
      action?: string;
      payload?: Record<string, unknown>;
    };
    if (m.pluginId !== PLUGIN_ID) return;
    if (!m.sessionId) return;

    switch (m.action) {
      case "flow.run": {
        logger.info(`flow.run from session=${m.sessionId} payload=${JSON.stringify(m.payload)}`);
        // v1: log and stub. Production wiring TBD in tasks 16.3 (likely
        // calls into pi via send_prompt with the appropriate /flows
        // command). For now, the broadcast is the proof of round-trip.
        break;
      }
      case "flow.new": {
        logger.info(`flow.new from session=${m.sessionId}`);
        break;
      }
      default:
        logger.warn(`unknown flows action: ${m.action}`);
    }
  });

  // ServerPluginContext has no native event-stream subscription API yet —
  // PluginEventStore is poll-based, not push. Live wiring (subscribe to
  // every pi event, apply to stateStore, publishSessionFlowActions on
  // change) is OUT OF SCOPE for this change and tracked as a follow-up:
  // see openspec/changes/adopt-server-driven-intent-rendering/tasks.md
  // section 29 FOLLOW-UP for the design needed to expose `subscribeAll`
  // or `onEvent(handler)` on ServerPluginContext.
  //
  // For now: the action handler is wired (browser → server round-trip
  // works), the state-store + render function are pure-tested, and intent
  // broadcasts CAN be emitted via `publishSessionFlowActions(sessionId)`
  // when something triggers a state change. End-to-end coherence will
  // become observable once the event-subscription hookup lands.
  logger.info("flows-plugin: server entry active. Event-stream subscription deferred to follow-up.");

  // Suppress unused-warning until wired.
  void publishSessionFlowActions;
}

export default registerPlugin;
