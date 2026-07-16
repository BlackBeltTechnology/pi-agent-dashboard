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
  const { logger, broadcastToSubscribers, registerBrowserHandler, emitEventToSession, sendToSession } = ctx;
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

  // Action handler: dispatched from any connected client (or a bus script).
  // The gateway fans out plugin_action by pluginId, so this only fires for
  // pluginId==="flows"; the guard below is defense-in-depth.
  // See change: fix-plugin-action-fanout-and-handlers.
  registerBrowserHandler("plugin_action", (msg) => {
    const m = msg as {
      pluginId?: string;
      sessionId?: string | null;
      action?: string;
      payload?: Record<string, unknown>;
    };
    if (m.pluginId !== PLUGIN_ID) return;
    if (!m.sessionId) {
      logger.warn(`flows ${m.action ?? "(no action)"}: missing sessionId`);
      return;
    }
    const payload = m.payload ?? {};

    switch (m.action) {
      case "flow.run": {
        // Accept `flow` (intent path) or `flowName`; run in the target session
        // by emitting the `flow:run` event pi-flows consumes headlessly — the
        // same event the `flow_management run` client path and the automation
        // `flows.run` action dispatch.
        const flowName = String(payload.flow ?? payload.flowName ?? "").trim();
        if (!flowName) {
          logger.warn(`flow.run from session=${m.sessionId}: missing flow name`);
          return;
        }
        const task = typeof payload.task === "string" ? payload.task.trim() : "";
        // Reject a non-object / array `inputs` (typeof [] === "object") — pi-flows
        // consumes it as a keyed record, so an array would be malformed.
        if (
          payload.inputs !== undefined &&
          (payload.inputs === null ||
            typeof payload.inputs !== "object" ||
            Array.isArray(payload.inputs))
        ) {
          logger.warn(`flow.run session=${m.sessionId}: invalid inputs (expected object)`);
          return;
        }
        const inputs = payload.inputs as Record<string, unknown> | undefined;
        const data: Record<string, unknown> = { flowName };
        if (task) data.task = task;
        if (inputs) data.inputs = inputs;
        const delivered = emitEventToSession(m.sessionId, "flow:run", data);
        logger.info(`flow.run "${flowName}" session=${m.sessionId} delivered=${delivered}`);
        break;
      }
      case "flow.new": {
        // No dedicated server core — authoring is the manage-flows skill,
        // launched via a slash prompt into the session (mirrors the client's
        // New/Edit path). An optional `instruction` is appended.
        const instruction =
          typeof payload.instruction === "string" ? payload.instruction.trim() : "";
        const command = instruction ? `/skill:manage-flows ${instruction}` : "/skill:manage-flows";
        const delivered = sendToSession(m.sessionId, command);
        logger.info(`flow.new session=${m.sessionId} delivered=${delivered}`);
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
