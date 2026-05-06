/**
 * Git operation REST API routes (localhost-only).
 */
import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { NetworkGuard } from "./route-deps.js";
import { isGitRepo, listBranches, checkoutBranch, gitInit, stashPop } from "../git-operations.js";
import { listWorktrees, removeWorktree } from "../worktree-manager.js";

export function registerGitRoutes(fastify: FastifyInstance, deps: { networkGuard: NetworkGuard }) {
  const { networkGuard } = deps;
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

  // GET /api/git/worktrees — list worktrees for a repo
  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/git/worktrees",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      if (!cwd) {
        reply.code(400);
        return { success: false, error: "cwd parameter required" } satisfies ApiResponse;
      }
      if (!isGitRepo(cwd)) {
        return { success: true, data: { worktrees: [] } } satisfies ApiResponse;
      }
      try {
        const worktrees = listWorktrees(cwd);
        return { success: true, data: { worktrees } } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, error: err.message ?? "failed to list worktrees" } satisfies ApiResponse;
      }
    },
  );

  // DELETE /api/git/worktrees — remove a worktree
  fastify.delete<{ Body: { cwd?: string; path?: string } }>(
    "/api/git/worktrees",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd, path: worktreePath } = request.body ?? {};
      if (!cwd || !worktreePath) {
        reply.code(400);
        return { success: false, error: "cwd and path required" } satisfies ApiResponse;
      }
      try {
        removeWorktree(cwd, worktreePath);
        return { success: true, data: { removed: true, path: worktreePath } } satisfies ApiResponse;
      } catch (err: any) {
        if (err.code === "external_worktree_readonly") {
          reply.code(403);
          return { success: false, error: err.code } satisfies ApiResponse;
        }
        if (err.code === "cannot_remove_main_worktree") {
          reply.code(403);
          return { success: false, error: err.code } satisfies ApiResponse;
        }
        if (err.code === "not_a_worktree") {
          reply.code(404);
          return { success: false, error: err.code } satisfies ApiResponse;
        }
        reply.code(500);
        return { success: false, error: err.message ?? "failed to remove worktree" } satisfies ApiResponse;
      }
    },
  );
}
