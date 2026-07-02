/**
 * GET /api/model-proxy/diagnostics — annotated model list for diagnostics.
 *
 * Returns every known model plus the reason it is excluded from /v1/models:
 *   excludedReason: null | "no-credential" | "oauth-incompatible".
 * JWT-gated (registered on the main instance only, never the /v1 proxy port).
 *
 * See change: filter-oauth-incompatible-models, design §D3.
 */
import type { FastifyInstance } from "fastify";
import { getModelRegistry } from "../model-proxy/registry-singleton.js";

export function registerModelProxyDiagnosticsRoutes(fastify: FastifyInstance): void {
  fastify.get("/api/model-proxy/diagnostics", async (_request, reply) => {
    try {
      const registry = await getModelRegistry();
      const data = registry.getAllAnnotated().map(({ model, excludedReason }) => ({
        id: `${model.provider}/${model.id}`,
        provider: model.provider,
        excludedReason,
      }));
      return { object: "list", data };
    } catch (err: any) {
      return reply.code(503).send({
        code: "MODEL_PROXY_RUNTIME_MISSING",
        message: err.message || "Failed to resolve model proxy registry",
      });
    }
  });
}
