/**
 * Git operation REST API routes (localhost-only).
 */
import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { NetworkGuard } from "./route-deps.js";
import type { SessionManager } from "../memory-session-manager.js";
import type { BrowserGateway } from "../browser-gateway.js";
import {
  addWorktree,
  checkoutBranch,
  createPullRequest,
  gitInit,
  isGitRepo,
  listBranches,
  listWorktrees,
  mergeWorktree,
  pushBranch,
  readHead,
  removeWorktree,
  stashPop,
  worktreeDiffStat,
} from "../git-operations.js";
import { activeSessionsUnder, sessionsUnder } from "../active-sessions-in-cwd.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { safeRealpathSync } from "../resolve-path.js";
import fs from "node:fs";

export interface GitRoutesDeps {
  networkGuard: NetworkGuard;
  /** Optional — worktree lifecycle endpoints need this to enumerate active sessions + broadcast cwdMissing. */
  sessionManager?: SessionManager;
  browserGateway?: BrowserGateway;
}

export function registerGitRoutes(fastify: FastifyInstance, deps: GitRoutesDeps) {
  const { networkGuard, sessionManager, browserGateway } = deps;
  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/git/branches",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      if (!cwd) {
        reply.code(400);
        return { success: false, error: "cwd parameter required" } satisfies ApiResponse;
      }
      if (!isGitRepo(cwd)) {
        return { success: false, error: "not a git repository" } satisfies ApiResponse;
      }
      try {
        const data = listBranches(cwd);
        return { success: true, data } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, error: err.message ?? "failed to list branches" } satisfies ApiResponse;
      }
    },
  );

  fastify.post<{ Body: { cwd?: string; branch?: string; stash?: boolean } }>(
    "/api/git/checkout",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd, branch, stash } = request.body ?? {};
      if (!cwd || !branch) {
        reply.code(400);
        return { success: false, error: "cwd and branch required" } satisfies ApiResponse;
      }
      try {
        const result = checkoutBranch(cwd, branch, stash ?? false);
        if (!result.success) {
          reply.code(409);
          return result;
        }
        return { success: true, data: { stashed: result.stashed } } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, error: err.message ?? "checkout failed" } satisfies ApiResponse;
      }
    },
  );

  fastify.post<{ Body: { cwd?: string } }>(
    "/api/git/init",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd } = request.body ?? {};
      if (!cwd) {
        reply.code(400);
        return { success: false, error: "cwd required" } satisfies ApiResponse;
      }
      try {
        gitInit(cwd);
        return { success: true } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, error: err.message ?? "init failed" } satisfies ApiResponse;
      }
    },
  );

  // ── Worktree endpoints ─────────────────────────────────────────────────────────
  // See change: add-worktree-spawn-dialog.

  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/git/head",
    { preHandler: networkGuard },
    async (request, reply) => {
      const validated = validateCwd(request.query.cwd);
      if (!validated.ok) {
        reply.code(400);
        return { success: false, code: validated.code, error: validated.message } satisfies ApiResponse;
      }
      if (!isGitRepo(validated.cwd)) {
        return { success: false, code: "not_a_repo", error: "not a git repository" } satisfies ApiResponse;
      }
      try {
        const head = readHead(validated.cwd);
        return { success: true, data: head } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, code: "git_failed", error: err?.message ?? "failed to read HEAD" } satisfies ApiResponse;
      }
    },
  );

  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/git/worktrees",
    { preHandler: networkGuard },
    async (request, reply) => {
      const validated = validateCwd(request.query.cwd);
      if (!validated.ok) {
        reply.code(400);
        return { success: false, code: validated.code, error: validated.message } satisfies ApiResponse;
      }
      if (!isGitRepo(validated.cwd)) {
        return { success: false, code: "not_a_repo", error: "not a git repository" } satisfies ApiResponse;
      }
      try {
        const worktrees = listWorktrees(validated.cwd);
        return { success: true, data: { worktrees } } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, code: "git_failed", error: err?.message ?? "failed to list worktrees" } satisfies ApiResponse;
      }
    },
  );

  fastify.post<{
    Body: { cwd?: string; base?: string; newBranch?: string; path?: string; force?: boolean };
  }>(
    "/api/git/worktree",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const validated = validateCwd(body.cwd);
      if (!validated.ok) {
        reply.code(400);
        return { success: false, code: validated.code, error: validated.message } satisfies ApiResponse;
      }
      if (!body.base || typeof body.base !== "string") {
        reply.code(400);
        return { success: false, code: "cwd_invalid", error: "base required" } satisfies ApiResponse;
      }
      if (!body.newBranch || typeof body.newBranch !== "string") {
        reply.code(400);
        return { success: false, code: "cwd_invalid", error: "newBranch required" } satisfies ApiResponse;
      }
      const result = addWorktree({
        cwd: validated.cwd,
        base: body.base,
        newBranch: body.newBranch,
        path: body.path,
        force: body.force === true,
      });
      if (!result.ok) {
        // 409 for state conflicts that the client should surface inline
        // (branch already taken, path collision); 400 for input errors;
        // 500 for unclassified git failures.
        const httpStatus =
          result.error === "branch_in_use" || result.error === "branch_exists" || result.error === "path_exists"
            ? 409
            : result.error === "not_a_repo" || result.error === "base_not_found"
              ? 400
              : 500;
        reply.code(httpStatus);
        return {
          success: false,
          code: result.error,
          error: result.message,
          ...(result.stderr ? { stderr: result.stderr } : {}),
        } satisfies ApiResponse;
      }
      return {
        success: true,
        data: { path: result.path, branch: result.branch, excludeAppended: result.excludeAppended },
      } satisfies ApiResponse;
    },
  );

  // ── Worktree lifecycle endpoints (remove / merge / push / pr / diff-stat) ──────────────────
  // See change: add-worktree-lifecycle-actions.

  fastify.post<{ Body: { cwd?: string; force?: boolean } }>(
    "/api/git/worktree/remove",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const validated = validateCwd(body.cwd);
      if (!validated.ok) {
        reply.code(400);
        return { success: false, code: validated.code, error: validated.message } satisfies ApiResponse;
      }
      const force = body.force === true;
      if (sessionManager) {
        const activeIds = activeSessionsUnder(validated.cwd, sessionManager.listAll());
        if (activeIds.length > 0 && !force) {
          reply.code(409);
          return {
            success: false,
            error: "active_sessions",
            code: "active_sessions",
            data: { sessionIds: activeIds },
          } satisfies ApiResponse;
        }
      }
      const result = removeWorktree({ cwd: validated.cwd, force });
      if (!result.ok) {
        const status =
          result.code === "not_a_worktree" ? 400
          : result.code === "dirty_worktree" || result.code === "branch_not_merged" ? 409
          : 500;
        reply.code(status);
        return {
          success: false,
          code: result.code,
          error: result.code,
          ...(result.stderr ? { stderr: result.stderr } : {}),
        } satisfies ApiResponse;
      }
      // Optimistic stamp: every session under the removed path gets cwdMissing: true.
      if (sessionManager && browserGateway) {
        const ids = sessionsUnder(validated.cwd, sessionManager.listAll());
        for (const id of ids) {
          sessionManager.update(id, { cwdMissing: true });
          browserGateway.broadcastSessionUpdated(id, { cwdMissing: true });
        }
      }
      return { success: true, data: { removed: true } } satisfies ApiResponse;
    },
  );

  fastify.post<{ Body: { cwd?: string; deleteBranch?: boolean } }>(
    "/api/git/worktree/merge",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const validated = validateCwd(body.cwd);
      if (!validated.ok) {
        reply.code(400);
        return { success: false, code: validated.code, error: validated.message } satisfies ApiResponse;
      }
      const baseHint = sessionManager
        ? sessionManager.listAll().find((s) => s.cwd === validated.cwd)?.gitWorktreeBase
        : undefined;
      const result = mergeWorktree({
        cwd: validated.cwd,
        baseHint,
        deleteBranch: body.deleteBranch === true,
      });
      if (!result.ok) {
        const status =
          result.code === "dirty_main" || result.code === "merge_conflict" ? 409
          : result.code === "base_not_found" ? 400
          : 500;
        reply.code(status);
        return {
          success: false,
          code: result.code,
          error: result.code,
          ...(result.stderr ? { stderr: result.stderr } : {}),
        } satisfies ApiResponse;
      }
      return { success: true, data: result.data } satisfies ApiResponse;
    },
  );

  fastify.post<{ Body: { cwd?: string; setUpstream?: boolean } }>(
    "/api/git/worktree/push",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const validated = validateCwd(body.cwd);
      if (!validated.ok) {
        reply.code(400);
        return { success: false, code: validated.code, error: validated.message } satisfies ApiResponse;
      }
      const result = pushBranch({
        cwd: validated.cwd,
        setUpstream: body.setUpstream !== false,
      });
      if (!result.ok) {
        const status =
          result.code === "no_remote" ? 400
          : result.code === "auth_failed" || result.code === "non_fast_forward" ? 409
          : 500;
        reply.code(status);
        return {
          success: false,
          code: result.code,
          error: result.code,
          ...(result.stderr ? { stderr: result.stderr } : {}),
        } satisfies ApiResponse;
      }
      return { success: true } satisfies ApiResponse;
    },
  );

  fastify.post<{ Body: { cwd?: string; title?: string; body?: string } }>(
    "/api/git/worktree/pr",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const validated = validateCwd(body.cwd);
      if (!validated.ok) {
        reply.code(400);
        return { success: false, code: validated.code, error: validated.message } satisfies ApiResponse;
      }
      const ghResolved = getDefaultRegistry().resolve("gh");
      if (!ghResolved.ok || !ghResolved.path) {
        reply.code(400);
        return {
          success: false,
          code: "gh_not_found",
          error: "gh_not_found",
        } satisfies ApiResponse;
      }
      const baseHint = sessionManager
        ? sessionManager.listAll().find((s) => s.cwd === validated.cwd)?.gitWorktreeBase
        : undefined;
      const result = createPullRequest({
        cwd: validated.cwd,
        ghPath: ghResolved.path,
        title: body.title,
        body: body.body,
        baseHint,
      });
      if (!result.ok) {
        const status =
          result.code === "gh_not_authed" ? 401
          : result.code === "pr_exists" || result.code === "pushed_but_pr_failed" ? 409
          : result.code === "base_not_found" || result.code === "no_remote" ? 400
          : 500;
        reply.code(status);
        return {
          success: false,
          code: result.code,
          error: result.code,
          ...(result.stderr ? { stderr: result.stderr } : {}),
        } satisfies ApiResponse;
      }
      return { success: true, data: result.data } satisfies ApiResponse;
    },
  );

  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/git/worktree/diff-stat",
    { preHandler: networkGuard },
    async (request, reply) => {
      const validated = validateCwd(request.query.cwd);
      if (!validated.ok) {
        reply.code(400);
        return { success: false, code: validated.code, error: validated.message } satisfies ApiResponse;
      }
      const baseHint = sessionManager
        ? sessionManager.listAll().find((s) => s.cwd === validated.cwd)?.gitWorktreeBase
        : undefined;
      const result = worktreeDiffStat({ cwd: validated.cwd, baseHint });
      if (!result.ok) {
        const status = result.code === "base_not_found" ? 400 : 500;
        reply.code(status);
        return {
          success: false,
          code: result.code,
          error: result.code,
          ...(result.stderr ? { stderr: result.stderr } : {}),
        } satisfies ApiResponse;
      }
      return { success: true, data: result.data } satisfies ApiResponse;
    },
  );

  fastify.post<{ Body: { cwd?: string } }>(
    "/api/git/stash-pop",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd } = request.body ?? {};
      if (!cwd) {
        reply.code(400);
        return { success: false, error: "cwd required" } satisfies ApiResponse;
      }
      try {
        const result = stashPop(cwd);
        return { success: true, data: result } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, error: err.message ?? "stash pop failed" } satisfies ApiResponse;
      }
    },
  );
}

/**
 * Validate and realpath a cwd query / body parameter for the worktree
 * endpoints. Returns either `{ ok: true, cwd }` (realpath-resolved) or
 * `{ ok: false, code, message }` with a stable error code.
 *
 * See change: add-worktree-spawn-dialog.
 */
function validateCwd(raw: string | undefined):
  | { ok: true; cwd: string }
  | { ok: false; code: "cwd_invalid"; message: string } {
  // (Field names: `code` is the stable classifier consumed by clients;
  // `message` is the human-readable string surfaced on the wire as
  // ApiResponse.error.)
  if (!raw || typeof raw !== "string") {
    return { ok: false, code: "cwd_invalid", message: "cwd required" };
  }
  const resolved = safeRealpathSync(raw);
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return { ok: false, code: "cwd_invalid", message: "cwd is not a directory" };
    }
  } catch {
    return { ok: false, code: "cwd_invalid", message: "cwd does not exist" };
  }
  return { ok: true, cwd: resolved };
}
