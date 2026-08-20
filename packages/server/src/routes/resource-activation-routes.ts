/**
 * REST routes for pi-resource ACTIVATION (enable/disable), distinct from
 * package install/uninstall (package-routes.ts).
 *
 *   POST /api/resources/toggle  — flip a resource's activation for a scope,
 *                                 delegating the write to pi's SettingsManager.
 *   POST /api/resources/trust   — persist the project-trust decision a toggle
 *                                 asked for, so the toggle can be retried.
 *   POST /api/resources/reload  — reload the sessions governed by a scope so
 *                                 pi re-reads its resource arrays.
 *
 * A project-scope toggle of an untrusted folder returns `403` with
 * `data.trustRequired` and the offered options rather than writing a file pi
 * would ignore.
 *
 * Granting project trust is the most consequential write here — it decides
 * whether every future pi session loads untrusted extensions from that folder —
 * so the trust endpoint is doubly bounded: the client may name only an option
 * *id* (the updates are re-derived server-side), and the folder must carry an
 * outstanding trust challenge raised by a real toggle. A client can therefore
 * neither choose the trust-store updates nor choose the path they apply to.
 * See change: project-scope-disable-global-resources.
 *
 * Concurrency: per-settings-file write mutex around the read-modify-write, so
 * two concurrent toggles of different resources can't clobber each other
 * (mirrors file-routes.ts). See change: folder-resource-activation-toggle.
 */

import * as path from "node:path";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import type { SessionManager } from "../session/memory-session-manager.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import { AGENT_DIR } from "../pi/pi-resource-activation.js";
import {
  applyResourceToggle,
  settingsPathForScope,
  type ToggleScope,
  type ToggleType,
} from "../pi/resource-activation-toggle.js";
import { persistTrustDecision, trustOptionsFor } from "../pi/resource-toggle-trust.js";
import type { NetworkGuard } from "./route-deps.js";

/**
 * Folders for which a toggle returned `trustRequired` and whose decision is
 * still outstanding. The trust endpoint only acts on a folder in this set, so
 * a caller cannot plant a durable trust record for a path of its choosing.
 * Process-lifetime and in-memory: a restart simply makes the user re-toggle.
 */
const outstandingTrustChallenges = new Set<string>();

/** Test seam: clear the outstanding challenges (simulates a fresh process). */
export function __resetTrustChallenges(): void {
  outstandingTrustChallenges.clear();
}

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
  cwd: string | undefined,
  registrySessionIds: readonly string[],
): string[] {
  const ids = scope === "local" && cwd
    ? piGateway.findSessionsByCwd(cwd)
    : [...new Set([...piGateway.getConnectedSessionIds(), ...registrySessionIds])];
  return ids.filter((sid) => {
    const s = sessionManager.get(sid);
    // A session the registry knows is alive stays a target even when the
    // session map has stamped it `ended` — that stamp fires on bridge-WS
    // close, which is exactly the case the keeper/respawn ladder rescues.
    // See change: fix-out-of-band-reload.
    if (registrySessionIds.includes(sid)) return true;
    return Boolean(s) && s?.status !== "ended";
  });
}

export function registerResourceActivationRoutes(
  fastify: FastifyInstance,
  deps: {
    networkGuard: NetworkGuard;
    piGateway: PiGateway;
    sessionManager: SessionManager;
    /**
     * The server's single reload entry point. Injected rather than a raw
     * `sendToSession` loop so `POST /api/resources/reload` resolves the same
     * keeper → respawn → bridge ladder as the reload button, and emits the
     * same one-terminal-feedback-per-reload contract.
     * Resolves `"error"` / `"refused"` instead of throwing.
     * See change: fix-out-of-band-reload.
     */
    dispatchReload: (sessionId: string) => Promise<string>;
    /** Session ids the headless PID registry knows are alive. */
    registrySessionIds: () => string[];
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
      if (result.trustRequired) {
        if (body.cwd) outstandingTrustChallenges.add(path.resolve(body.cwd));
        return {
          success: false,
          error: result.error,
          data: {
            trustRequired: true,
            trustOptions: result.trustOptions,
            implicitlyTrusted: result.implicitlyTrusted,
          },
        } satisfies ApiResponse;
      }
      return { success: false, error: result.error } satisfies ApiResponse;
    }

    const affectedSessions = sessionsForScope(
      piGateway,
      sessionManager,
      scope,
      body.cwd,
      deps.registrySessionIds(),
    );
    return { success: true, data: { affectedSessions } } satisfies ApiResponse;
  });

  // ── Persist a project-trust decision for a folder ───────────────
  fastify.post<{ Body: { cwd?: string; optionId?: string } }>(
    "/api/resources/trust",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd, optionId } = request.body ?? {};
      if (!cwd || typeof cwd !== "string") {
        reply.code(400);
        return { success: false, error: "cwd is required" } satisfies ApiResponse;
      }
      if (!outstandingTrustChallenges.has(path.resolve(cwd))) {
        reply.code(409);
        return {
          success: false,
          error: "no outstanding trust decision for this folder",
        } satisfies ApiResponse;
      }
      // Re-derive the options here: the client may only name one, never supply
      // the trust-store updates itself.
      const option = trustOptionsFor(cwd).find((o) => o.id === optionId);
      if (!option) {
        reply.code(400);
        return { success: false, error: "unknown trust option" } satisfies ApiResponse;
      }
      try {
        if (option.updates.length > 0) {
          await persistTrustDecision(AGENT_DIR, option.updates);
        }
      } catch (err) {
        // The toggle stays unapplied: reporting success here would leave the
        // caller retrying a write pi will keep ignoring.
        reply.code(500);
        return {
          success: false,
          error: `failed to record the project trust decision: ${(err as Error)?.message ?? String(err)}`,
        } satisfies ApiResponse;
      }
      outstandingTrustChallenges.delete(path.resolve(cwd));
      return { success: true, data: { trusted: option.trusted } } satisfies ApiResponse;
    },
  );

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

      const ids = sessionsForScope(
        piGateway,
        sessionManager,
        scope,
        body.cwd,
        deps.registrySessionIds(),
      );
      let reloaded = 0;
      for (const sid of ids) {
        // Count only sessions a reload path actually accepted. `dispatchReload`
        // returns "error" when no path existed and "refused" for a busy
        // session, so neither inflates the reported count.
        const outcome = await deps.dispatchReload(sid);
        if (outcome !== "error" && outcome !== "refused") reloaded++;
      }
      return { success: true, data: { reloaded } } satisfies ApiResponse;
    },
  );
}
