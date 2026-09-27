/**
 * system-one-plugin · SERVER entry. Mounts `/api/system-one/*`, builds the
 * server `LlmCaller` over `ctx.modelRuntime`, and owns the managed-backend
 * supervisor: orphan cleanup on start, autostart for `autostart: true`
 * backends, and SIGTERM (then SIGKILL) of every child on server shutdown.
 * See change: add-system-one-registry.
 */
import type { AddressInfo } from "node:net";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { createServerLlmCaller } from "./llm-caller.js";
import { mountSystemOneRoutes } from "./routes.js";
import { defaultDeps, Supervisor } from "./supervisor.js";

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const supervisor = new Supervisor(
    defaultDeps(() => (ctx.fastify.server.address() as AddressInfo | null)?.port),
  );
  mountSystemOneRoutes(ctx.fastify, {
    networkGuard: ctx.networkGuard,
    llmCaller: createServerLlmCaller(ctx.modelRuntime),
    managed: supervisor,
  });
  ctx.onShutdown(() => supervisor.stopAllSync());
  supervisor
    .cleanupOrphans()
    .then((killed) => {
      if (killed) ctx.logger.info(`system-one: terminated ${killed} orphaned managed backend(s)`);
      return supervisor.autostart();
    })
    .catch((err) => ctx.logger.warn(`system-one: orphan cleanup / autostart failed: ${String(err)}`));
  ctx.logger.info("system-one routes mounted (/api/system-one/*)");
}

