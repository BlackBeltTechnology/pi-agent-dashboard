/**
 * Global chat-display preferences REST routes.
 *
 * GET  /api/preferences/display          \u2192 { displayPrefs: DisplayPrefs | undefined }
 * PATCH /api/preferences/display { ... } \u2192 { displayPrefs: DisplayPrefs }
 *
 * PATCH deep-merges the body's `toolCalls` field-by-field, broadcasts
 * `display_prefs_updated` to every connected browser socket, and returns
 * the new effective prefs.
 *
 * See change: configurable-chat-display.
 */
import type { FastifyInstance } from "fastify";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { NetworkGuard } from "./route-deps.js";
import type {
  ServerToBrowserMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DisplayPrefs, PartialDisplayPrefs } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";

export function registerPreferencesDisplayRoutes(
  fastify: FastifyInstance,
  deps: {
    preferencesStore: PreferencesStore;
    networkGuard: NetworkGuard;
    broadcast: (msg: ServerToBrowserMessage) => void;
  },
): void {
  const { preferencesStore, networkGuard, broadcast } = deps;

  fastify.get(
    "/api/preferences/display",
    { preHandler: networkGuard },
    async () => {
      return { displayPrefs: preferencesStore.getDisplayPrefs() };
    },
  );

  fastify.patch<{ Body: PartialDisplayPrefs }>(
    "/api/preferences/display",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body;
      if (!body || typeof body !== "object") {
        return reply.code(400).send({ error: "Invalid body" });
      }
      const merged = preferencesStore.setDisplayPrefs(body);
      broadcast({ type: "display_prefs_updated", prefs: merged });
      return { displayPrefs: merged };
    },
  );
}
