/**
 * REST routes for pi-resource ACTIVATION (enable/disable), distinct from
 * package install/uninstall (package-routes.ts).
 *
 *   POST /api/resources/toggle  — flip a resource's activation for a scope,
 *                                 delegating the write to pi's SettingsManager.
 *   POST /api/resources/reload  — reload the sessions governed by a scope so
 *                                 pi re-reads its resource arrays.
 *
 * Concurrency: per-settings-file write mutex around the read-modify-write, so
 * two concurrent toggles of different resources can't clobber each other
 * (mirrors file-routes.ts). See change: folder-resource-activation-toggle.
 */

import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import type { SessionManager } from "../session/memory-session-manager.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import {
  applyResourceToggle,
  settingsPathForScope,
  type ToggleScope,
  type ToggleType,
} from "../pi/resource-activation-toggle.js";
import type { NetworkGuard } from "./route-deps.js";

// Per-settings-file write serialization (see file-routes.ts for the rationale).
const settingsWriteLocks = new Map<string, Promise<unknown>>();
function serializeWrite<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (settingsWriteLocks.get(key) ?? Promise.resolve()).then(task, task);
  const tail = run.then(
    () => {},
    () => {},
  );
  settingsWriteLocks.set(key, tail);
  void tail.then(() => {
    if (settingsWriteLocks.get(key) === tail) settingsWriteLocks.delete(key);
  });
  return run;
}

/** Session ids governed by a scope: local → folder prefix-match, global → all. */
function sessionsForScope(
  piGateway: PiGateway,
  sessionManager: SessionManager,
  scope: ToggleScope,
  cwd?: string,
): string[] {
  const ids = scope === "local" && cwd
    ? piGateway.findSessionsByCwd(cwd)
    : piGateway.getConnectedSessionIds();
  return ids.filter((sid) => {
    const s = sessionManager.get(sid);
    return s && s.status !== "ended";
  });
}

export function registerResourceActivationRoutes(
  fastify: FastifyInstance,
  deps: {
    networkGuard: NetworkGuard;
    piGateway: PiGateway;
    sessionManager: SessionManager;
  },
) {
  const { networkGuard, piGateway, sessionManager } = deps;

  // ── Toggle a resource's activation ──────────────────────────────
  fastify.post<{
    Body: {
      scope?: string;
      cwd?: string;
      type?: string;
      filePath?: string;
      enabled?: boolean;
      packageSource?: string;
    };
  }>("/api/resources/toggle", { preHandler: networkGuard }, async (request, reply) => {
    const body = request.body ?? {};
    const scope = body.scope === "local" ? "local" : body.scope === "global" ? "global" : null;
    if (!scope) {
      reply.code(400);
      return { success: false, error: "scope must be 'local' or 'global'" } satisfies ApiResponse;
    }

    const key = settingsPathForScope(scope, body.cwd);
    const result = await serializeWrite(key, () =>
      applyResourceToggle({
        scope,
        cwd: body.cwd,
        type: body.type as ToggleType,
        filePath: body.filePath as string,
        enabled: body.enabled as boolean,
        packageSource: body.packageSource,
      }),
    );

    if (!result.ok) {
      reply.code(result.status);
      return { success: false, error: result.error } satisfies ApiResponse;
    }

    const affectedSessions = sessionsForScope(piGateway, sessionManager, scope, body.cwd);
    return { success: true, data: { affectedSessions } } satisfies ApiResponse;
  });

  // ── Reload the sessions governed by a scope ─────────────────────
  fastify.post<{ Body: { scope?: string; cwd?: string } }>(
    "/api/resources/reload",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const scope = body.scope === "local" ? "local" : body.scope === "global" ? "global" : null;
      if (!scope) {
        reply.code(400);
        return { success: false, error: "scope must be 'local' or 'global'" } satisfies ApiResponse;
      }

      const ids = sessionsForScope(piGateway, sessionManager, scope, body.cwd);
      let reloaded = 0;
      for (const sid of ids) {
        // Count only sessions the message actually reached: sendToSession
        // returns false for a closed/absent socket, so a stale connection
        // never inflates the reported count.
        if (piGateway.sendToSession(sid, { type: "send_prompt", sessionId: sid, text: "/reload" })) {
          reloaded++;
        }
      }
      return { success: true, data: { reloaded } } satisfies ApiResponse;
    },
  );
}
