/**
 * REST routes for pi's agent-level retry policy (pi-retry-settings capability).
 *
 *   GET /api/pi-retry  → read the effective policy from ~/.pi/agent/settings.json
 *   PUT /api/pi-retry  → validate + merge-preserving write, then reload every
 *                        connected session so the new policy takes effect at
 *                        once (pi reads its settings only at session
 *                        construction, so a write alone is inert for a running
 *                        session).
 *
 * Auth-gated identically to /api/config via the shared network guard.
 * See change: retry-forever-with-stop-control (spec `pi-retry-settings`).
 */

import type {
  GetPiRetryPolicyResponse,
  PutPiRetryPolicyRequest,
  PutPiRetryPolicyResponse,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { FastifyInstance } from "fastify";
import { readPiRetryPolicy, writePiRetryPolicy } from "../pi-agent-settings.js";
import type { NetworkGuard } from "./route-deps.js";

export function registerPiRetryRoutes(
  fastify: FastifyInstance,
  deps: {
    networkGuard: NetworkGuard;
    /** Reload every connected session; returns how many were signalled. */
    reloadConnectedSessions: () => number;
  },
) {
  const { networkGuard, reloadConnectedSessions } = deps;

  fastify.get(
    "/api/pi-retry",
    { preHandler: networkGuard },
    async (): Promise<GetPiRetryPolicyResponse> => {
      return { success: true, data: readPiRetryPolicy() };
    },
  );

  fastify.put<{ Body: PutPiRetryPolicyRequest }>(
    "/api/pi-retry",
    { preHandler: networkGuard },
    async (request, reply): Promise<PutPiRetryPolicyResponse> => {
      const result = await writePiRetryPolicy(request.body);
      if (!result.ok) {
        // A held lock is transient (503); an unparseable file needs repair in
        // the pi settings JSON editor (400). Neither reloads sessions.
        // See change: edit-pi-agent-settings (spec `pi-retry-settings`).
        if (result.error === "busy") {
          reply.code(503);
          return { success: false, error: "pi settings file is busy; try again" };
        }
        if (result.error === "parse") {
          reply.code(400);
          return { success: false, error: "pi settings.json is not valid JSON; repair it in the pi settings JSON editor" };
        }
        if (result.error === "io") {
          reply.code(500);
          return { success: false, error: "Failed to write pi settings.json" };
        }
        const detail = (result.errors ?? []).map((e) => `${e.field}: ${e.message}`).join("; ");
        reply.code(400);
        return { success: false, error: detail || "Invalid retry policy" };
      }
      // Apply to running sessions only after a successful write. A failed write
      // reloads nothing.
      const reloadedSessions = reloadConnectedSessions();
      return { success: true, data: { policy: result.policy!, reloadedSessions } };
    },
  );
}
