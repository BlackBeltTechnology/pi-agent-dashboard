/**
 * Ungated model-introspection route: GET /api/models.
 *
 * In-session-agent-reachable catalogue surface backed by the same
 * InternalRegistry that fronts /v1/models — but subject only to the
 * dashboard's own auth gate (identical posture to /api/provider-auth/status),
 * so agents can list reachable models without minting a pi-proxy-... key.
 *
 * Default: reachability-filtered rows (registry.getAvailable()).
 * ?annotated=1: every model + excludedReason (registry.getAllAnnotated()).
 * Exposes model/provider/capability/cost metadata only — never credentials.
 *
 * See change: surface-model-introspection-to-agents.
 */
import type { FastifyInstance } from "fastify";

/** Model fields the introspection route reads. Extra registry fields are ignored. */
export interface RegistryModel {
  id: string;
  provider: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: unknown;
}

type ExcludedReason = null | "no-credential" | "oauth-incompatible";

/** Minimal registry surface consumed by the introspection route. */
export interface ModelsIntrospectionRegistry {
  getAvailable(): Promise<RegistryModel[]>;
  getAllAnnotated(): Array<{ model: RegistryModel; excludedReason: ExcludedReason }>;
}

export interface ModelsIntrospectionRouteDeps {
  /** Resolve the model registry. Returns null when pi-ai is unavailable. */
  getRegistry: () => Promise<ModelsIntrospectionRegistry | null>;
}

/** Map a registry model to a native introspection row (capability/cost only). */
function toRow(m: RegistryModel, excludedReason?: ExcludedReason) {
  return {
    id: `${m.provider}/${m.id}`,
    provider: m.provider,
    ...(m.reasoning != null ? { reasoning: m.reasoning } : {}),
    ...(m.input ? { input: m.input } : {}),
    ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
    ...(m.maxTokens ? { maxTokens: m.maxTokens } : {}),
    ...(m.cost ? { cost: m.cost } : {}),
    ...(excludedReason !== undefined ? { excludedReason } : {}),
  };
}

export function registerModelsIntrospectionRoute(
  fastify: FastifyInstance,
  deps: ModelsIntrospectionRouteDeps,
): void {
  fastify.get<{ Querystring: { annotated?: string } }>("/api/models", async (request, reply) => {
    const registry = await deps.getRegistry();
    if (!registry) {
      return reply.code(503).send({
        code: "MODEL_PROXY_RUNTIME_MISSING",
        message: "pi-ai is not installed or cannot be resolved",
      });
    }

    const annotated = request.query.annotated === "1" || request.query.annotated === "true";

    if (annotated) {
      const rows = registry.getAllAnnotated().map(({ model, excludedReason }) => toRow(model, excludedReason));
      return { object: "list", data: rows };
    }

    const models = await registry.getAvailable();
    return { object: "list", data: models.map((m) => toRow(m)) };
  });
}
