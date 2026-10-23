/**
 * Git operation REST API routes (localhost-only).
 */

import fs from "node:fs";
import { join } from "node:path";
import {
  ADMISSION_DEADLINE_MS,
  type AdmissionToken,
  type AdmitCwdOptions,
  admissionAllows,
  releaseAdmission,
} from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import { checkoutRoots } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import { getPiTrustMirror } from "../access/pi-trust-mirror-service.js";
import {
  addWorktree,
  addWorktreeFromPr,
  CHECKOUT_ROOTS_TIMEOUT_MS,
  checkoutBranch,
  classifyWorktreeRemoval,
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
  pruneWorktrees,
  pushBranch,
  readHead,
  removeWorktree,
  resolveConfigRoot,
  stashPop,
  type WorktreeRemovalVerdict,
  worktreeDiffStat,
} from "../git-worktree/git-operations.js";
import { evaluateGate, type GateResult, hookDefHash, type InitProgress, readInitHook, runInitHook, type WorktreeInitHook } from "../git-worktree/worktree-init.js";
import { gitErrorText, redactGitText } from "../git-worktree/redact-git-text.js";
import { INVALID_REF_CODE, InvalidRefError, isMissingArg, isValidRefArg } from "../git-worktree/ref-arg.js";
import { mapInitStderrToHint } from "../git-worktree/worktree-init-errors.js";
import type { WorktreeInitRegistry } from "../git-worktree/worktree-init-registry.js";
import { isTrusted, recordTrust } from "../git-worktree/worktree-init-trust.js";
import { admitRouteCwd, sendAdmissionUnavailable } from "../lib/route-admission.js";
import type { BrowserGateway } from "../pairing/browser-gateway.js";
import { safeRealpathSync } from "../resolve-path.js";
import { activeSessionsUnder, activeSessionsUnderResolved, sessionsUnder } from "../session/active-sessions-in-cwd.js";
import type { SessionManager } from "../session/memory-session-manager.js";
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
   * Optional — the configured `DashboardConfig.removeBatchCap` bounding
   * `POST /api/git/worktree/remove-batch` (default when omitted). See change:
   * apply-checkout-root-to-worktree-ops (D8).
   */
  removeBatchCap?: number;
  /**
   * Optional — enables worktree-init progress streaming to the
   * originating browser. When absent, the init hook still runs but
   * no progress / done / failed events are emitted (HTTP response carries
   * the final result either way). See change: generalize-worktree-init-hook.
   */
  worktreeInitRegistry?: WorktreeInitRegistry;
  /**
   * Live known-folder set (session cwds ∪ pinned directories) every `cwd` is admitted
   * against. Absent → nothing is known (fail closed). See change: core-cwd-admission.
   */
  knownCwds?: () => string[];
  /** `admitCwd` options: the host's throttled `onIndeterminate` logger + test seams. */
  admitOptions?: AdmitCwdOptions;
  /** Test seam: whole-`remove-batch` admission budget in ms (default 10 000). */
  removeBatchAdmissionBudgetMs?: number;
}

/** Admission result of one git-route `cwd`: the canonical cwd to operate on, or the reply body. */
type GitCwdCheck =
  | { ok: true; cwd: string; token: AdmissionToken }
  | { ok: false; body: ApiResponse; code: string };

/**
 * B20: redact git-derived text against the root the operation ran in. `root` is captured by the
 * caller at operation time (a `const`), never read at broadcast time.
 * See change: harden-git-terminal-plugin-boundaries.
 */
const redact = (text: unknown, root?: string): string => redactGitText(text, { root });
/** Redacted `err.message` (or a thrown string), falling back to `fallback`. */
const redactErr = (err: unknown, fallback: string, root?: string): string => redact(gitErrorText(err) || fallback, root);

/** B1r: the 400 `invalid_ref` envelope (no git process has started). */
function invalidRef(reply: FastifyReply, what: string): ApiResponse {
  reply.code(400);
  return { success: false, code: INVALID_REF_CODE, error: `invalid ${what}` };
}
/** A PRESENT optional ref/path field (absent/null/"" = not supplied) that fails validation. */
const presentInvalid = (v: unknown): boolean => !isMissingArg(v) && !isValidRefArg(v);

/** Whole-batch admission budget for `remove-batch` (design D1). */
const REMOVE_BATCH_ADMISSION_BUDGET_MS = 10_000;
/** A runner that never completes a probe: only a direct known-folder match can be admitted with it. */
const NO_DERIVATION_RUNNER: NonNullable<AdmitCwdOptions["runner"]> = async () => ({
  ok: false,
  error: { kind: "spawn-failure", message: "admission budget exhausted" },
});

/**
 * Per-resolved-checkout cache of the gate result, with a short TTL.
 * Invalidated when a hook run starts/exits for that checkout.
 * See change: generalize-worktree-init-hook.
 */
const GATE_CACHE_TTL_MS = 30 * 1000;
const gateCache = new Map<string, { needsInit: boolean; evaluatedAt: number }>();
function invalidateGateCache(checkoutPath: string) { gateCache.delete(checkoutPath); }

/**
 * Per-artifact setup checklist for the init-status probe (change:
 * add-folder-action-banner, D5). A `stat` of a fixed five-entry list resolved at
 * the CONFIG ROOT (for a worktree row that is the main checkout, not the row's
 * own cwd — matching the legacy `configured` computation). Exactly one entry,
 * `settings`, is required; its absence is the only state that means "not a pi
 * project". Computed on EVERY response (D-B) and deliberately UNCACHED: the gate
 * cache never covers a no-hook directory (the only kind that banners), and a
 * dedicated cache would need a "project-init session completed" invalidation the
 * session manager emits no event for. Five `existsSync` calls are cheap.
 */
const SETUP_ARTIFACTS = [
  { id: "settings", rel: [".pi", "settings.json"], required: true },
  { id: "agents", rel: ["AGENTS.md"], required: false },
  { id: "prompts", rel: [".pi", "prompts"], required: false },
  { id: "openspec", rel: ["openspec"], required: false },
  { id: "kb", rel: [".pi", "dashboard", "knowledge_base.json"], required: false },
] as const;
interface SetupArtifact { id: string; present: boolean; required: boolean; }
/**
 * Returns the checklist, or `undefined` to fail open (probe threw). A `null`
 * config root is a valid answer — "nothing here" — not an error, so it reports
 * every artifact absent rather than omitting the field.
 */
function buildSetupChecklist(configRoot: string | null): SetupArtifact[] | undefined {
  try {
    return SETUP_ARTIFACTS.map((a) => ({
      id: a.id,
      present: configRoot != null && fs.existsSync(join(configRoot, ...a.rel)),
      required: a.required,
    }));
  } catch {
    return undefined;
  }
}

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

/**
 * Defensive clamp for the configured batch cap (D8). `DashboardConfig`
 * parsing already clamps (`clampRemoveBatchCap` in shared config), so a value
 * arriving here is either a positive integer or `undefined` (unset / a host
 * running a shared build that predates the field — a worktree dev server
 * resolves shared through the workspace link to the main checkout). Same
 * semantics as the shared clamp: fall back to the default on anything
 * non-numeric, non-positive or non-integer.
 * See change: apply-checkout-root-to-worktree-ops (D8).
 */
function resolveBatchCap(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) return 50;
  return Math.min(500, Math.max(1, v));
}

export function registerGitRoutes(fastify: FastifyInstance, deps: GitRoutesDeps) {
  const { networkGuard, sessionManager, browserGateway, worktreeInitRegistry, sendToSession, commitDraftRelay, removeBatchCap: configuredRemoveBatchCap } = deps;
  const removeBatchCap = resolveBatchCap(configuredRemoveBatchCap);

  /**
   * Admit a request `cwd` (design D1): `admitRouteCwd`, then branch on
   * `admissionAllows(admission, cwd)` HERE, on the unmodified request value, so static
   * analysis keeps its modelled barrier. Returns the CANONICAL cwd — git runs on the
   * realpath, so a later swap of the raw path cannot redirect the operation. The token is
   * released when the response closes (success, error, throw or disconnect).
   * No filesystem call touches the raw value outside the guard.
   * See change: core-cwd-admission.
   */
  async function admitGitCwd(
    raw: string,
    reply: FastifyReply,
    admitOptions: AdmitCwdOptions | undefined = deps.admitOptions,
  ): Promise<GitCwdCheck> {
    const admission = await admitRouteCwd(raw, { knownCwds: deps.knownCwds, admitOptions });
    if (admission.kind === "indeterminate") {
      return { ok: false, body: sendAdmissionUnavailable(reply), code: "cwd-admission-unavailable" };
    }
    if (admission.kind !== "admit" || !admissionAllows(admission, raw)) {
      reply.code(400);
      return {
        ok: false,
        code: "cwd_unknown",
        body: {
          success: false,
          code: "cwd_unknown",
          error: "cwd is not a known folder; pin the repository to allow git operations",
        } satisfies ApiResponse,
      };
    }
    const token = admission.token;
    reply.raw.once("close", () => releaseAdmission(token));
    // The client may have gone while admission ran (`close` already fired): release at once.
    if (reply.raw.destroyed) releaseAdmission(token);
    return { ok: true, cwd: token.canonCwd, token };
  }

  /**
   * `admitGitCwd` plus the presence and directory checks of the worktree endpoints
   * (`cwd_invalid`: `cwd required` / `cwd does not exist` / `cwd is not a directory`),
   * the latter two only for an ADMITTED cwd. See change: add-worktree-spawn-dialog,
   * core-cwd-admission.
   */
  async function validateCwd(raw: string | undefined, reply: FastifyReply): Promise<GitCwdCheck> {
    if (!raw || typeof raw !== "string") {
      reply.code(400);
      return { ok: false, code: "cwd_invalid", body: { success: false, code: "cwd_invalid", error: "cwd required" } satisfies ApiResponse };
    }
    const admitted = await admitGitCwd(raw, reply);
    if (!admitted.ok) return admitted;
    const invalid = (error: string): GitCwdCheck => {
      releaseAdmission(admitted.token);
      reply.code(400);
      return { ok: false, code: "cwd_invalid", body: { success: false, code: "cwd_invalid", error } satisfies ApiResponse };
    };
    try {
      const stat = await fs.promises.stat(admitted.cwd);
      if (!stat.isDirectory()) return invalid("cwd is not a directory");
    } catch {
      return invalid("cwd does not exist");
    }
    return admitted;
  }
  /**
   * After a successful worktree Push / Open PR, force a PR-status probe on
   * every bridge whose session cwd is the worktree or inside it (realpath-
   * normalized). Merge is local — it changes no GitHub state, so it never
   * refreshes. Best-effort. See change: redesign-composer-session-strip (D5).
   */
  const requestPrRefresh = (worktreeCwd: string, reason: "push" | "pr") => {
    if (!sessionManager || !sendToSession) return;
    for (const id of activeSessionsUnderResolved(worktreeCwd, sessionManager.listAll(), safeRealpathSync)) {
      sendToSession(id, { type: "git_info_refresh", reason });
    }
  };
  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/git/branches",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      if (!cwd) {
        reply.code(400);
        return { success: false, code: "cwd_required", error: "cwd parameter required" } satisfies ApiResponse;
      }
      const admitted = await admitGitCwd(cwd, reply);
      if (!admitted.ok) return admitted.body;
      if (!isGitRepo(admitted.cwd)) {
        return { success: false, code: "not_a_repo", error: "not a git repository" } satisfies ApiResponse;
      }
      try {
        const data = listBranches(admitted.cwd);
        return { success: true, data } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, code: "list_branches_failed", error: redactErr(err, "failed to list branches", admitted.cwd) } satisfies ApiResponse;
      }
    },
  );

  fastify.post<{ Body: { cwd?: string; branch?: unknown; stash?: boolean } }>(
    "/api/git/checkout",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd, branch, stash } = request.body ?? {};
      // Missing (absent / null / "") keeps the existing code; a PRESENT invalid ref is `invalid_ref`
      // (B1r) — checked before admission so nothing (not even a probe) runs for it.
      if (!cwd || isMissingArg(branch)) {
        reply.code(400);
        return { success: false, code: "cwd_and_branch_required", error: "cwd and branch required" } satisfies ApiResponse;
      }
      if (!isValidRefArg(branch)) return invalidRef(reply, "branch");
      const admitted = await admitGitCwd(cwd, reply);
      if (!admitted.ok) return admitted.body;
      try {
        const result = checkoutBranch(admitted.cwd, branch, stash ?? false);
        if (!result.success) {
          reply.code(409);
          return result;
        }
        return { success: true, data: { stashed: result.stashed } } satisfies ApiResponse;
      } catch (err: any) {
        if (err instanceof InvalidRefError) return invalidRef(reply, "branch");
        return { success: false, code: "checkout_failed", error: redactErr(err, "checkout failed", admitted.cwd) } satisfies ApiResponse;
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
      const admitted = await admitGitCwd(cwd, reply);
      if (!admitted.ok) return admitted.body;
      try {
        gitInit(admitted.cwd);
        return { success: true } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, code: "git_init_failed", error: redactErr(err, "init failed", admitted.cwd) } satisfies ApiResponse;
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
      const validated = await validateCwd(request.query.cwd, reply);
      if (!validated.ok) return validated.body;
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
      const validated = await validateCwd(request.query.cwd, reply);
      if (!validated.ok) return validated.body;
      if (!isGitRepo(validated.cwd)) {
        return { success: false, code: "not_a_repo", error: "not a git repository" } satisfies ApiResponse;
      }
      try {
        const files = await getChangedFiles(validated.cwd);
        return { success: true, data: files } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, code: "git_failed", error: redactErr(err, "failed to list changed files", validated.cwd) } satisfies ApiResponse;
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
      const validated = await validateCwd(cwd, reply);
      if (!validated.ok) return validated.body;
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
          return { success: false, code: err.code, error: redact(err.message, validated.cwd) } satisfies ApiResponse;
        }
        return { success: false, code: "commit-failed", error: redactErr(err, "commit failed", validated.cwd) } satisfies ApiResponse;
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
      const validated = await validateCwd(cwd, reply);
      if (!validated.ok) return validated.body;
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
      const validated = await validateCwd(request.query.cwd, reply);
      if (!validated.ok) return validated.body;
      if (!isGitRepo(validated.cwd)) {
        return { success: false, code: "not_a_repo", error: "not a git repository" } satisfies ApiResponse;
      }
      try {
        const head = readHead(validated.cwd);
        return { success: true, data: head } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, code: "git_failed", error: redactErr(err, "failed to read HEAD", validated.cwd) } satisfies ApiResponse;
      }
    },
  );

  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/git/worktrees",
    { preHandler: networkGuard },
    async (request, reply) => {
      const validated = await validateCwd(request.query.cwd, reply);
      if (!validated.ok) return validated.body;
      if (!isGitRepo(validated.cwd)) {
        return { success: false, code: "not_a_repo", error: "not a git repository" } satisfies ApiResponse;
      }
      try {
        const worktrees = listWorktrees(validated.cwd);
        return { success: true, data: { worktrees } } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, code: "git_failed", error: redactErr(err, "failed to list worktrees", validated.cwd) } satisfies ApiResponse;
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
      const validated = await validateCwd(request.query.cwd, reply);
      if (!validated.ok) return validated.body;
      // Config root without a git assumption: a non-git dir with
      // `.pi/settings.json` resolves to itself so its declared hook is read.
      // See change: support-non-git-init-hook.
      const configRoot = resolveConfigRoot(validated.cwd);
      // Per-artifact checklist (change: add-folder-action-banner). Computed on
      // every branch; `undefined` (probe threw) omits the field to fail open.
      const checklist = buildSetupChecklist(configRoot);
      const withChecklist = <T extends object>(data: T) =>
        checklist === undefined ? data : { ...data, checklist };
      if (!configRoot) {
        // State ①: no reachable config root at all — truly unconfigured.
        return { success: true, data: withChecklist({ hasHook: false, configured: false }) } satisfies ApiResponse;
      }
      const hook = readInitHook(configRoot);
      if (!hook) {
        // No worktreeInit hook. Distinguish state ① (git repo, no
        // `.pi/settings.json`) from state ③ (configured project, no hook).
        // `configured` is retained (deprecated) alongside the checklist for the
        // transitional window. See change: distinguish-initialize-actions.
        const configured = fs.existsSync(join(configRoot, ".pi", "settings.json"));
        return { success: true, data: withChecklist({ hasHook: false, configured }) } satisfies ApiResponse;
      }
      const trusted = isTrusted(configRoot, hookDefHash(hook));
      // TOFU: do NOT execute the repo-declared `gate` (arbitrary bash) until the
      // hook is trusted. An untrusted hook reports presence only; `needsInit` is
      // unknown until the user confirms. See change: generalize-worktree-init-hook.
      if (!trusted) {
        return { success: true, data: withChecklist({ hasHook: true, trusted: false }) } satisfies ApiResponse;
      }
      const gate = await evaluateGateCached(validated.cwd, hook);
      return { success: true, data: withChecklist({ hasHook: true, needsInit: gate.needsInit, trusted: true }) } satisfies ApiResponse;
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
  fastify.post<{ Body: { cwd?: string; requestId?: string; confirmHash?: string; scope?: unknown; piTrust?: boolean } }>(
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
      const validated = await validateCwd(body.cwd, reply);
      if (!validated.ok) return validated.body;
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
        const mirror = scope === "project" ? getPiTrustMirror() : undefined;
        if (mirror) {
          // Choice → trust store (strict) → snapshot; a failure of the first two
          // fails the grant. See change: mirror-dashboard-trust-to-pi.
          try {
            mirror.grant("worktreeInit", configRoot, typeof body.piTrust === "boolean" ? body.piTrust : undefined, () =>
              recordTrust(configRoot, hash, "project", { strict: true }),
            );
          } catch (err) {
            reply.code(500);
            return { success: false, code: "trust_not_recorded", error: `trust not recorded: ${redactErr(err, String(err), configRoot)}` } satisfies ApiResponse;
          }
        } else {
          // "Until the dashboard restarts": the "also trust in pi" choice is held in
          // memory with the entry and never written. See change: mirror-dashboard-trust-live-remote.
          if (scope === "session" && typeof body.piTrust === "boolean") {
            getPiTrustMirror()?.live?.setChoice("worktreeInit", configRoot, body.piTrust);
          }
          recordTrust(configRoot, hash, scope);
        }
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
      // B20: the mapper sees the RAW stderr (so it can match paths); BOTH the mapped hint and the
      // stderr are redacted AFTER mapping, against the checkout the hook ran in (`cwd`, captured above).
      const rawStderr = runResult.stderr ?? "";
      const hint = redact(mapInitStderrToHint(rawStderr) ?? `init failed (${runResult.code ?? "unknown"})`, cwd);
      const stderr = redact(rawStderr, cwd);
      worktreeInitRegistry?.finishRun(cwd, "failed", runResult.code ?? "init_failed");
      sendIf({ type: "worktree_init_failed", requestId: requestId ?? "", cwd, code: runResult.code ?? "init_failed", message: hint, stderr });
      reply.code(500);
      return { success: false, code: "init_failed", error: hint, stderr } satisfies ApiResponse;
    },
  );

  fastify.post<{
    Body: { cwd?: string; base?: unknown; newBranch?: unknown; path?: unknown; force?: boolean };
  }>(
    "/api/git/worktree",
    { preHandler: networkGuard },
    async (request, reply) => {
      // Worktree creation no longer runs any inline init/install step.
      // Initialization is delegated to the gated, manually-triggered
      // worktree-init hook (GET /init-status + POST /init). See change:
      // generalize-worktree-init-hook.
      const body = request.body ?? {};
      // B1r: every PRESENT ref / branch / path is validated before admission or git. `base` absent /
      // null / "" keeps the existing `cwd_invalid` envelope below; `newBranch` absent = checkout mode
      // (a present `null` / "" / non-string is invalid); `path` absent / null / "" = default path.
      // See change: harden-git-terminal-plugin-boundaries.
      if (presentInvalid(body.base)) return invalidRef(reply, "base");
      if (body.newBranch !== undefined && !isValidRefArg(body.newBranch)) return invalidRef(reply, "newBranch");
      if (presentInvalid(body.path)) return invalidRef(reply, "path");
      const validated = await validateCwd(body.cwd, reply);
      if (!validated.ok) return validated.body;
      if (!isValidRefArg(body.base)) {
        reply.code(400);
        return { success: false, code: "cwd_invalid", error: "base required" } satisfies ApiResponse;
      }
      // `newBranch` is optional: present → fork mode; absent → the server checks out the existing
      // `base` ref (checkout mode). See change: worktree-checkout-existing-branch.
      const result = addWorktree({
        cwd: validated.cwd,
        base: body.base,
        ...(body.newBranch !== undefined ? { newBranch: body.newBranch as string } : {}),
        path: typeof body.path === "string" && body.path.length > 0 ? body.path : undefined,
        force: body.force === true,
      });
      if (!result.ok) {
        const httpStatus =
          result.error === "branch_in_use" || result.error === "branch_exists" || result.error === "path_exists"
            ? 409
            : result.error === "not_a_repo" || result.error === "base_not_found" || result.error === "invalid_ref"
              ? 400
              : 500;
        reply.code(httpStatus);
        return {
          success: false,
          code: result.error,
          error: redact(result.message, validated.cwd),
          ...(result.stderr ? { stderr: redact(result.stderr, validated.cwd) } : {}),
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
  fastify.post<{ Body: { cwd?: string; path?: unknown } }>(
    "/api/git/worktree/orphan-cleanup",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      // B1r: a present option-like / control-character path is refused before admission or any fs/git work.
      if (presentInvalid(body.path)) return invalidRef(reply, "path");
      const validated = await validateCwd(body.cwd, reply);
      if (!validated.ok) return validated.body;
      if (!isValidRefArg(body.path)) {
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
            : result.error === "outside_repo" || result.error === "not_a_directory" || result.error === "invalid_ref"
              ? 400
              : 500;
        reply.code(httpStatus);
        return {
          success: false,
          code: result.error,
          error: redact(result.message, validated.cwd),
        } satisfies ApiResponse;
      }
      return { success: true } satisfies ApiResponse;
    },
  );

  // ── Worktree lifecycle endpoints (remove / merge / push / pr / diff-stat) ──────────────────
  // See change: add-worktree-lifecycle-actions.

  /**
   * Tri-state removal guard (D3), replacing the old `isMainWorktree` boolean:
   * a boolean forced "not main" to mean "proceed", which handed a
   * worktree-of-bare-hub (unresolvable anchor) to git. `unresolved` REFUSES
   * with `main_checkout_unresolved` — a truthful reason, not the false "this
   * is the main worktree".
   */
  function classifyRemoval(cwd: string): {
    verdict: WorktreeRemovalVerdict;
    mainPath?: string;
  } {
    const roots = checkoutRoots({ cwd, timeout: CHECKOUT_ROOTS_TIMEOUT_MS });
    const verdict = classifyWorktreeRemoval(roots);
    return verdict === "removable" && roots?.mainCheckout ? { verdict, mainPath: roots.mainCheckout } : { verdict };
  }

  /**
   * Optimistic stamp: every session under a removed path gets `cwdMissing: true`
   * plus a `sessionUpdated` broadcast. Shared by the single + batch endpoints.
   */
  function stampCwdMissing(cwd: string): void {
    if (!sessionManager || !browserGateway) return;
    for (const id of sessionsUnder(cwd, sessionManager.listAll())) {
      sessionManager.update(id, { cwdMissing: true });
      browserGateway.broadcastSessionUpdated(id, { cwdMissing: true });
    }
  }

  fastify.post<{ Body: { cwd?: string; force?: boolean; deleteBranch?: boolean } }>(
    "/api/git/worktree/remove",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      // B1r: the worktree path being removed (`cwd`) is a caller-supplied git argument — an
      // option-like / control-character value is refused before admission or git.
      if (typeof body.cwd === "string" && presentInvalid(body.cwd)) return invalidRef(reply, "path");
      const validated = await validateCwd(body.cwd, reply);
      if (!validated.ok) return validated.body;
      // Removing the main worktree — or one whose main checkout cannot be
      // resolved — is a clean rejection, not a 500 from git (D3).
      const { verdict, mainPath } = classifyRemoval(validated.cwd);
      if (verdict !== "removable") {
        reply.code(400);
        return {
          success: false,
          code: verdict === "main" ? "is_main_worktree" : "main_checkout_unresolved",
          error: verdict === "main" ? "is_main_worktree" : "main_checkout_unresolved",
        } satisfies ApiResponse;
      }
      const force = body.force === true;
      const deleteBranch = body.deleteBranch === true;
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
      const result = removeWorktree({ cwd: validated.cwd, force, deleteBranch, mainPath });
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
          ...(result.stderr ? { stderr: redact(result.stderr, validated.cwd) } : {}),
        } satisfies ApiResponse;
      }
      stampCwdMissing(validated.cwd);
      return { success: true, data: result.data } satisfies ApiResponse;
    },
  );

  // ── Batch removal + prune (change: manage-worktrees-filter-cleanup) ──
  // The cap (D8) is resolved once at the top of registerGitRoutes.

  fastify.post<{ Body: { items?: Array<{ cwd?: string; force?: boolean; deleteBranch?: boolean }> } }>(
    "/api/git/worktree/remove-batch",
    { preHandler: networkGuard },
    async (request, reply) => {
      const items = (request.body ?? {}).items;
      if (!Array.isArray(items)) {
        reply.code(400);
        return { success: false, code: "items_invalid", error: "items must be an array" } satisfies ApiResponse;
      }
      if (items.length > removeBatchCap) {
        reply.code(400);
        return {
          success: false,
          code: "batch_too_large",
          error: `at most ${removeBatchCap} items per batch`,
        } satisfies ApiResponse;
      }
      // Per-item containment + removal; never abort on first failure (design D4).
      // Classification is PER ITEM (D7): each item is an independent delete
      // decision against live git state — but AT MOST ONCE PER DISTINCT checkout
      // per request: items whose canonical cwd is equal reuse the memoized
      // classification (the spec forbids resolving the same cwd twice within one request).
      //
      // Admission (change: core-cwd-admission, D1): sequential, memoized per distinct RAW cwd
      // (the token is bound to the exact string), under a whole-batch budget. Each admission
      // gets `deadlineMs = min(cap, remaining)`; once the budget is spent only a direct
      // known-folder match (no git derivation) can still be decided. Tokens are released in
      // one `finally`; the envelope stays 200 with per-item codes.
      const classificationMemo = new Map<string, { verdict: WorktreeRemovalVerdict; mainPath?: string }>();
      const admissionMemo = new Map<string, Promise<GitCwdCheck>>();
      const tokens: AdmissionToken[] = [];
      const budgetMs = deps.removeBatchAdmissionBudgetMs ?? REMOVE_BATCH_ADMISSION_BUDGET_MS;
      const capMs = deps.admitOptions?.deadlineMs ?? ADMISSION_DEADLINE_MS;
      const startedAt = Date.now();
      // A scratch reply: a refused/unavailable item must not set the batch's HTTP status.
      const itemReply = { code: () => itemReply, header: () => itemReply, raw: { once: () => undefined } } as unknown as FastifyReply;
      const admitItem = (raw: string): Promise<GitCwdCheck> => {
        let pending = admissionMemo.get(raw);
        if (!pending) {
          const remaining = budgetMs - (Date.now() - startedAt);
          const opts: AdmitCwdOptions =
            remaining > 0
              ? { ...deps.admitOptions, deadlineMs: Math.min(capMs, remaining) }
              : { ...deps.admitOptions, runner: NO_DERIVATION_RUNNER };
          pending = (async (): Promise<GitCwdCheck> => {
            const checked = await admitGitCwd(raw, itemReply, opts);
            if (!checked.ok) return checked;
            tokens.push(checked.token);
            const invalid = (error: string): GitCwdCheck => ({ ok: false, code: "cwd_invalid", body: { success: false, code: "cwd_invalid", error } });
            try {
              if (!(await fs.promises.stat(checked.cwd)).isDirectory()) return invalid("cwd is not a directory");
            } catch {
              return invalid("cwd does not exist");
            }
            return checked;
          })();
          admissionMemo.set(raw, pending);
        }
        return pending;
      };
      const results: Array<Record<string, unknown>> = [];
      try {
        for (const item of items) {
          const rawCwd = item?.cwd;
          if (typeof rawCwd === "string" && presentInvalid(rawCwd)) {
            results.push({ cwd: "", ok: false, code: INVALID_REF_CODE });
            continue;
          }
          const validated: GitCwdCheck =
            !rawCwd || typeof rawCwd !== "string"
              ? { ok: false, code: "cwd_invalid", body: { success: false, code: "cwd_invalid", error: "cwd required" } }
              : await admitItem(rawCwd);
          if (!validated.ok) {
            results.push({ cwd: rawCwd ?? "", ok: false, code: validated.code });
            continue;
          }
          let classification = classificationMemo.get(validated.cwd);
          if (!classification) {
            classification = classifyRemoval(validated.cwd);
            classificationMemo.set(validated.cwd, classification);
          }
          const { verdict, mainPath } = classification;
          if (verdict !== "removable") {
            results.push({
              cwd: validated.cwd,
              ok: false,
              code: verdict === "main" ? "is_main_worktree" : "main_checkout_unresolved",
            });
            continue;
          }
          const force = item.force === true;
          if (sessionManager) {
            const activeIds = activeSessionsUnder(validated.cwd, sessionManager.listAll());
            if (activeIds.length > 0 && !force) {
              results.push({ cwd: validated.cwd, ok: false, code: "active_sessions", sessionIds: activeIds });
              continue;
            }
          }
          const result = removeWorktree({
            cwd: validated.cwd,
            force,
            deleteBranch: item.deleteBranch === true,
            mainPath,
          });
          if (!result.ok) {
            results.push({ cwd: validated.cwd, ok: false, code: result.code, ...(result.stderr ? { stderr: redact(result.stderr, validated.cwd) } : {}) });
            continue;
          }
          stampCwdMissing(validated.cwd);
          results.push({ cwd: validated.cwd, ok: true, code: "ok", ...result.data });
        }
      } finally {
        for (const t of tokens) releaseAdmission(t);
      }
      return { success: true, data: { results } } satisfies ApiResponse;
    },
  );

  fastify.post<{ Body: { cwd?: string } }>(
    "/api/git/worktree/prune",
    { preHandler: networkGuard },
    async (request, reply) => {
      const validated = await validateCwd((request.body ?? {}).cwd, reply);
      if (!validated.ok) return validated.body;
      const result = pruneWorktrees(validated.cwd);
      if (!result.ok) {
        reply.code(result.code === "not_a_worktree" ? 400 : 500);
        return { success: false, code: result.code, error: result.code } satisfies ApiResponse;
      }
      return { success: true, data: result.data } satisfies ApiResponse;
    },
  );

  fastify.post<{ Body: { cwd?: string; deleteBranch?: boolean } }>(
    "/api/git/worktree/merge",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const validated = await validateCwd(body.cwd, reply);
      if (!validated.ok) return validated.body;
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
          result.code === "not_a_worktree" ? 400
          : result.code === "dirty_main" || result.code === "merge_conflict" ? 409
          : result.code === "base_not_found" ? 400
          : 500;
        reply.code(status);
        return {
          success: false,
          code: result.code,
          error: result.code,
          ...(result.stderr ? { stderr: redact(result.stderr, validated.cwd) } : {}),
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
      const validated = await validateCwd(body.cwd, reply);
      if (!validated.ok) return validated.body;
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
          ...(result.stderr ? { stderr: redact(result.stderr, validated.cwd) } : {}),
        } satisfies ApiResponse;
      }
      requestPrRefresh(validated.cwd, "push");
      return { success: true } satisfies ApiResponse;
    },
  );

  fastify.post<{ Body: { cwd?: string; title?: string; body?: string } }>(
    "/api/git/worktree/pr",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const validated = await validateCwd(body.cwd, reply);
      if (!validated.ok) return validated.body;
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
          ...(result.stderr ? { stderr: redact(result.stderr, validated.cwd) } : {}),
        } satisfies ApiResponse;
      }
      requestPrRefresh(validated.cwd, "pr");
      return { success: true, data: result.data } satisfies ApiResponse;
    },
  );

  // ── List pull requests (change: add-worktree-from-pull-request) ──────────
  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/git/pull-requests",
    { preHandler: networkGuard },
    async (request, reply) => {
      const validated = await validateCwd(request.query.cwd, reply);
      if (!validated.ok) return validated.body;
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
          ...(result.stderr ? { stderr: redact(result.stderr, validated.cwd) } : {}),
        } satisfies ApiResponse;
      }
      return { success: true, data: result.data } satisfies ApiResponse;
    },
  );

  // ── Create worktree from PR (change: add-worktree-from-pull-request) ────
  fastify.post<{ Body: { cwd?: string; prNumber?: number; path?: unknown } }>(
    "/api/git/worktree/from-pr",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      // B1r: a present option-like / control-character path is refused before admission or git.
      if (presentInvalid(body.path)) return invalidRef(reply, "path");
      const validated = await validateCwd(body.cwd, reply);
      if (!validated.ok) return validated.body;
      if (typeof body.prNumber !== "number" || !Number.isInteger(body.prNumber) || body.prNumber <= 0) {
        reply.code(400);
        return { success: false, code: "cwd_invalid", error: "prNumber required (positive integer)" } satisfies ApiResponse;
      }
      const pathArg = isValidRefArg(body.path) ? body.path : undefined;
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
          : result.error === "not_a_repo" || result.error === "base_not_found" || result.error === "invalid_ref" ? 400
          : 500;
        reply.code(httpStatus);
        return {
          success: false,
          code: result.error,
          error: redact(result.message, validated.cwd),
          ...(result.stderr ? { stderr: redact(result.stderr, validated.cwd) } : {}),
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
      const validated = await validateCwd(request.query.cwd, reply);
      if (!validated.ok) return validated.body;
      const baseHint = sessionManager
        ? sessionManager.listAll().find((s) => s.cwd === validated.cwd)?.gitWorktreeBase
        : undefined;
      const result = worktreeDiffStat({ cwd: validated.cwd, baseHint });
      if (!result.ok) {
        const status = result.code === "base_not_found" || result.code === "not_a_worktree" ? 400 : 500;
        reply.code(status);
        return {
          success: false,
          code: result.code,
          error: result.code,
          ...(result.stderr ? { stderr: redact(result.stderr, validated.cwd) } : {}),
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
      const admitted = await admitGitCwd(cwd, reply);
      if (!admitted.ok) return admitted.body;
      try {
        const result = stashPop(admitted.cwd);
        return { success: true, data: result } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, code: "stash_pop_failed", error: redactErr(err, "stash pop failed", admitted.cwd) } satisfies ApiResponse;
      }
    },
  );
}
