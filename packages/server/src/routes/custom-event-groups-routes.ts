/**
 * Custom event group definitions REST route.
 *
 * GET /api/custom-event-groups → { groups: ClientCustomEventGroup[] }
 *
 * Exposes the resolved group definitions (id, label, default visibility, in
 * resolution order) so both display-preference surfaces can render one toggle
 * per group without a session open. Regex patterns are a server-side concern
 * and are NEVER transmitted (design D1). The payload reflects the groups file
 * as loaded at server start — restart-to-apply, like `config.json` (design D6).
 *
 * See change: add-custom-event-group-filters (task 4.4).
 */
import type { FastifyInstance } from "fastify";
import type { NetworkGuard } from "./route-deps.js";
import type { ClientCustomEventGroup } from "@blackbelt-technology/pi-dashboard-shared/custom-event-groups.js";

export function registerCustomEventGroupsRoutes(
  fastify: FastifyInstance,
  deps: {
    networkGuard: NetworkGuard;
    definitions: () => ClientCustomEventGroup[];
  },
): void {
  const { networkGuard, definitions } = deps;

  fastify.get(
    "/api/custom-event-groups",
    { preHandler: networkGuard },
    async () => {
      return { groups: definitions() };
    },
  );
}
