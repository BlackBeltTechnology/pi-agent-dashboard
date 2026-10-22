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
import {
  type CanvasTypesScope,
  readCanvasTypesScopes,
  writeCanvasTypesScope,
} from "../canvas/canvas-settings.js";
import { admitOptionalCwd, sendCwdFailure } from "../lib/file-cwd-admission.js";
import type { RouteAdmissionDeps } from "../lib/route-admission.js";
import type { NetworkGuard } from "./route-deps.js";

interface PatchBody {
  scope?: CanvasTypesScope;
  cwd?: string;
  canvasTypes?: Record<string, unknown>;
}

/** Validate a PATCH body; returns an error string or null. */
function validatePatch(body: PatchBody | undefined): string | null {
  if (!body || typeof body !== "object") return "Invalid body";
  const { scope, cwd = "", canvasTypes } = body;
  if (scope !== "global" && scope !== "project")
    return "scope must be 'global' or 'project'";
  if (scope === "project" && !cwd) return "project scope requires a cwd";
  if (!canvasTypes || typeof canvasTypes !== "object" || Array.isArray(canvasTypes))
    return "canvasTypes must be an object";
  return null;
}

export function registerCanvasTypesRoutes(
  fastify: FastifyInstance,
  deps: {
    networkGuard: NetworkGuard;
    /**
     * Shared cwd admission (change: core-file-cwd-admission): a supplied `cwd` must be admitted;
     * no `cwd` keeps the global scope. Absent → fail-closed (nothing is known).
     */
    routeAdmission?: RouteAdmissionDeps;
  },
): void {
  const { networkGuard } = deps;
  const routeAdmission: RouteAdmissionDeps = deps.routeAdmission ?? {};

  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/canvas-types",
    { preHandler: networkGuard },
    async (request, reply) => {
      // The no-cwd branch hands the sink a constant `""`, never the request value.
      const admitted = await admitOptionalCwd(request.query.cwd, routeAdmission, reply);
      if (!admitted.ok) return sendCwdFailure(reply, admitted.failure);
      return readCanvasTypesScopes(admitted.cwd ?? "");
    },
  );

  fastify.patch<{ Body: PatchBody }>(
    "/api/canvas-types",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body;
      const err = validatePatch(body);
      if (err) return reply.code(400).send({ error: err });
      // Non-null after validatePatch passed.
      const { scope, canvasTypes } = body as Required<Pick<PatchBody, "scope" | "canvasTypes">> & PatchBody;
      const admitted = await admitOptionalCwd((body as PatchBody).cwd, routeAdmission, reply);
      if (!admitted.ok) return sendCwdFailure(reply, admitted.failure);
      try {
        return writeCanvasTypesScope(scope, admitted.cwd ?? "", canvasTypes);
      } catch (e) {
        return reply
          .code(400)
          .send({ error: e instanceof Error ? e.message : "write failed" });
      }
    },
  );
}
