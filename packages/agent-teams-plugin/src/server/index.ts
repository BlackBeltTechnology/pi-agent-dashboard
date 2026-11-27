/**
 * agent-teams-plugin · SERVER entry — composition root.
 *
 * Builds the team runtime (store + persistence + session driver + ops + request
 * lane) through `ServerPluginContext`, mounts the REST routes (reads + the two
 * user controls) and starts the UI bridge (coalesced `agent-teams:changed` frames
 * and the lead stamp). The owner rule is registered with core's
 * `setRouteVisibility` BEFORE the first request; if that cannot be done the plugin
 * refuses to start (an unregistered hook would silently show every team).
 *
 * See change: add-agent-teams-core, add-agent-teams-ui.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { systemClock } from "../shared/clock.js";
import { activateAccess, canViewTeam, createAccess } from "./access.js";
import { mintEpoch } from "./epoch.js";
import { mountTeamsRoutes } from "./routes.js";
import { createTeamsRuntime } from "./runtime.js";
import { createUiBridge } from "./ui-bridge.js";
import { createUiCounters } from "./ui-counters.js";
import { createUserActions } from "./user-actions.js";

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  // Registers mode `in-process` + lane `agent-teams/inproc`; the mode fails closed (`mode_unavailable`) until the upstream capability handshake succeeds.
  const runtime = createTeamsRuntime(ctx, { inProcess: true });
  ctx.onShutdown(() => runtime.dispose());
  const identity = ctx.identity;

  const access = createAccess(identity);
  activateAccess(access);
  if (runtime.ext.routeVisibility !== canViewTeam) {
    try {
      runtime.ext.setRouteVisibility(canViewTeam);
    } catch (err) {
      throw new Error(`agent-teams: cannot register the team visibility rule (${(err as Error).message}); refusing to serve teams unfiltered`);
    }
  }

  const epoch = mintEpoch();
  const counters = createUiCounters({ logger: ctx.logger, clock: systemClock });
  const userActions = createUserActions({ store: runtime.store, ops: runtime.ops, clock: systemClock });
  const bridge = createUiBridge({ store: runtime.store, host: ctx, epoch, clock: systemClock, logger: ctx.logger, counters });
  ctx.onShutdown(() => {
    bridge.dispose();
    userActions.dispose();
    counters.dispose();
  });

  await mountTeamsRoutes(ctx.fastify, {
    store: runtime.store,
    telemetry: runtime.telemetry,
    ext: runtime.ext,
    logger: ctx.logger,
    epoch,
    access,
    userActions,
    counters,
    extraStats: (teamId) => runtime.counters.forTeam(teamId),
    ...(identity ? { principalOf: (req: unknown) => identity.principalOf(req) } : {}),
  });
}

/** @alias */
export default registerPlugin;
