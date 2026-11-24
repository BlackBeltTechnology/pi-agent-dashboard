/**
 * agent-teams-plugin · SERVER entry — composition root.
 *
 * Builds the team runtime (store + persistence + session driver + ops + request
 * lane) through `ServerPluginContext`. REST reads, the dispatcher, mail delivery
 * and host spawn bindings are added by later sections of `add-agent-teams-core`
 * through the seams exposed by `createTeamsRuntime`.
 *
 * See change: add-agent-teams-core.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { createTeamsRuntime } from "./runtime.js";

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const runtime = createTeamsRuntime(ctx);
  ctx.onShutdown(() => runtime.dispose());
}

export default registerPlugin;
