/**
 * Jujutsu (jj) REST API routes (localhost-only).
 *
 * Endpoints:
 *   POST /api/jj/workspace/add       — create workspace + spawn session
 *   POST /api/jj/workspace/forget    — refuses on unfolded work; force escape
 *   POST /api/jj/init-colocated      — refuses on dirty git index
 *   GET  /api/jj/workspace/list      — enumerate workspaces under cwd
 *
 * All endpoints are network-guarded. Workspace add reuses the same
 * pending-attach + spawnPiSession lever as the OpenSpec attach-and-spawn
 * flow. See changes: add-jj-workspace-plugin, add-folder-task-checker-and-spawn-attach.
 */
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import * as jj from "@blackbelt-technology/pi-dashboard-shared/platform/jj.js";
import * as git from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { BrowserGateway } from "../browser-gateway.js";
import type { PendingAttachRegistry } from "../pending-attach-registry.js";
import { spawnPiSession } from "../process-manager.js";
import type { NetworkGuard } from "./route-deps.js";
import { safeRealpathSync } from "../resolve-path.js";

/** Workspace name regex per spec (filesystem + bookmark safety). */
const NAME_RE = /^[a-z0-9-]+$/;

export interface JjRoutesDeps {
  browserGateway: BrowserGateway;
  pendingAttachRegistry: PendingAttachRegistry;
  networkGuard: NetworkGuard;
  /** Optional plugin config accessor (defaults to current dashboard config). */
  getWorkspaceRoot?: () => string;
}

/**
 * Resolve the workspace-root setting for a given repo. Currently global
 * via the plugin config; per-repo override is explicitly out of scope
 * (Decision 14). Falls back to `.shadow` when config is absent.
 */
function resolveWorkspaceRoot(deps: JjRoutesDeps): string {
  if (deps.getWorkspaceRoot) return deps.getWorkspaceRoot();
  // The plugin config is read from the dashboard config blob's `plugins.jj`
  // namespace. Until the runtime config-validator wires that path here, we
  // fall back to the documented default.
  try {
    const cfg = loadConfig() as unknown as { plugins?: { jj?: { workspaceRoot?: string } } };
    return cfg.plugins?.jj?.workspaceRoot ?? ".shadow";
  } catch {
    return ".shadow";
  }
}

/**
 * Pure preflight checks for `init-colocated`. Returns `null` on OK,
 * else a `{ code, message }` object the caller can shape into 4xx.
 */
export function checkInitColocatedPreconditions(cwd: string):
  | null
  | { code: "INVALID_CWD" | "ALREADY_JJ" | "DIRTY_INDEX" | "NOT_GIT_REPO"; message: string } {
  if (!cwd) return { code: "INVALID_CWD", message: "cwd is required" };
  if (!existsSync(cwd)) return { code: "INVALID_CWD", message: `cwd does not exist: ${cwd}` };
  if (existsSync(path.join(cwd, ".jj"))) {
    return { code: "ALREADY_JJ", message: "cwd is already a jj repo" };
  }
  if (!existsSync(path.join(cwd, ".git"))) {
    return { code: "NOT_GIT_REPO", message: "cwd is not a git repo" };
  }
  // git diff --cached --quiet exits 1 when index is dirty. Recipe-based
  // helper for clarity and consistency with the rest of the codebase.
  const indexResult = git.statusPorcelain({ cwd });
  if (indexResult.ok) {
    // Lines beginning with M, A, D, R, C, U in column 1 indicate INDEX
    // changes (column 2 is the working tree). We refuse on any column-1
    // mutation.
    const dirty = indexResult.value
      .split("\n")
      .filter((l) => l.length >= 2 && /[MADRCU]/.test(l[0]!));
    if (dirty.length > 0) {
      return {
        code: "DIRTY_INDEX",
        message:
          `git index has staged changes (${dirty.length} entr${dirty.length === 1 ? "y" : "ies"}); ` +
          `commit or 'git reset' first. See spec scenario "Init refused on dirty index".`,
      };
    }
  }
  return null;
}

export function registerJjRoutes(fastify: FastifyInstance, deps: JjRoutesDeps) {
  const { browserGateway, pendingAttachRegistry, networkGuard } = deps;

  // ── GET /api/jj/workspace/list?cwd=… ────────────────────────────────────
  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/jj/workspace/list",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      if (!cwd) {
        reply.code(400);
        return { success: false, error: "cwd is required" } satisfies ApiResponse;
      }
      if (!existsSync(path.join(cwd, ".jj"))) {
        return { success: true, data: { workspaces: [] } } satisfies ApiResponse;
      }
      const result = jj.workspaceList({ cwd });
      if (!result.ok) {
        reply.code(500);
        return {
          success: false,
          error: `jj workspace list failed: ${describeError(result.error)}`,
        } satisfies ApiResponse;
      }
      const workspaces = jj.parseWorkspaceList(result.value);
      return { success: true, data: { workspaces } } satisfies ApiResponse;
    },
  );

  // ── POST /api/jj/workspace/add ──────────────────────────────────────────
  fastify.post<{
    Body: { fromCwd?: string; name?: string; baseRev?: string; taskDescription?: string };
  }>(
    "/api/jj/workspace/add",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { fromCwd, name, baseRev, taskDescription } = request.body ?? {};

      if (!fromCwd) {
        reply.code(400);
        return { success: false, error: "fromCwd is required" } satisfies ApiResponse;
      }
      if (!name || !NAME_RE.test(name)) {
        reply.code(400);
        return {
          success: false,
          error: "INVALID_NAME: name must match /^[a-z0-9-]+$/",
        } satisfies ApiResponse;
      }
      if (!existsSync(path.join(fromCwd, ".jj"))) {
        reply.code(400);
        return {
          success: false,
          error: "fromCwd is not a jj repo",
        } satisfies ApiResponse;
      }

      const workspaceRoot = resolveWorkspaceRoot(deps);
      const destPath = path.join(fromCwd, workspaceRoot, name);
      if (existsSync(destPath)) {
        reply.code(409);
        return {
          success: false,
          error: `destination already exists: ${destPath}`,
        } satisfies ApiResponse;
      }
      // Ensure the workspace-root parent directory exists. `jj workspace
      // add` does NOT create intermediate dirs and fails with
      // "Cannot access <path>" on a missing parent. mkdir -p is safe and
      // idempotent. The .shadow root should be in .gitignore (the spec's
      // FolderOpenSpecSection-style hint is tracked as follow-up).
      const parentDir = path.dirname(destPath);
      try {
        await fs.mkdir(parentDir, { recursive: true });
      } catch (err) {
        reply.code(500);
        return {
          success: false,
          error: `failed to create workspace parent dir ${parentDir}: ${err instanceof Error ? err.message : String(err)}`,
        } satisfies ApiResponse;
      }

      // Resolve the base revision when omitted: current bookmark of fromCwd's
      // working copy, falling back to `trunk()` revset.
      let resolvedBase = baseRev;
      if (!resolvedBase) {
        const bookmarksResult = jj.logRevset({
          cwd: fromCwd,
          revset: "@",
          template: 'bookmarks ++ "\\n"',
        });
        if (bookmarksResult.ok) {
          const first = bookmarksResult.value.trim().split("\n")[0]?.trim();
          if (first) resolvedBase = first;
        }
        if (!resolvedBase) resolvedBase = "trunk()";
      }

      const addResult = jj.workspaceAdd({
        cwd: fromCwd,
        destPath,
        baseRev: resolvedBase,
      });
      if (!addResult.ok) {
        reply.code(500);
        return {
          success: false,
          error: `jj workspace add failed: ${describeError(addResult.error)}`,
        } satisfies ApiResponse;
      }

      const realDestPath = safeRealpathSync(destPath);
      pendingAttachRegistry.enqueue(realDestPath, name);

      // Spawn a session in the new workspace. Mirrors the OpenSpec
      // attach-and-spawn flow; the bridge's `session_register` will
      // consume the pending-attach intent and apply the auto-rename.
      try {
        const config = loadConfig();
        const spawnResult = await spawnPiSession(realDestPath, {
          strategy: config.spawnStrategy,
        });
        if (spawnResult.process && spawnResult.pid) {
          browserGateway.headlessPidRegistry.register(
            spawnResult.pid,
            realDestPath,
            spawnResult.process,
          );
        }
        if (!spawnResult.success) {
          reply.code(202);
          return {
            success: true,
            data: {
              workspacePath: realDestPath,
              spawned: false,
              spawnMessage: spawnResult.message,
            },
          } satisfies ApiResponse;
        }
        return {
          success: true,
          data: {
            workspacePath: realDestPath,
            spawned: true,
            taskDescription: taskDescription ?? null,
          },
        } satisfies ApiResponse;
      } catch (err) {
        reply.code(202);
        return {
          success: true,
          data: {
            workspacePath: realDestPath,
            spawned: false,
            spawnMessage: err instanceof Error ? err.message : String(err),
          },
        } satisfies ApiResponse;
      }
    },
  );

  // ── POST /api/jj/workspace/forget ───────────────────────────────────────
  fastify.post<{
    Body: { cwd?: string; name?: string; force?: boolean };
  }>(
    "/api/jj/workspace/forget",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd, name, force } = request.body ?? {};

      if (!cwd) {
        reply.code(400);
        return { success: false, error: "cwd is required" } satisfies ApiResponse;
      }
      if (!name || !NAME_RE.test(name)) {
        reply.code(400);
        return {
          success: false,
          error: "INVALID_NAME: name must match /^[a-z0-9-]+$/",
        } satisfies ApiResponse;
      }
      if (!existsSync(path.join(cwd, ".jj"))) {
        reply.code(400);
        return {
          success: false,
          error: "cwd is not a jj repo",
        } satisfies ApiResponse;
      }

      // Inspect for unfolded commits: anything in the workspace's `@`
      // that isn't an ancestor of trunk. `trunk()..<name>@` is the
      // straight-line revset for that; we filter out empty changes
      // (`~empty()`) so the empty `@` of a freshly-created workspace
      // doesn't trigger the unfolded-work refusal.
      // Note: jj 0.40's `fork_point()` takes a single revset; we use
      // the simpler `..` range form which works on every supported jj.
      let unfolded: string[] = [];
      const logResult = jj.logRevset({
        cwd,
        revset: `trunk()..${name}@ & ~empty()`,
        template: 'change_id.short() ++ " " ++ description.first_line() ++ "\\n"',
      });
      if (logResult.ok) {
        unfolded = logResult.value
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
      }
      // A failed revset (e.g. unknown bookmark / fork_point unsupported) is
      // *not* sufficient to skip the safety check — refuse with a generic
      // error so the user sees the underlying jj message.
      if (!logResult.ok) {
        reply.code(500);
        return {
          success: false,
          error: `jj log probe failed: ${describeError(logResult.error)}`,
        } satisfies ApiResponse;
      }

      if (unfolded.length > 0 && !force) {
        reply.code(409);
        return {
          success: false,
          error: "UNFOLDED_WORK",
          data: { unfolded },
        } as unknown as ApiResponse;
      }

      // Forget + remove directory.
      const forgetResult = jj.workspaceForget({ cwd, name });
      if (!forgetResult.ok) {
        reply.code(500);
        return {
          success: false,
          error: `jj workspace forget failed: ${describeError(forgetResult.error)}`,
        } satisfies ApiResponse;
      }

      const workspaceRoot = resolveWorkspaceRoot(deps);
      const dirPath = path.join(cwd, workspaceRoot, name);
      try {
        await fs.rm(dirPath, { recursive: true, force: true });
      } catch (err) {
        // Forget already succeeded; surface the rm error but don't fail
        // the operation overall — the workspace is gone from jj's view.
        request.log.warn(
          `jj workspace dir cleanup failed (${dirPath}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { success: true, data: { name, force: Boolean(force) } } satisfies ApiResponse;
    },
  );

  // ── POST /api/jj/init-colocated ─────────────────────────────────────────
  fastify.post<{ Body: { cwd?: string } }>(
    "/api/jj/init-colocated",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd } = request.body ?? {};
      const precheck = checkInitColocatedPreconditions(cwd ?? "");
      if (precheck) {
        reply.code(precheck.code === "DIRTY_INDEX" ? 409 : 400);
        return {
          success: false,
          error: precheck.code,
          data: { message: precheck.message },
        } as unknown as ApiResponse;
      }
      const result = jj.gitInitColocate({ cwd: cwd! });
      if (!result.ok) {
        reply.code(500);
        return {
          success: false,
          error: `jj git init --colocate failed: ${describeError(result.error)}`,
        } satisfies ApiResponse;
      }
      return { success: true, data: { cwd } } satisfies ApiResponse;
    },
  );
}

function describeError(error: { kind: string; [k: string]: unknown }): string {
  if (error.kind === "not-found") return `binary not found: ${String(error.binary ?? "jj")}`;
  if (error.kind === "timeout") return `timed out after ${String(error.timeoutMs)}ms`;
  if (error.kind === "exit") {
    const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
    return stderr.split("\n")[0] || `exited ${String(error.code)}`;
  }
  if (error.kind === "spawn-failure") return String(error.message ?? "spawn failed");
  return error.kind;
}
