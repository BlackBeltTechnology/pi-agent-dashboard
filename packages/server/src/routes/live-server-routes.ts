/**
 * REST routes for live-server-preview lifecycle. The `start` endpoint is the
 * SSRF gate (loopback-only via `validateLiveTarget` inside the manager);
 * non-loopback targets are rejected 400 and never reach the proxy.
 *
 * See change: improve-content-editor (live-server-preview §6).
 */
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import type { NetworkGuard } from "./route-deps.js";

export function registerLiveServerRoutes(
  fastify: FastifyInstance,
  liveServerManager: LiveServerManager,
  deps: { networkGuard: NetworkGuard },
) {
  const { networkGuard } = deps;

  // Register (or reuse) a loopback dev-server target. Returns the proxied path.
  fastify.post<{ Body: { host?: unknown; port?: unknown; label?: unknown } }>(
    "/api/live-server/start",
    { preHandler: networkGuard },
    async (request, reply) => {
      const result = liveServerManager.start(request.body ?? {});
      if (!result.ok) {
        reply.code(400);
        return { success: false, error: result.error } satisfies ApiResponse;
      }
      return { success: true, data: { ...result.target, path: result.path } } satisfies ApiResponse;
    },
  );

  // List the persisted allowlist.
  fastify.get(
    "/api/live-server/list",
    { preHandler: networkGuard },
    async () => {
      return { success: true, data: { servers: liveServerManager.list() } } satisfies ApiResponse;
    },
  );

  // Remove a target from the allowlist.
  fastify.delete<{ Params: { id: string } }>(
    "/api/live-server/:id",
    { preHandler: networkGuard },
    async (request) => {
      liveServerManager.remove(request.params.id);
      return { success: true } satisfies ApiResponse;
    },
  );
}
