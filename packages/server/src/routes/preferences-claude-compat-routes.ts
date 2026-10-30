/**
 * Claude subscription compat switch REST routes.
 *
 * GET   /api/preferences/claude-subscription-compat          → { claudeSubscriptionCompat: boolean }
 * PATCH /api/preferences/claude-subscription-compat { value } → { claudeSubscriptionCompat: boolean }
 *
 * Persisted via the preferences store (preferences.json, default false). On
 * change the full preferences snapshot is broadcast to every connected bridge
 * as `preferences_update`, so the flows-plugin bridge applies the docs-section
 * rewrite on the next agent run without a session restart.
 *
 * See change: retire-anthropic-messages-bridge.
 */
import type { FastifyInstance } from "fastify";
import type { PiGateway } from "../pi/pi-gateway.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import { buildPreferencesUpdate } from "../preferences-relay.js";
import type { NetworkGuard } from "./route-deps.js";

export function registerPreferencesClaudeCompatRoutes(
  fastify: FastifyInstance,
  deps: {
    preferencesStore: PreferencesStore;
    piGateway: Pick<PiGateway, "broadcast">;
    networkGuard: NetworkGuard;
  },
): void {
  const { preferencesStore, piGateway, networkGuard } = deps;

  fastify.get(
    "/api/preferences/claude-subscription-compat",
    { preHandler: networkGuard },
    async () => ({ claudeSubscriptionCompat: preferencesStore.getClaudeSubscriptionCompat() }),
  );

  fastify.patch<{ Body: { value?: unknown } }>(
    "/api/preferences/claude-subscription-compat",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body;
      if (!body || typeof body !== "object" || typeof body.value !== "boolean") {
        return reply.code(400).send({ error: "Invalid body: expected { value: boolean }" });
      }
      preferencesStore.setClaudeSubscriptionCompat(body.value);
      piGateway.broadcast(buildPreferencesUpdate(preferencesStore));
      return { claudeSubscriptionCompat: preferencesStore.getClaudeSubscriptionCompat() };
    },
  );
}
