/**
 * skill-atlas plugin · SERVER entry.
 *
 * Wires the atlas service to the host seams `getPiResources` (resolved skills,
 * same cache as `/api/pi-resources`) and `onPiResourcesInvalidated` (watcher +
 * `commands_list` push), mounts `GET /api/plugins/skill-atlas/graph`, and
 * broadcasts `skill_atlas_changed` to browsers. A host lacking the seams gets a
 * 501 route and no push. See change: add-skill-atlas-screen.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { createAtlasService } from "./atlas-service.js";
import { mountAtlasRoutes } from "./routes.js";

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const getPiResources = ctx.getPiResources;
  if (!getPiResources) ctx.logger.warn("host lacks getPiResources; skill atlas disabled");
  const service = getPiResources
    ? createAtlasService({
        getPiResources,
        broadcast: (msg) => ctx.broadcastToSubscribers(msg),
        log: (msg) => ctx.logger.info(msg),
      })
    : null;
  if (service && ctx.onPiResourcesInvalidated) {
    const unsubscribe = ctx.onPiResourcesInvalidated((cwd) => service.onInvalidated(cwd));
    ctx.onShutdown(() => {
      unsubscribe();
      service.dispose();
    });
  }
  await mountAtlasRoutes(ctx.fastify, service);
}

