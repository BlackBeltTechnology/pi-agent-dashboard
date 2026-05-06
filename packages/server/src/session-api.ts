/**
 * REST API wrappers for session control operations.
 * These expose WebSocket-only operations as HTTP endpoints
 * for use by skills, scripts, and external tooling.
 */
import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { isAbsolute } from "node:path";
import { execSync } from "node:child_process";
import type { SessionManager } from "./memory-session-manager.js";
import type { PiGateway } from "./pi-gateway.js";
import type { BrowserGateway } from "./browser-gateway.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { spawnPiSession } from "./process-manager.js";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { addWorktree, isInsideWorkTree, resolveRepoRoot } from "./worktree-manager.js";
import type { PendingForkRegistry } from "./pending-fork-registry.js";
import type { PendingResumeIntentRegistry } from "./pending-resume-intent-registry.js";
import type { BootstrapStateStore } from "./bootstrap-state.js";
import type { BootstrapQueue } from "./bootstrap-queue.js";
import { attachRenameTarget, detachShouldClearName } from "./proposal-attach-naming.js";
import { FORK_DEGRADED_TO_NEW_MESSAGE, FORK_DEGRADED_TO_NEW_CODE } from "./browser-handlers/session-action-handler.js";

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
  /**
   * Optional pending-attach registry. When provided, the resume endpoint's
   * fork-empty-session degradation path inherits the parent's
   * `attachedProposal` for the new spawn.
   * See change: fix-fork-empty-session-silent-timeout.
   */
  pendingAttachRegistry?: import("./pending-attach-registry.js").PendingAttachRegistry;
}

type IdParams = { Params: { id: string } };

/** Helper: validate session exists, return it or send error response */
function getSessionOrFail(sessionManager: SessionManager, id: string): { session: any } | { error: ApiResponse } {
  const session = sessionManager.get(id);
  if (!session) return { error: { success: false, error: "session not found" } };
  return { session };
}

export function registerSessionApi(fastify: FastifyInstance, deps: SessionApiDeps) {
  const { sessionManager, piGateway, browserGateway, pendingForkRegistry, pendingDashboardSpawns, bootstrapState, bootstrapQueue, pendingResumeIntents, pendingAttachRegistry } = deps;

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
  fastify.post<{ Body: { cwd?: string; spawnMode?: string; branch?: string; baseBranch?: string; label?: string } }>(
    "/api/session/spawn",
    async (request, reply) => {
      const { cwd, spawnMode, branch, baseBranch, label } = request.body ?? {};
      if (!cwd) {
        reply.code(400);
        return { success: false, error: "cwd is required" } satisfies ApiResponse;
      }

      // ── Worktree spawn mode validation ──────────────────────────────
      if (spawnMode === "worktree") {
        // `branch` is the NEW branch to create in the worktree.
        // `baseBranch` (optional) is the branch to branch FROM.
        // If baseBranch is omitted, `branch` must already exist.
        if (!branch || typeof branch !== "string" || branch.length === 0) {
          reply.code(400);
          return { success: false, error: "branch is required for worktree spawn" } satisfies ApiResponse;
        }
        if (baseBranch && typeof baseBranch !== "string") {
          reply.code(400);
          return { success: false, error: "baseBranch must be a string" } satisfies ApiResponse;
        }
        // Validate branch name characters
        if (!/^[a-zA-Z0-9._\/-]+$/.test(branch)) {
          reply.code(400);
          return { success: false, error: `Invalid branch name: "${branch}"` } satisfies ApiResponse;
        }
        if (baseBranch && !/^[a-zA-Z0-9._\/-]+$/.test(baseBranch)) {
          reply.code(400);
          return { success: false, error: `Invalid base branch name: "${baseBranch}"` } satisfies ApiResponse;
        }
        // Validate cwd is absolute
        if (!isAbsolute(cwd)) {
          reply.code(400);
          return { success: false, error: "cwd must be an absolute path" } satisfies ApiResponse;
        }
        // Check git repo
        if (!isInsideWorkTree(cwd)) {
          reply.code(400);
          return { success: false, error: "not_a_git_repo" } satisfies ApiResponse;
        }
      }

      const doSpawn = async () => {
        const config = loadConfig();

        // Build pre-spawn hook for worktree mode
        let preSpawnHook: ((ctx: { cwd: string; branch?: string; label?: string }) => Promise<string>) | undefined;
        if (spawnMode === "worktree" && branch) {
          preSpawnHook = async (ctx) => {
            const repoRoot = resolveRepoRoot(ctx.cwd);
            const result = addWorktree(repoRoot, branch, {
              label: label ?? undefined,
              baseBranch: baseBranch ?? undefined,
            });
            try {
              execSync("npm install", { cwd: result.path, stdio: "pipe", timeout: 120_000 });
            } catch { /* non-fatal */ }
            return result.path;
          };
        }

        const spawnResult = await spawnPiSession(cwd, {
          strategy: config.spawnStrategy,
          preSpawnHook,
          ...(branch ? { branch } as any : {}),
          ...(label ? { label } as any : {}),
        });

        if (spawnResult.process && spawnResult.pid) {
          browserGateway.headlessPidRegistry.register(
            spawnResult.pid,
            spawnResult.cwd ?? cwd,
            spawnResult.process,
          );
        }
        if (spawnResult.dashboardSpawned && spawnResult.success) {
          const actualCwd = spawnResult.cwd ?? cwd;
          pendingDashboardSpawns?.set(actualCwd, (pendingDashboardSpawns?.get(actualCwd) ?? 0) + 1);
        }
        return spawnResult;
      };

      // Bootstrap gate: if pi isn't ready, queue the spawn and return 202.
      const gate = gateOrEnqueue(doSpawn);
      if (gate) {
        reply.code(gate.code);
        return gate.body;
      }

      // Worktree spawn: return 202 immediately, do work in background
      // (npm install can take 30-120s, which times out tunnel proxies)
      if (spawnMode === "worktree" && branch) {
        reply.code(202);
        const response = { success: true, data: { status: "spawning", message: "Worktree creation started..." } } satisfies ApiResponse;
        // Fire-and-forget the actual spawn
        doSpawn().then((result) => {
          if (!result.success) {
            browserGateway.broadcastToAll({
              type: "spawn_error",
              cwd,
              strategy: loadConfig().spawnStrategy,
              message: result.message,
              code: result.code ?? "SPAWN_FAILED",
            } as any);
          }
        }).catch((err) => {
          browserGateway.broadcastToAll({
            type: "spawn_error",
            cwd,
            strategy: loadConfig().spawnStrategy,
            message: err.message ?? String(err),
            code: "SPAWN_ERRNO",
          } as any);
        });
        return response;
      }

      const spawnResult = await doSpawn();
      if (!spawnResult.success) {
        // Return structured error code when available (spec: error codes §2.5)
        const code = spawnResult.code;
        if (code === "dirty_working_tree" || code === "branch_not_found" || code === "not_a_git_repo" || code === "git_unavailable" || code === "branch_already_checked_out") {
          reply.code(400);
          return { success: false, error: code } satisfies ApiResponse;
        }
        reply.code(500);
        return { success: false, error: spawnResult.message } satisfies ApiResponse;
      }
      // Return worktreePath for worktree spawns (spec: return { sessionId, worktreePath })
      const worktreePath = spawnResult.cwd && spawnResult.cwd !== cwd ? spawnResult.cwd : undefined;
      return { success: true, data: { message: spawnResult.message, worktreePath } } satisfies ApiResponse;
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
      // Fork preflight: silent-degrade when the source has no on-disk JSONL.
      // Mirrors the WS-handler logic. See change:
      // fix-fork-empty-session-silent-timeout.
      if (mode === "fork" && !existsSync(session.sessionFile)) {
        // Inherit attachedProposal from parent.
        if (session.attachedProposal && pendingAttachRegistry) {
          pendingAttachRegistry.enqueue(session.cwd, session.attachedProposal);
        }
        const degradeConfig = loadConfig();
        const degradeResult = await spawnPiSession(session.cwd, {
          strategy: degradeConfig.spawnStrategy,
        });
        if (degradeResult.process && degradeResult.pid) {
          browserGateway.headlessPidRegistry.register(
            degradeResult.pid,
            session.cwd,
            degradeResult.process,
            degradeResult.spawnToken,
          );
        }
        if (degradeResult.dashboardSpawned && degradeResult.success) {
          pendingDashboardSpawns?.set(
            session.cwd,
            (pendingDashboardSpawns?.get(session.cwd) ?? 0) + 1,
          );
        }
        if (!degradeResult.success) {
          reply.code(500);
          return {
            success: false,
            error: degradeResult.message,
          } satisfies ApiResponse;
        }
        return {
          success: true,
          data: { message: FORK_DEGRADED_TO_NEW_MESSAGE },
          code: FORK_DEGRADED_TO_NEW_CODE,
        } satisfies ApiResponse<{ message: string }>;
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
      // Fork bookkeeping uses the spawn token (not cwd) so two concurrent
      // forks in the same cwd correlate correctly. See change:
      // spawn-correlation-token.
      if (mode === "fork" && pendingForkRegistry && spawnResult.spawnToken) {
        pendingForkRegistry.recordFork(spawnResult.spawnToken, id);
      }
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
