/**
 * Git operation REST API routes (localhost-only).
 */

import fs from "node:fs";
import { join } from "node:path";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import { activeSessionsUnder, sessionsUnder } from "../session/active-sessions-in-cwd.js";
import type { BrowserGateway } from "../pairing/browser-gateway.js";
import {
  addWorktree,
  addWorktreeFromPr,
  checkoutBranch,
  commitFiles,
  createPullRequest,
  GitCommitError,
  getChangedFiles,
  getGitStatus,
  gitInit,
  isGitRepo,
  listBranches,
  listPullRequests,
  listWorktrees,
  mergeWorktree,
  orphanCleanup,
  pushBranch,
  readHead,
  removeWorktree,
  resolveConfigRoot,
  stashPop,
  worktreeDiffStat,
} from "../git-worktree/git-operations.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import { safeRealpathSync } from "../resolve-path.js";
import { evaluateGate, type GateResult, hookDefHash, type InitProgress, readInitHook, runInitHook, type WorktreeInitHook } from "../git-worktree/worktree-init.js";
import { mapInitStderrToHint } from "../git-worktree/worktree-init-errors.js";
import type { WorktreeInitRegistry } from "../git-worktree/worktree-init-registry.js";
import { isTrusted, recordTrust } from "../git-worktree/worktree-init-trust.js";
import type { NetworkGuard } from "./route-deps.js";

export interface GitRoutesDeps {
  networkGuard: NetworkGuard;
  /** Optional — worktree lifecycle endpoints need this to enumerate active sessions + broadcast cwdMissing. */
  sessionManager?: SessionManager;
  browserGateway?: BrowserGateway;
  /**
   * Optional — sends `git_commit_draft` to the owning bridge for the AI-draft
   * relay. When absent the commit-draft route returns a stub.
   * See change: add-session-uncommitted-indicator-and-commit.
   */
  sendToSession?: (sessionId: string, msg: any) => boolean;
  /** Optional — correlates the async draft reply. See same change. */
  commitDraftRelay?: import("../commit-draft-relay.js").CommitDraftRelay;
  /**
   * Optional — enables worktree-init progress streaming to the
   * originating browser. When absent, the init hook still runs but
   * no progress / done / failed events are emitted (HTTP response carries
   * the final result either way). See change: generalize-worktree-init-hook.
   */
  worktreeInitRegistry?: WorktreeInitRegistry;
}

/**
 * Per-resolved-checkout cache of the gate result, with a short TTL.
 * Invalidated when a hook run starts/exits for that checkout.
 * See change: generalize-worktree-init-hook.
 */
const GATE_CACHE_TTL_MS = 30 * 1000;
const gateCache = new Map<string, { needsInit: boolean; evaluatedAt: number }>();
function invalidateGateCache(checkoutPath: string) { gateCache.delete(checkoutPath); }

/**
 * Last non-empty line of the progress tail, for the ghost preview. The tail is
 * the most recent <= 4KB of combined output; the chip shows only its final line.
 * See change: friendlier-worktree-init.
 */
function lastLineOf(tail: string): string {
  const lines = tail.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (line) return line;
  }
  return "";
}
async function evaluateGateCached(checkoutPath: string, hook: WorktreeInitHook): Promise<GateResult> {
  const hit = gateCache.get(checkoutPath);
  if (hit && Date.now() - hit.evaluatedAt < GATE_CACHE_TTL_MS) return { needsInit: hit.needsInit };
  const res = await evaluateGate(checkoutPath, hook);
  gateCache.set(checkoutPath, { needsInit: res.needsInit, evaluatedAt: Date.now() });
  return res;
}

export function registerGitRoutes(fastify: FastifyInstance, deps: GitRoutesDeps) {
  const { networkGuard, sessionManager, browserGateway, worktreeInitRegistry, sendToSession, commitDraftRelay } = deps;
  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/git/branches",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      if (!cwd) {
        reply.code(400);
        return { success: false, code: "cwd_required", error: "cwd parameter required" } satisfies ApiResponse;
      }
      if (!isGitRepo(cwd)) {
        return { success: false, code: "not_a_repo", error: "not a git repository" } satisfies ApiResponse;
      }
      try {
        const data = listBranches(cwd);
        return { success: true, data } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, code: "list_branches_failed", error: err.message ?? "failed to list branches" } satisfies ApiResponse;
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
        return { success: false, code: "cwd_and_branch_required", error: "cwd and branch required" } satisfies ApiResponse;
      }
      try {
        const result = checkoutBranch(cwd, branch, stash ?? false);
        if (!result.success) {
          reply.code(409);
          return result;
        }
        return { success: true, data: { stashed: result.stashed } } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, code: "checkout_failed", error: err.message ?? "checkout failed" } satisfies ApiResponse;
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
        return { success: false, code: "cwd_required", error: "cwd required" } satisfies ApiResponse;
      }
      try {
        gitInit(cwd);
        return { success: true } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, code: "git_init_failed", error: err.message ?? "init failed" } satisfies ApiResponse;
      }
    },
  );

  // ── Uncommitted-indicator + commit (session-uncommitted-indicator-and-commit) ──

  // On-demand fresh working-tree status for a cwd (erases broadcast staleness
  // on card/folder focus + right after a commit).
  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/git/status",
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
      const status = getGitStatus(validated.cwd);
      if (!status) {
        return { success: false, code: "git_failed", error: "failed to read git status" } satisfies ApiResponse;
      }
      return { success: true, data: status } satisfies ApiResponse;
    },
  );

  // Changed-file list for the commit dialog's picker.
  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/git/changed-files",
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
        const files = await getChangedFiles(validated.cwd);
        return { success: true, data: files } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, code: "git_failed", error: err?.message ?? "failed to list changed files" } satisfies ApiResponse;
      }
    },
  );

  // Commit a chosen subset of files. argv staging + `git commit -F -` stdin
  // (no shell interpolation of the message). On success broadcasts fresh
  // status to every session sharing the cwd so their pill updates at once.
  fastify.post<{ Body: { cwd?: string; message?: string; files?: string[] } }>(
    "/api/git/commit",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd, message, files } = request.body ?? {};
      const validated = validateCwd(cwd);
      if (!validated.ok) {
        reply.code(400);
        return { success: false, code: validated.code, error: validated.message } satisfies ApiResponse;
      }
      if (typeof message !== "string" || !Array.isArray(files)) {
        reply.code(400);
        return { success: false, code: "bad_request", error: "message and files[] required" } satisfies ApiResponse;
      }
      try {
        const result = await commitFiles({ cwd: validated.cwd, message, files });
        // Broadcast fresh status to sessions sharing this cwd.
        if (sessionManager && browserGateway) {
          const fresh = getGitStatus(validated.cwd);
          if (fresh) {
            for (const s of sessionManager.listAll()) {
              if (safeRealpathSync(s.cwd) === validated.cwd) {
                sessionManager.update(s.id, { gitStatus: fresh });
                browserGateway.broadcastSessionUpdated(s.id, { gitStatus: fresh });
              }
            }
          }
        }
        return { success: true, data: result } satisfies ApiResponse;
      } catch (err: any) {
        if (err instanceof GitCommitError) {
          reply.code(err.code === "path-escape" || err.code === "no-files" || err.code === "empty-message" ? 400 : 409);
          return { success: false, code: err.code, error: err.message } satisfies ApiResponse;
        }
        return { success: false, code: "commit-failed", error: err?.message ?? "commit failed" } satisfies ApiResponse;
      }
    },
  );

  // AI-drafted commit message. Relays to the owning bridge's fork-subagent
  // and awaits the result (stub on timeout / no bridge).
  fastify.post<{ Body: { cwd?: string; files?: string[]; sessionId?: string } }>(
    "/api/git/commit-draft",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd, files, sessionId } = request.body ?? {};
      const validated = validateCwd(cwd);
      if (!validated.ok) {
        reply.code(400);
        return { success: false, code: validated.code, error: validated.message } satisfies ApiResponse;
      }
      // Every file must be a non-empty string (the diff is built per path).
      if (
        !Array.isArray(files) ||
        files.length === 0 ||
        !files.every((f) => typeof f === "string" && f.length > 0) ||
        typeof sessionId !== "string"
      ) {
        reply.code(400);
        return { success: false, code: "bad_request", error: "sessionId and non-empty files[] required" } satisfies ApiResponse;
      }
      // The draft is seeded from the named session's context, so the session
      // must exist and its working tree must be the cwd being committed — a
      // client cannot pair an arbitrary sessionId with a foreign cwd.
      if (sessionManager) {
        const sess = sessionManager.get(sessionId);
        if (!sess || safeRealpathSync(sess.cwd) !== validated.cwd) {
          reply.code(400);
          return { success: false, code: "bad_request", error: "sessionId does not match cwd" } satisfies ApiResponse;
        }
      }
      if (!commitDraftRelay || !sendToSession) {
        // Feature not wired — degrade to manual entry.
        return { success: true, data: { message: "", source: "stub" } } satisfies ApiResponse;
      }
      const result = await commitDraftRelay.request({
        sessionId,
        cwd: validated.cwd,
        files,
        send: (msg) => sendToSession(sessionId, msg),
      });
      return { success: true, data: result } satisfies ApiResponse;
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

  // ── Worktree init-status probe (change: generalize-worktree-init-hook) ──
  //
  // Reports whether a checkout needs initialization per its declared
  // `.pi/settings.json#worktreeInit` hook. Gate eval is cached per checkout.
  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/git/worktree/init-status",
    { preHandler: networkGuard },
    async (request, reply) => {
      const validated = validateCwd(request.query.cwd);
      if (!validated.ok) {
        reply.code(400);
        return { success: false, code: validated.code, error: validated.message } satisfies ApiResponse;
      }
      // Config root without a git assumption: a non-git dir with
      // `.pi/settings.json` resolves to itself so its declared hook is read.
      // See change: support-non-git-init-hook.
      const configRoot = resolveConfigRoot(validated.cwd);
      if (!configRoot) {
        // State ①: no reachable config root at all — truly unconfigured.
        return { success: true, data: { hasHook: false, configured: false } } satisfies ApiResponse;
      }
      const hook = readInitHook(configRoot);
      if (!hook) {
        // No worktreeInit hook. Distinguish state ① (git repo, no
        // `.pi/settings.json`) from state ③ (configured project, no hook).
        // See change: distinguish-initialize-actions.
        const configured = fs.existsSync(join(configRoot, ".pi", "settings.json"));
        return { success: true, data: { hasHook: false, configured } } satisfies ApiResponse;
      }
      const trusted = isTrusted(configRoot, hookDefHash(hook));
      // TOFU: do NOT execute the repo-declared `gate` (arbitrary bash) until the
      // hook is trusted. An untrusted hook reports presence only; `needsInit` is
      // unknown until the user confirms. See change: generalize-worktree-init-hook.
      if (!trusted) {
        return { success: true, data: { hasHook: true, trusted: false } } satisfies ApiResponse;
      }
      const gate = await evaluateGateCached(validated.cwd, hook);
      return { success: true, data: { hasHook: true, needsInit: gate.needsInit, trusted: true } } satisfies ApiResponse;
    },
  );

  // ── Active worktree-inits (change: friendlier-worktree-init) ────────────
  //
  // Boot rehydration: returns the cwd-keyed registry's running entries plus
  // any terminal entries still within their retention TTL. Empty when no
  // registry is wired (progress streaming disabled).
  fastify.get(
    "/api/git/worktree/active-inits",
    { preHandler: networkGuard },
    async () => {
      const runs = worktreeInitRegistry?.getActiveRuns() ?? [];
      return { success: true, data: { runs } } satisfies ApiResponse;
    },
  );

  // ── Worktree init run (change: generalize-worktree-init-hook) ──────────
  //
  // Runs the declared hook for a checkout. TOFU-gated: an untrusted hook
  // returns `init_untrusted` carrying the def for the client to confirm.
  fastify.post<{ Body: { cwd?: string; requestId?: string; confirmHash?: string; scope?: unknown } }>(
    "/api/git/worktree/init",
    { preHandler: networkGuard },
    async (request, reply) => {
      // A `script` install or detached `agent` can take minutes — well past
      // Fastify's 10 s connectionTimeout. Disable the per-socket timeout for
      // this request, then restore it once the response flushes so a keep-alive
      // socket doesn't carry an infinite timeout into the next request.
      const socket = request.raw.socket;
      const prevTimeout = typeof socket?.timeout === "number" ? socket.timeout : undefined;
      socket?.setTimeout?.(0);
      if (typeof prevTimeout === "number") {
        reply.raw.once("finish", () => {
          if (socket && !socket.destroyed) socket.setTimeout(prevTimeout);
        });
      }
      const body = request.body ?? {};
      const validated = validateCwd(body.cwd);
      if (!validated.ok) {
        reply.code(400);
        return { success: false, code: validated.code, error: validated.message } satisfies ApiResponse;
      }
      // Config root without a git assumption; a `null` root means an
      // unconfigured non-git dir — reuse the existing no-hook envelope, not
      // `not_a_repo`. See change: support-non-git-init-hook.
      const configRoot = resolveConfigRoot(validated.cwd);
      if (!configRoot) {
        return { success: true, data: { ran: false, skippedReason: "no_hook" } } satisfies ApiResponse;
      }
      const hook = readInitHook(configRoot);
      if (!hook) {
        return { success: true, data: { ran: false, skippedReason: "no_hook" } } satisfies ApiResponse;
      }
      const hash = hookDefHash(hook);
      if (typeof body.confirmHash === "string" && body.confirmHash === hash) {
        // Strict scope validation (no upward coercion): omitted → project
        // (backward compatible); exactly `session`|`project` honored; any other
        // present value is rejected WITHOUT recording trust or running, so a
        // malformed value can never escalate an ephemeral-intent confirm into a
        // permanent on-disk grant. See change: add-session-scoped-init-trust.
        const rawScope = body.scope;
        if (rawScope !== undefined && rawScope !== "session" && rawScope !== "project") {
          return { success: false, code: "bad_request", error: "invalid scope" } satisfies ApiResponse;
        }
        const scope = rawScope === "session" ? "session" : "project";
        recordTrust(configRoot, hash, scope);
      }
      if (!isTrusted(configRoot, hash)) {
        // Echo the hash so the client confirms with `confirmHash` without
        // re-implementing the canonical hash. See change: generalize-worktree-init-hook.
        return { success: false, code: "init_untrusted", data: { hook, hash } } satisfies ApiResponse;
      }
      // Re-trust case: the hook was edited (invalidating trust) but the gate is
      // already satisfied (`needsInit === false`). Granting trust should clear
      // the control WITHOUT re-running the hook. See change:
      // friendlier-worktree-init (folder-action-bar spec).
      const preGate = await evaluateGateCached(validated.cwd, hook);
      if (!preGate.needsInit) {
        return { success: true, data: { ran: false, skippedReason: "already_initialized" } } satisfies ApiResponse;
      }
      const requestId = typeof body.requestId === "string" && body.requestId.length > 0 ? body.requestId : undefined;
      const cwd = validated.cwd;
      // Fan out to the legacy per-click requestId subscriber (if any) AND to
      // every cwd-keyed subscriber (refresh / second tab / auto-init).
      // See change: friendlier-worktree-init.
      const sendIf = (msg: any) => {
        if (worktreeInitRegistry) {
          if (requestId) worktreeInitRegistry.send(requestId, msg);
          worktreeInitRegistry.sendCwd(cwd, msg);
        }
      };
      worktreeInitRegistry?.startRun(cwd);
      const onProgress = (p: InitProgress) => {
        worktreeInitRegistry?.progressRun(cwd, lastLineOf(p.line), p.line);
        sendIf({ type: "worktree_init_progress", requestId: requestId ?? "", cwd, line: p.line });
      };
      invalidateGateCache(cwd);
      const runResult = await runInitHook(cwd, hook, onProgress);
      invalidateGateCache(cwd);
      if (runResult.ok) {
        worktreeInitRegistry?.finishRun(cwd, "done");
        sendIf({ type: "worktree_init_done", requestId: requestId ?? "", cwd, durationMs: runResult.durationMs });
        return { success: true, data: { ran: true, durationMs: runResult.durationMs } } satisfies ApiResponse;
      }
      const stderr = runResult.stderr ?? "";
      const hint = mapInitStderrToHint(stderr) ?? `init failed (${runResult.code ?? "unknown"})`;
      worktreeInitRegistry?.finishRun(cwd, "failed", runResult.code ?? "init_failed");
      sendIf({ type: "worktree_init_failed", requestId: requestId ?? "", cwd, code: runResult.code ?? "init_failed", message: hint, stderr });
      reply.code(500);
      return { success: false, code: "init_failed", error: hint, stderr } satisfies ApiResponse;
    },
  );

  fastify.post<{
    Body: { cwd?: string; base?: string; newBranch?: string; path?: string; force?: boolean };
  }>(
    "/api/git/worktree",
    { preHandler: networkGuard },
    async (request, reply) => {
      // Worktree creation no longer runs any inline init/install step.
      // Initialization is delegated to the gated, manually-triggered
      // worktree-init hook (GET /init-status + POST /init). See change:
      // generalize-worktree-init-hook.
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
      // `newBranch` is optional. When present it must be a string (fork
      // mode); when absent the server checks out the existing `base` ref
      // (checkout mode). See change: worktree-checkout-existing-branch.
      if (body.newBranch !== undefined && typeof body.newBranch !== "string") {
        reply.code(400);
        return { success: false, code: "cwd_invalid", error: "newBranch must be a string" } satisfies ApiResponse;
      }
      const result = addWorktree({
        cwd: validated.cwd,
        base: body.base,
        ...(body.newBranch !== undefined ? { newBranch: body.newBranch } : {}),
        path: body.path,
        force: body.force === true,
      });
      if (!result.ok) {
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
          ...(typeof result.orphanLikely === "boolean" ? { orphanLikely: result.orphanLikely } : {}),
        } satisfies ApiResponse;
      }

      return {
        success: true,
        data: { path: result.path, branch: result.branch, excludeAppended: result.excludeAppended },
      } satisfies ApiResponse;
    },
  );

  // ── Orphan-path cleanup (change: openspec-worktree-spawn-button) ──────────────────
  //
  // Unblocks the worktree-spawn dialog when a previous failed attempt
  // left an orphan directory at the target path. Conservative refuse
  // rules — see `orphanCleanup` in `git-operations.ts`.
  fastify.post<{ Body: { cwd?: string; path?: string } }>(
    "/api/git/worktree/orphan-cleanup",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const validated = validateCwd(body.cwd);
      if (!validated.ok) {
        reply.code(400);
        return { success: false, code: validated.code, error: validated.message } satisfies ApiResponse;
      }
      if (!body.path || typeof body.path !== "string") {
        reply.code(400);
        return { success: false, code: "cwd_invalid", error: "path required" } satisfies ApiResponse;
      }
      const result = orphanCleanup({ cwd: validated.cwd, path: body.path });
      if (!result.ok) {
        // 409 for state conflicts the client surfaces inline (registered
        // worktree, looks-like-worktree, size/file caps); 400 for input
        // errors (outside_repo, not_a_directory); 500 for unclassified fs
        // failures.
        const httpStatus =
          result.error === "not_orphan" ||
          result.error === "looks_like_worktree" ||
          result.error === "too_many_files" ||
          result.error === "file_too_large"
            ? 409
            : result.error === "outside_repo" || result.error === "not_a_directory"
              ? 400
              : 500;
        reply.code(httpStatus);
        return {
          success: false,
          code: result.error,
          error: result.message,
        } satisfies ApiResponse;
      }
      return { success: true } satisfies ApiResponse;
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
      // Trace every call so failed clicks leave a breadcrumb in
      // ~/.pi/dashboard/server.log (the request itself is not
      // otherwise logged by fastify in default config).
      // eslint-disable-next-line no-console
      console.log(
        `[git-routes] worktree/remove cwd=${validated.cwd} force=${force} → ${
          result.ok ? "ok" : `fail:${result.code}`
        }`,
      );
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

  // ── List pull requests (change: add-worktree-from-pull-request) ──────────
  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/git/pull-requests",
    { preHandler: networkGuard },
    async (request, reply) => {
      const validated = validateCwd(request.query.cwd);
      if (!validated.ok) {
        reply.code(400);
        return { success: false, code: validated.code, error: validated.message } satisfies ApiResponse;
      }
      const ghResolved = getDefaultRegistry().resolve("gh");
      if (!ghResolved.ok || !ghResolved.path) {
        reply.code(400);
        return { success: false, code: "gh_not_found", error: "gh_not_found" } satisfies ApiResponse;
      }
      const result = listPullRequests({ cwd: validated.cwd, ghPath: ghResolved.path });
      if (!result.ok) {
        const status =
          result.code === "gh_not_authed" ? 401
          : result.code === "no_remote" ? 400
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

  // ── Create worktree from PR (change: add-worktree-from-pull-request) ────
  fastify.post<{ Body: { cwd?: string; prNumber?: number; path?: string } }>(
    "/api/git/worktree/from-pr",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const validated = validateCwd(body.cwd);
      if (!validated.ok) {
        reply.code(400);
        return { success: false, code: validated.code, error: validated.message } satisfies ApiResponse;
      }
      if (typeof body.prNumber !== "number" || !Number.isInteger(body.prNumber) || body.prNumber <= 0) {
        reply.code(400);
        return { success: false, code: "cwd_invalid", error: "prNumber required (positive integer)" } satisfies ApiResponse;
      }
      const pathArg = typeof body.path === "string" && body.path.length > 0 ? body.path : undefined;
      const result = addWorktreeFromPr({
        cwd: validated.cwd,
        prNumber: body.prNumber,
        path: pathArg,
      });
      if (!result.ok) {
        const httpStatus =
          result.error === "pr_not_found" ? 404
          : result.error === "gh_not_authed" ? 401
          : result.error === "branch_in_use" || result.error === "branch_exists" || result.error === "path_exists" ? 409
          : result.error === "not_a_repo" || result.error === "base_not_found" ? 400
          : 500;
        reply.code(httpStatus);
        return {
          success: false,
          code: result.error,
          error: result.message,
          ...(result.stderr ? { stderr: result.stderr } : {}),
          ...(typeof result.orphanLikely === "boolean" ? { orphanLikely: result.orphanLikely } : {}),
        } satisfies ApiResponse;
      }
      return {
        success: true,
        data: { path: result.path, branch: result.branch, prNumber: result.prNumber },
      } satisfies ApiResponse;
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
        return { success: false, code: "cwd_required", error: "cwd required" } satisfies ApiResponse;
      }
      try {
        const result = stashPop(cwd);
        return { success: true, data: result } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, code: "stash_pop_failed", error: err.message ?? "stash pop failed" } satisfies ApiResponse;
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
