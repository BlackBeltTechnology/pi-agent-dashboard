/**
 * REST API wrappers for session control operations.
 * These expose WebSocket-only operations as HTTP endpoints
 * for use by skills, scripts, and external tooling.
 */
import type { FastifyInstance } from "fastify";
import type { SessionManager } from "./memory-session-manager.js";
import type { PiGateway } from "./pi-gateway.js";
import type { BrowserGateway } from "./browser-gateway.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { spawnPiSession } from "./process-manager.js";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { PendingForkRegistry } from "./pending-fork-registry.js";
import type { PendingResumeIntentRegistry } from "./pending-resume-intent-registry.js";
import type { BootstrapStateStore } from "./bootstrap-state.js";
import type { BootstrapQueue } from "./bootstrap-queue.js";
import { attachRenameTarget, detachShouldClearName } from "./proposal-attach-naming.js";

export interface SessionApiDeps {
  sessionManager: SessionManager;
  piGateway: PiGateway;
  browserGateway: BrowserGateway;
  pendingForkRegistry?: PendingForkRegistry;
  pendingDashboardSpawns?: Map<string, number>;
  /**
   * Bootstrap state + queue for degraded-mode gating. When omitted,
   * session operations run normally (legacy behavior for tests that
   * don't exercise the bootstrap flow). See change: unified-bootstrap-install.
   */
  bootstrapState?: BootstrapStateStore;
  bootstrapQueue?: BootstrapQueue;
  /**
   * User-resume-intent registry. Tagged in the resume endpoint so the
   * `sessionManager.onChange` ended→alive branch can distinguish a
   * REST-initiated user resume from a bridge auto-reattach on reboot.
   * See change: preserve-session-order-on-reboot.
   */
  pendingResumeIntents?: PendingResumeIntentRegistry;
}

type IdParams = { Params: { id: string } };

/** Helper: validate session exists, return it or send error response */
function getSessionOrFail(sessionManager: SessionManager, id: string): { session: any } | { error: ApiResponse } {
  const session = sessionManager.get(id);
  if (!session) return { error: { success: false, error: "session not found" } };
  return { session };
}

export function registerSessionApi(fastify: FastifyInstance, deps: SessionApiDeps) {
  const { sessionManager, piGateway, browserGateway, pendingForkRegistry, pendingDashboardSpawns, bootstrapState, bootstrapQueue, pendingResumeIntents } = deps;

  /**
   * Gate pi-dependent operations on bootstrap status. Returns:
   *   - null when ready (proceed).
   *   - `{ code: 202, body: { status: "queued", ticketId } }` when installing;
   *     the operation is enqueued and will run once status flips to "ready".
   *   - `{ code: 503, body: { error } }` when failed.
   * See change: unified-bootstrap-install §5.
   */
  function gateOrEnqueue<T>(handler: () => Promise<T>):
    | null
    | { code: 202; body: { status: "queued"; ticketId: string } }
    | { code: 503; body: { error: string; bootstrap: "failed" | "version-too-old" } } {
    if (!bootstrapState) return null;
    const snap = bootstrapState.get();
    // Block when pi version is below the configured minimum —
    // even when status is "ready", a too-old pi must not run sessions.
    // See change: unified-bootstrap-install §9.3.
    if (
      snap.status === "ready"
      && snap.error?.message?.startsWith("pi version ")
    ) {
      return {
        code: 503,
        body: { error: snap.error.message, bootstrap: "version-too-old" },
      };
    }
    if (snap.status === "ready") return null;
    if (snap.status === "installing") {
      if (!bootstrapQueue) {
        return {
          code: 202,
          body: { status: "queued", ticketId: "" },
        };
      }
      const ticket = bootstrapQueue.enqueue(handler);
      return {
        code: 202,
        body: { status: "queued", ticketId: ticket.ticketId },
      };
    }
    // status === "failed"
    return {
      code: 503,
      body: { error: "pi not installed (bootstrap failed)", bootstrap: "failed" },
    };
  }

  // POST /api/session/:id/prompt
  fastify.post<IdParams & { Body: { text?: string; images?: any[] } }>(
    "/api/session/:id/prompt",
    async (request, reply) => {
      const { id } = request.params;
      const { text, images } = request.body ?? {};
      if (!text) {
        reply.code(400);
        return { success: false, error: "text is required" } satisfies ApiResponse;
      }
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      const sent = piGateway.sendToSession(id, {
        type: "send_prompt",
        sessionId: id,
        text,
        images,
      });
      if (!sent) {
        reply.code(502);
        return { success: false, error: "no bridge connection for session" } satisfies ApiResponse;
      }
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/abort
  fastify.post<IdParams>(
    "/api/session/:id/abort",
    async (request, reply) => {
      const { id } = request.params;
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      piGateway.sendToSession(id, { type: "abort", sessionId: id });
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/shutdown
  fastify.post<IdParams>(
    "/api/session/:id/shutdown",
    async (request, reply) => {
      const { id } = request.params;
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      piGateway.sendToSession(id, { type: "shutdown", sessionId: id });
      browserGateway.headlessPidRegistry.killBySessionId(id);
      sessionManager.unregister(id);
      browserGateway.broadcastSessionRemoved(id);
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/rename
  fastify.post<IdParams & { Body: { name?: string } }>(
    "/api/session/:id/rename",
    async (request, reply) => {
      const { id } = request.params;
      const { name } = request.body ?? {};
      if (name === undefined) {
        reply.code(400);
        return { success: false, error: "name is required" } satisfies ApiResponse;
      }
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      const updates = { name: name || undefined };
      sessionManager.update(id, updates);
      browserGateway.broadcastSessionUpdated(id, updates);
      piGateway.sendToSession(id, { type: "rename_session", sessionId: id, name });
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/hide
  fastify.post<IdParams>(
    "/api/session/:id/hide",
    async (request, reply) => {
      const { id } = request.params;
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      const updates = { hidden: true };
      sessionManager.update(id, updates);
      browserGateway.broadcastSessionUpdated(id, updates);
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/unhide
  fastify.post<IdParams>(
    "/api/session/:id/unhide",
    async (request, reply) => {
      const { id } = request.params;
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      const updates = { hidden: false };
      sessionManager.update(id, updates);
      browserGateway.broadcastSessionUpdated(id, updates);
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/spawn
  fastify.post<{ Body: { cwd?: string } }>(
    "/api/session/spawn",
    async (request, reply) => {
      const { cwd } = request.body ?? {};
      if (!cwd) {
        reply.code(400);
        return { success: false, error: "cwd is required" } satisfies ApiResponse;
      }

      const doSpawn = async () => {
        const config = loadConfig();
        const spawnResult = await spawnPiSession(cwd, { strategy: config.spawnStrategy });
        if (spawnResult.process && spawnResult.pid) {
          browserGateway.headlessPidRegistry.register(spawnResult.pid, cwd, spawnResult.process);
        }
        if (spawnResult.dashboardSpawned && spawnResult.success) {
          pendingDashboardSpawns?.set(cwd, (pendingDashboardSpawns?.get(cwd) ?? 0) + 1);
        }
        return spawnResult;
      };

      // Bootstrap gate: if pi isn't ready, queue the spawn and return 202.
      const gate = gateOrEnqueue(doSpawn);
      if (gate) {
        reply.code(gate.code);
        return gate.body;
      }

      const spawnResult = await doSpawn();
      if (!spawnResult.success) {
        reply.code(500);
        return { success: false, error: spawnResult.message } satisfies ApiResponse;
      }
      return { success: true, data: { message: spawnResult.message } } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/resume
  fastify.post<IdParams & { Body: { mode?: string } }>(
    "/api/session/:id/resume",
    async (request, reply) => {
      const { id } = request.params;
      const { mode } = request.body ?? {};
      if (mode !== "continue" && mode !== "fork") {
        reply.code(400);
        return { success: false, error: "mode must be 'continue' or 'fork'" } satisfies ApiResponse;
      }
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      const session = result.session;
      if (!session.sessionFile) {
        reply.code(400);
        return { success: false, error: "session file is unknown" } satisfies ApiResponse;
      }
      if (mode === "continue" && session.status !== "ended") {
        reply.code(409);
        return { success: false, error: "session is already active" } satisfies ApiResponse;
      }
      if (session.resuming) {
        reply.code(409);
        return { success: false, error: "session is already being resumed" } satisfies ApiResponse;
      }
      if (mode === "fork" && pendingForkRegistry) {
        pendingForkRegistry.recordFork(session.cwd, id);
      }
      // Tag the user-resume intent BEFORE spawning. REST resume always
      // uses "front" placement — the only "keep" path is drag-to-resume
      // which goes through the WebSocket handler, not this REST endpoint.
      // See changes: preserve-session-order-on-reboot,
      //              differentiate-resume-intent-by-trigger.
      pendingResumeIntents?.record(id, "front");
      const config = loadConfig();
      const spawnResult = await spawnPiSession(session.cwd, {
        sessionFile: session.sessionFile,
        mode,
        strategy: config.spawnStrategy,
      });
      if (spawnResult.dashboardSpawned && spawnResult.success) {
        pendingDashboardSpawns?.set(session.cwd, (pendingDashboardSpawns?.get(session.cwd) ?? 0) + 1);
      }
      if (!spawnResult.success) {
        reply.code(500);
        return { success: false, error: spawnResult.message } satisfies ApiResponse;
      }
      return { success: true, data: { message: spawnResult.message } } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/flow-control
  fastify.post<IdParams & { Body: { action?: string } }>(
    "/api/session/:id/flow-control",
    async (request, reply) => {
      const { id } = request.params;
      const { action } = request.body ?? {};
      if (action !== "abort" && action !== "toggle_autonomous") {
        reply.code(400);
        return { success: false, error: "action must be 'abort' or 'toggle_autonomous'" } satisfies ApiResponse;
      }
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      piGateway.sendToSession(id, { type: "flow_control", sessionId: id, action });
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/model
  fastify.post<IdParams & { Body: { provider?: string; modelId?: string } }>(
    "/api/session/:id/model",
    async (request, reply) => {
      const { id } = request.params;
      const { provider, modelId } = request.body ?? {};
      if (!provider || !modelId) {
        reply.code(400);
        return { success: false, error: "provider and modelId are required" } satisfies ApiResponse;
      }
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      piGateway.sendToSession(id, { type: "set_model", sessionId: id, provider, modelId });
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/thinking-level
  fastify.post<IdParams & { Body: { level?: string } }>(
    "/api/session/:id/thinking-level",
    async (request, reply) => {
      const { id } = request.params;
      const { level } = request.body ?? {};
      if (!level) {
        reply.code(400);
        return { success: false, error: "level is required" } satisfies ApiResponse;
      }
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      piGateway.sendToSession(id, { type: "set_thinking_level", sessionId: id, level });
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/attach-proposal
  fastify.post<IdParams & { Body: { changeName?: string } }>(
    "/api/session/:id/attach-proposal",
    async (request, reply) => {
      const { id } = request.params;
      const { changeName } = request.body ?? {};
      if (!changeName) {
        reply.code(400);
        return { success: false, error: "changeName is required" } satisfies ApiResponse;
      }
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      const updates: Record<string, unknown> = { attachedProposal: changeName };
      const session = result.session;
      // Idempotent auto-rename (see change: fix-mobile-attach-proposal-display).
      const newName = attachRenameTarget(session, changeName);
      if (newName !== undefined) {
        updates.name = newName;
        piGateway.sendToSession(id, { type: "rename_session", sessionId: id, name: newName });
      }
      sessionManager.update(id, updates);
      browserGateway.broadcastSessionUpdated(id, updates);
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/detach-proposal
  fastify.post<IdParams>(
    "/api/session/:id/detach-proposal",
    async (request, reply) => {
      const { id } = request.params;
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      const session = result.session;
      const updates: Record<string, unknown> = {
        attachedProposal: null, openspecPhase: null, openspecChange: null,
      };
      // Idempotent auto-revert (see change: fix-mobile-attach-proposal-display).
      if (detachShouldClearName(session)) {
        updates.name = undefined;
        piGateway.sendToSession(id, { type: "rename_session", sessionId: id, name: "" });
      }
      sessionManager.update(id, updates);
      browserGateway.broadcastSessionUpdated(id, updates);
      return { success: true } satisfies ApiResponse;
    },
  );
}
