/**
 * `/api/plugins/craft-web/*` routes (tiers: `packages/shared/src/route-tiers.ts`):
 *   GET  status             observe  — per-app availability / version / size / reason
 *   POST prepare/:app       control  — download + install (single-flight); NEVER triggered by a static GET
 *   POST csp-report         control  — host-forwarded CSP violations; body `{app, directive}`; counts + rate-limited log only
 *
 * See change: edit-office-in-pane-with-craft-web (D3; tasks 4.3, 4.5).
 */
import type { FastifyInstance } from "fastify";
import { isClaimedApp } from "./apps.js";
import type { CraftWebService } from "./service.js";

const CRAFT_WEB_API = "/api/plugins/craft-web";

const DIRECTIVE_RE = /^[a-z][a-z0-9-]{0,39}$/;

export function registerCraftWebRoutes(fastify: FastifyInstance, service: CraftWebService): void {
  fastify.get(`${CRAFT_WEB_API}/status`, async () => service.status());

  fastify.post<{ Params: { app: string } }>(`${CRAFT_WEB_API}/prepare/:app`, async (request, reply) => {
    const outcome = await service.prepare(request.params.app);
    if (outcome.ok) return outcome;
    return reply.code(outcome.httpStatus).send({ ok: false, reason: outcome.reason, message: outcome.message });
  });

  fastify.post<{ Body: unknown }>(`${CRAFT_WEB_API}/csp-report`, { bodyLimit: 2048 }, async (request, reply) => {
    const body = request.body as { app?: unknown; directive?: unknown } | null;
    if (!body || typeof body !== "object" || !isClaimedApp(body.app) || typeof body.directive !== "string" || !DIRECTIVE_RE.test(body.directive)) {
      return reply.code(400).send({ ok: false, reason: "invalid-report" });
    }
    if (!service.reportCsp(body.app, body.directive)) return reply.code(429).send({ ok: false, reason: "rate-limited" });
    return { ok: true };
  });
}
