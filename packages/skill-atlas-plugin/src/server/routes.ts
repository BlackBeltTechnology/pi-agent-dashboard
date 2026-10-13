/**
 * `GET /api/plugins/skill-atlas/graph?scope=project|global&cwd=<abs>`.
 *
 * Mounted inside an ENCAPSULATED Fastify scope with `@fastify/rate-limit`
 * (CodeQL js/missing-rate-limiting; loopback allow-listed). Auth/tiering is the
 * host's `ROUTE_TIERS` row (observe). 400 on bad params, 501 when the host
 * lacks `getPiResources`. Never returns SKILL.md bodies.
 * See change: add-skill-atlas-screen (design D8).
 */
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import type { SkillAtlasScope } from "../shared/types.js";
import { AtlasRequestError, type AtlasService } from "./atlas-service.js";

export const GRAPH_ROUTE = "/api/plugins/skill-atlas/graph";

export async function mountAtlasRoutes(fastify: FastifyInstance, service: AtlasService | null): Promise<void> {
  await fastify.register(async (scope) => {
    await scope.register(rateLimit, {
      global: true,
      max: 600,
      timeWindow: "1 minute",
      allowList: ["127.0.0.1", "::1"],
    });
    scope.get<{ Querystring: { scope?: string; cwd?: string } }>(GRAPH_ROUTE, async (request, reply) => {
      if (!service) {
        reply.code(501);
        return { success: false, error: "host_lacks_get_pi_resources" };
      }
      try {
        const data = await service.getGraph((request.query.scope ?? "project") as SkillAtlasScope, request.query.cwd);
        return { success: true, data };
      } catch (err) {
        if (err instanceof AtlasRequestError) {
          reply.code(400);
          return { success: false, error: err.message };
        }
        throw err;
      }
    });
  });
}
