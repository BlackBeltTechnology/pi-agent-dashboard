/**
 * roles-plugin · SERVER entry.
 *
 * Mounts the read-only `GET /api/roles` route synchronously on the shared
 * Fastify instance during plugin registration (must register before the host
 * calls `fastify.listen` — the host, not the plugin, owns `listen`). No host
 * services are consumed: the route reads `~/.pi/agent/providers.json` directly,
 * so a session-less worktree can still read its role schema.
 *
 * See change: add-roles-read-api.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { mountRolesRoutes } from "./roles-routes.js";

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.logger.info("roles-plugin server entry activated");
  mountRolesRoutes(ctx.fastify);
}

export default registerPlugin;
