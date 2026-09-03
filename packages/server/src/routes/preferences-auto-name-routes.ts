/**
 * Auto-session-naming preference REST routes.
 *
 * GET   /api/preferences/auto-name          → { autoNameSessions: boolean }
 * PATCH /api/preferences/auto-name { value } → { autoNameSessions: boolean }
 * GET   /api/auto-name-outcomes             → { outcomes: RetainedOutcome[] }
 *
 * Backs the global "Auto-name sessions" Settings toggle. Persisted via the
 * preferences store (preferences.json). On change the new value is broadcast
 * to every connected bridge as `preferences_update` so bridges gate their
 * automatic naming on it without a reconnect.
 *
 * See change: add-auto-session-naming, fix-auto-naming-reasoning-model.
 */
import type { FastifyInstance } from "fastify";
import type { PiGateway } from "../pi/pi-gateway.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { NetworkGuard } from "./route-deps.js";
import { autoNameOutcomes } from "../auto-name-outcome-store.js";

export function registerPreferencesAutoNameRoutes(
  fastify: FastifyInstance,
  deps: {
    preferencesStore: PreferencesStore;
    piGateway: PiGateway;
    networkGuard: NetworkGuard;
  },
): void {
  const { preferencesStore, piGateway, networkGuard } = deps;

  fastify.get(
    "/api/preferences/auto-name",
    { preHandler: networkGuard },
    async () => {
      return { autoNameSessions: preferencesStore.getAutoNameSessions() };
    },
  );

  // Read-only diagnostics: the last auto-naming outcome per session, retained
  // in a bounded in-memory map. A stop can happen with NO client subscribed —
  // the toast reaches only a connected browser — so without this an operator
  // who opens the dashboard later has no route to the reason but `server.log`.
  // See change: fix-auto-naming-reasoning-model (design D9, test-plan #F8, #F10).
  fastify.get(
    "/api/auto-name-outcomes",
    { preHandler: networkGuard },
    async () => {
      return { outcomes: autoNameOutcomes.list() };
    },
  );

  fastify.patch<{ Body: { value?: unknown } }>(
    "/api/preferences/auto-name",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body;
      if (!body || typeof body !== "object" || typeof body.value !== "boolean") {
        return reply.code(400).send({ error: "Invalid body: expected { value: boolean }" });
      }
      preferencesStore.setAutoNameSessions(body.value);
      // Relay to every connected bridge so live sessions pick up the change.
      piGateway.broadcast({ type: "preferences_update", autoNameSessions: body.value });
      return { autoNameSessions: preferencesStore.getAutoNameSessions() };
    },
  );
}
