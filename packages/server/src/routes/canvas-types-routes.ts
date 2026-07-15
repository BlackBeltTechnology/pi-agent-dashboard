/**
 * Canvas-type registry REST routes (change: auto-canvas, Decision 6 / task 5.2).
 *
 * GET  /api/canvas-types?cwd=<cwd>            → { global, project, effective }
 * PATCH /api/canvas-types { scope, cwd?, canvasTypes } → { global, project, effective }
 *
 * PATCH writes ONLY `#dashboard.canvasTypes` for the chosen scope, preserving
 * every other key in the settings file. `project` scope requires a `cwd`
 * (the selected session's cwd). Only the 8 known kinds are accepted; unknown
 * keys are dropped server-side (`writeCanvasTypesScope` sanitizes). The
 * registry gates DETECT only — declares + manual opens bypass it — so no
 * broadcast is needed (the accumulator reads settings fresh per detect).
 */
import type { FastifyInstance } from "fastify";
import type { NetworkGuard } from "./route-deps.js";
import {
  type CanvasTypesScope,
  readCanvasTypesScopes,
  writeCanvasTypesScope,
} from "../canvas-settings.js";

interface PatchBody {
  scope?: CanvasTypesScope;
  cwd?: string;
  canvasTypes?: Record<string, unknown>;
}

export function registerCanvasTypesRoutes(
  fastify: FastifyInstance,
  deps: { networkGuard: NetworkGuard },
): void {
  const { networkGuard } = deps;

  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/canvas-types",
    { preHandler: networkGuard },
    async (request) => {
      const cwd = typeof request.query.cwd === "string" ? request.query.cwd : "";
      return readCanvasTypesScopes(cwd);
    },
  );

  fastify.patch<{ Body: PatchBody }>(
    "/api/canvas-types",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body;
      if (!body || typeof body !== "object") {
        return reply.code(400).send({ error: "Invalid body" });
      }
      const { scope, cwd = "", canvasTypes } = body;
      if (scope !== "global" && scope !== "project") {
        return reply.code(400).send({ error: "scope must be 'global' or 'project'" });
      }
      if (scope === "project" && !cwd) {
        return reply.code(400).send({ error: "project scope requires a cwd" });
      }
      if (!canvasTypes || typeof canvasTypes !== "object" || Array.isArray(canvasTypes)) {
        return reply.code(400).send({ error: "canvasTypes must be an object" });
      }
      try {
        return writeCanvasTypesScope(scope, cwd, canvasTypes);
      } catch (e) {
        return reply
          .code(400)
          .send({ error: e instanceof Error ? e.message : "write failed" });
      }
    },
  );
}
