/**
 * Worktree auto-init preference REST routes.
 *
 * GET   /api/preferences/worktree-auto-init          → { autoInitWorktreeOnSpawn: boolean }
 * PATCH /api/preferences/worktree-auto-init { value } → { autoInitWorktreeOnSpawn: boolean }
 *
 * Backs the opt-in "Initialize on worktree" Settings toggle. Persisted via
 * the preferences store (preferences.json). The trusted-only auto-trigger
 * lives client-side; this route only stores the flag.
 *
 * See change: auto-init-worktree-on-spawn.
 */
import type { FastifyInstance } from "fastify";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { NetworkGuard } from "./route-deps.js";

export function registerPreferencesWorktreeInitRoutes(
  fastify: FastifyInstance,
  deps: {
    preferencesStore: PreferencesStore;
    networkGuard: NetworkGuard;
  },
): void {
  const { preferencesStore, networkGuard } = deps;

  fastify.get(
    "/api/preferences/worktree-auto-init",
    { preHandler: networkGuard },
    async () => {
      return { autoInitWorktreeOnSpawn: preferencesStore.getAutoInitWorktreeOnSpawn() };
    },
  );

  fastify.patch<{ Body: { value?: unknown } }>(
    "/api/preferences/worktree-auto-init",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body;
      if (!body || typeof body !== "object" || typeof body.value !== "boolean") {
        return reply.code(400).send({ error: "Invalid body: expected { value: boolean }" });
      }
      preferencesStore.setAutoInitWorktreeOnSpawn(body.value);
      return { autoInitWorktreeOnSpawn: preferencesStore.getAutoInitWorktreeOnSpawn() };
    },
  );
}
