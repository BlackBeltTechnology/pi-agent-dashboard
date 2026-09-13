/**
 * mcp-client-plugin · SERVER entry.
 *
 * Builds the `mcp-client.config` service with the real filesystem IO and the
 * host's known-folder set, provides it BEFORE any route is registered, then
 * mounts the REST surface.
 * See change: extract-mcp-client-plugin (task 4.1).
 */

import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { createRealConfigIO } from "../core/config-io.js";
import { createMcpClientConfigService } from "../core/service.js";
import { mountMcpClientRoutes } from "./routes.js";

const SERVICE_KEY = "mcp-client.config";
const HOST_KNOWN_FOLDERS = "host.knownFolderCwds";
const DEFAULT_TIMEOUT_MS = 10_000;

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.logger.info("mcp-client server entry activated");
  const hostKnown = ctx.consume<() => string[]>(HOST_KNOWN_FOLDERS);
  const knownCwds = (): string[] => (hostKnown ? hostKnown() : []);
  const runtime = createMcpClientConfigService({ configIO: createRealConfigIO(), knownCwds });

  // Provide the service before routes so a dependent plugin registering later
  // observes it during its own registration.
  ctx.provide(SERVICE_KEY, runtime);

  mountMcpClientRoutes(ctx.fastify, {
    runtime,
    knownCwds,
    networkGuard: ctx.networkGuard,
    getTimeoutMs: () => {
      const cfg = ctx.getPluginConfig() as { adapterLoadTimeoutMs?: number } | undefined;
      return cfg?.adapterLoadTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    },
  });
}

export default registerPlugin;
