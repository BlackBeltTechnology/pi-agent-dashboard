/**
 * team-plugin · SERVER entry. Mounts `/api/plugins/team/*` and the same-origin
 * app at `/apps/team/`, and runs the conversation lifecycle (spawn / resume /
 * idle ending). See change: add-team-plugin.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { HostPort, HostSession } from "./conversations.js";
import { createTeam } from "./team.js";
import type { TeamConfig } from "./types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const host: HostPort = {
    spawnSession: (o) => ctx.spawnSession(o),
    abortSpawnedRun: (a) => ctx.abortSpawnedRun(a),
    getSession: (id) => ctx.sessionManager.getSession(id) as HostSession | undefined,
    listAll: () => ctx.sessionManager.listAll() as HostSession[],
    onSessionResolved: (h) => ctx.onSessionResolved(h),
    onEvent: (h) => ctx.onEvent(h),
    registerPiHandler: (type, h) => ctx.registerPiHandler(type, h),
  };
  const team = createTeam({
    host,
    identity: ctx.identity,
    fastify: ctx.fastify,
    config: () => ctx.getPluginConfig<TeamConfig>() ?? {},
    logger: ctx.logger,
    guardExtensionPath: path.resolve(HERE, "../extension/index.ts"),
    distAppDir: path.resolve(HERE, "../../dist/app"),
  });
  await team.start();
  ctx.onShutdown(() => team.stop());
  ctx.logger.info("team plugin server entry activated");
}

export default registerPlugin;
