/**
 * agent-teams-plugin · SERVER entry — composition root.
 *
 * Builds the team runtime (store + persistence + session driver + ops + request
 * lane) through `ServerPluginContext` and mounts the read-only REST routes.
 *
 * See change: add-agent-teams-core.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { mountTeamsRoutes } from "./routes.js";
import { createTeamsRuntime } from "./runtime.js";

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const runtime = createTeamsRuntime(ctx);
  ctx.onShutdown(() => runtime.dispose());
  const identity = ctx.identity;
  await mountTeamsRoutes(ctx.fastify, {
    store: runtime.store,
    telemetry: runtime.telemetry,
    ext: runtime.ext,
    logger: ctx.logger,
    ...(identity ? { principalOf: (req: unknown) => identity.principalOf(req) } : {}),
  });
}

/** @alias */
export default registerPlugin;
