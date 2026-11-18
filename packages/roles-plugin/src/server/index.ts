/**
 * roles-plugin · SERVER entry.
 *
 * Mounts the read-only `GET /api/roles` route synchronously on the shared
 * Fastify instance during plugin registration (must register before the host
 * calls `fastify.listen` — the host, not the plugin, owns `listen`). The route
 * reads `~/.pi/agent/providers.json` directly, so a session-less worktree can
 * still read its role schema. Optional host services `host.remirrorPiDefaults`
 * / `host.defaultModelRef` are consumed lazily (absent → no-op).
 *
 * See change: add-roles-read-api, default-model-follows-role.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { readRoleConfigFromDisk } from "@blackbelt-technology/pi-dashboard-shared/role-config-disk.js";
import { registerDefaultModelUsage, remirrorPiDefaults } from "./host-default-model.js";
import { createRoleBindings } from "./role-bindings.js";
import { startRoleWatcher } from "./role-watcher.js";
import { mountRolesRoutes } from "./roles-routes.js";

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.logger.info("roles-plugin server entry activated");

  // `roles.bindings` service: provided synchronously during registration (never
  // inside a hook) so consumers can `consume` it in their own `onReady`.
  const engine = createRoleBindings({
    storePath: join(getDashboardConfigDir(), "role-bindings.json"),
    readRoleConfig: () => readRoleConfigFromDisk(),
    logger: ctx.logger,
  });
  ctx.provide("roles.bindings", engine.service);
  mountRolesRoutes(ctx.fastify, { getUsedBy: () => engine.service.getUsedBy() });
  // Settings default model listed under its role; host ref read lazily.
  // See change: default-model-follows-role (D5).
  const consume = <T>(key: string): T | undefined => ctx.consume<T>(key);
  registerDefaultModelUsage(consume, engine.service);

  // Boot pass is SCHEDULED, not awaited (Fastify awaits onReady hooks
  // sequentially). Correctness for late projectors rests on the targeted pass
  // each `registerProjector` triggers. See change: add-role-aware-model-refs (D2).
  ctx.fastify.addHook("onReady", async () => {
    setImmediate(() => {
      void engine.runPass("boot");
    });
    const watcher = startRoleWatcher({
      dir: join(homedir(), ".pi", "agent"),
      readRoles: () => readRoleConfigFromDisk().roles,
      onChange: () => {
        void engine.runPass("change");
        // Host re-mirrors the `@role` default into pi when its resolution moved (D4).
        remirrorPiDefaults(consume, (m) => ctx.logger.warn(m));
      },
      onError: (e) => ctx.logger.warn(`[roles.bindings] watcher: ${e instanceof Error ? e.message : String(e)}`),
    });
    ctx.onShutdown(() => watcher.close());
  });
}

export default registerPlugin;
