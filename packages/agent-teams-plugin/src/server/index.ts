/**
 * agent-teams-plugin · SERVER entry — composition root (stub).
 *
 * Later sections of `add-agent-teams-core` register the store, lane handlers,
 * REST reads, dispatcher and member driver here, all through
 * `ServerPluginContext`. The skeleton only satisfies the host plugin contract.
 *
 * See change: add-agent-teams-core.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";

export async function registerPlugin(_ctx: ServerPluginContext): Promise<void> {
  // Intentionally empty — filled by tasks 2.x–9.x.
}

export default registerPlugin;
