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
import type { AdmitCwdOptions } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import { provideFlowsActions } from "./automation-actions.js";
import { broadcastEditModeState, handleSetEditMode, migrateLegacyEditFlow, registerEditModeRoutes } from "./edit-mode.js";
import { FLOW_REQUEST_CATALOG_ACTION } from "../flow-catalog-contract.js";
import { registerFlowCatalog } from "./flow-catalog.js";
import { registerFlowFileRoutes } from "./flow-files.js";
import { mountFlowInputsRoute } from "./flow-inputs.js";
import { renderSessionFlowActions } from "./render-actions.js";
import { stateStore } from "./state-store.js";

const PLUGIN_ID = "flows";

/**
 * Resolve the flows available in a folder from the LIVE per-session flow catalog
 * (`stateStore`, fed by forwarded `flow_catalog` events), by mapping
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
  // The cwd is required + admitted against the host known folders (no `process.cwd()`
  // fallback); a traversal-shaped flow id is refused. See change:
  // harden-git-terminal-plugin-boundaries (S1r).
  const admitOnIndeterminate = ctx.consume<NonNullable<AdmitCwdOptions["onIndeterminate"]>>(
    "host.cwdAdmissionOnIndeterminate",
  );
  mountFlowInputsRoute(ctx.fastify, {
    knownCwds: ctx.consume<() => string[]>("host.knownFolderCwds") ?? (() => []),
    ...(admitOnIndeterminate ? { admitOptions: { onIndeterminate: admitOnIndeterminate } } : {}),
  });

  // Flow YAML / agent / code-handler files reported by this plugin's bridge,
  // so the UI can open files in runtime-registered flow dirs. Plugin-owned
  // (no host allow-list change). Mounted in an encapsulated scope carrying a
  // request rate limit (recognized by CodeQL js/missing-rate-limiting; same
  // pattern as system-one / gmail). Loopback is allow-listed.
  // See change: attach-flow-before-run.
  await registerFlowFileRoutes({
    fastify: ctx.fastify,
    networkGuard: ctx.networkGuard,
    readFileGuarded: ctx.readFileGuarded,
    registerPiRequestHandler: ctx.registerPiRequestHandler,
    sessionManager: ctx.sessionManager,
    emitEventToSession,
  });

  // Flow catalog: feed stateStore from forwarded `flow_catalog` events, ask
  // sessions to report (client ask, sibling follow, server start).
  // See change: flows-dock-chip-and-panel-actions (D3, D4).
  const catalog = registerFlowCatalog({
    onEvent: ctx.onEvent,
    onSessionEnded: ctx.onSessionEnded,
    sessionManager: ctx.sessionManager,
    emitEventToSession,
    getPluginConfig: () => ctx.getPluginConfig<Record<string, unknown>>() ?? {},
    store: stateStore,
    logger,
  });
  catalog.startServerStartAsks();

  // Edit mode: global default (`~/.pi/agent/settings.json#flows.editFlow`) +
  // per-session effective state, read-only except the guarded global PUT.
  // The dashboard never writes a repo's `.pi/settings.json` on its own.
  // See change: stop-flows-edit-mode-project-writes (D2, D4).
  const editModeDeps = { sessionManager: ctx.sessionManager, broadcastToSubscribers };
  await registerEditModeRoutes({ ...editModeDeps, fastify: ctx.fastify, networkGuard: ctx.networkGuard });

  // One-time legacy plugin-config `editFlow` → global file (D6). A failure
  // keeps the key so the next start retries.
  try {
    if ((await migrateLegacyEditFlow(ctx, { logger })) === "migrated") broadcastEditModeState(editModeDeps);
  } catch (err) {
    logger.warn(`flows: legacy editFlow migration failed: ${err instanceof Error ? err.message : String(err)}`);
  }

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
      case FLOW_REQUEST_CATALOG_ACTION: {
        // Browser ask while a session's catalog is unknown, or on chip / menu
        // / picker open (`rediscover` re-reads flows from disk first).
        // Rate-limited per session. See change: flows-dock-chip-and-panel-actions (D3).
        catalog.requestCatalog(m.sessionId, { rediscover: payload.rediscover === true });
        break;
      }
      case "flow.set-edit-mode": {
        // Explicit per-project action: the ONLY path that sends
        // flow:set-edit-mode (pi-flows writes <cwd>/.pi/settings.json).
        // `payload.enabled` is the desired value. See change:
        // stop-flows-edit-mode-project-writes (D5).
        void handleSetEditMode({ ...editModeDeps, emitEventToSession, logger }, m.sessionId, payload).catch((err) =>
          logger.warn(`flow.set-edit-mode failed: ${err instanceof Error ? err.message : String(err)}`),
        );
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
