/**
 * Folder-scoped goal REST routes.
 *
 * Endpoints (cwd passed as a query param + validated against the dashboard's
 * known-cwd set, mirroring `openspec-group-routes.ts`):
 *
 *   GET    /api/folders/goals?cwd=C                  list GoalRecord[]
 *   POST   /api/folders/goals?cwd=C                  create { objective, criteria?, budget?, judge? }
 *   PATCH  /api/folders/goals/:id?cwd=C              update status/objective/criteria/budget/judge
 *   DELETE /api/folders/goals/:id?cwd=C              delete (clears goalId on linked sessions)
 *   POST   /api/folders/goals/:id/sessions?cwd=C     link { sessionId } | spawn { spawn:true, model? }
 *   DELETE /api/folders/goals/:id/sessions/:sid?cwd=C unlink
 *
 * The dashboard owns the durable `GoalRecord`; live loop state stays in the
 * extension, associated by `goalId`. See change: add-goals-folder-page (design.md).
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import type { SessionManager } from "../memory-session-manager.js";
import type { PreferencesStore } from "../preferences-store.js";
import type { NetworkGuard } from "./route-deps.js";
import type { ApiResponse, GoalCriterion, GoalBudget, GoalJudge, GoalRecordStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { GoalNotFoundError, type GoalStore } from "../goal-store.js";

export interface GoalRoutesDeps {
  sessionManager: SessionManager;
  preferencesStore: PreferencesStore;
  networkGuard: NetworkGuard;
  store: GoalStore;
  /** Stamp (goalId) or clear (null) goalId on a session: in-memory + meta + broadcast. */
  applyGoalIdToSession: (sessionId: string, goalId: string | null) => void;
  /** Spawn a headless session under a goal; resolves after spawn (link happens on register). */
  spawnGoalSession?: (
    cwd: string,
    goalId: string,
    opts?: { model?: string },
  ) => Promise<{ success: boolean; message?: string }>;
}

const VALID_STATUS: ReadonlySet<string> = new Set(["pursuing", "paused", "achieved", "cleared"]);

export function registerGoalRoutes(fastify: FastifyInstance, deps: GoalRoutesDeps): void {
  const { sessionManager, preferencesStore, networkGuard, store, applyGoalIdToSession, spawnGoalSession } = deps;

  function rejectInvalidCwd(reply: FastifyReply, cwd: string | undefined): cwd is undefined {
    if (!cwd) {
      reply.code(400);
      reply.send({ success: false, error: "Missing cwd" } satisfies ApiResponse);
      return true;
    }
    const known = new Set<string>();
    for (const s of sessionManager.listAll()) known.add(s.cwd);
    for (const d of preferencesStore.getPinnedDirectories()) known.add(d);
    if (!known.has(cwd)) {
      reply.code(403);
      reply.send({ success: false, error: "cwd not allowed" } satisfies ApiResponse);
      return true;
    }
    return false;
  }

  function handleError(reply: FastifyReply, err: unknown): ApiResponse {
    if (err instanceof GoalNotFoundError) {
      reply.code(404);
      return { success: false, error: "Goal not found" } satisfies ApiResponse;
    }
    // Log the real error server-side; return a fixed public message so internal
    // details (paths, store internals) don't leak to callers.
    console.error("[goal-routes] internal error:", err);
    reply.code(500);
    return { success: false, error: "internal error" } satisfies ApiResponse;
  }

  /** True when `sessionId` is a known session in the same folder. */
  function sessionInCwd(sessionId: string, cwd: string): boolean {
    return sessionManager.listAll().some((s) => s.id === sessionId && s.cwd === cwd);
  }

  /** Returns `undefined` when absent, a validated array, or `null` when present-but-malformed. */
  function parseCriteria(raw: unknown): GoalCriterion[] | undefined | null {
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw)) return null;
    const out: GoalCriterion[] = [];
    for (const c of raw) {
      if (typeof c !== "object" || c === null) return null;
      const text = (c as { text?: unknown }).text;
      if (typeof text !== "string" || text.trim().length === 0) return null;
      out.push({ text, done: !!(c as { done?: unknown }).done });
    }
    return out;
  }

  /** Returns `undefined` when absent, a validated budget, or `null` when present-but-malformed. */
  function parseBudget(raw: unknown): GoalBudget | undefined | null {
    if (raw === undefined) return undefined;
    if (typeof raw !== "object" || raw === null) return null;
    const b = raw as { maxTurns?: unknown; maxSpendUsd?: unknown };
    const budget: GoalBudget = {};
    if (b.maxTurns !== undefined) {
      if (typeof b.maxTurns !== "number" || !Number.isFinite(b.maxTurns)) return null;
      budget.maxTurns = b.maxTurns;
    }
    if (b.maxSpendUsd !== undefined) {
      if (typeof b.maxSpendUsd !== "number" || !Number.isFinite(b.maxSpendUsd)) return null;
      budget.maxSpendUsd = b.maxSpendUsd;
    }
    return budget;
  }

  /** Returns `undefined` when absent, a validated judge, or `null` when present-but-malformed. */
  function parseJudge(raw: unknown): GoalJudge | undefined | null {
    if (raw === undefined) return undefined;
    if (typeof raw !== "object" || raw === null) return null;
    const j = raw as { provider?: unknown; modelId?: unknown; sameModel?: unknown };
    if (typeof j.provider !== "string" || j.provider.trim().length === 0) return null;
    if (typeof j.modelId !== "string" || j.modelId.trim().length === 0) return null;
    if (j.sameModel !== undefined && typeof j.sameModel !== "boolean") return null;
    const judge: GoalJudge = { provider: j.provider.trim(), modelId: j.modelId.trim() };
    if (j.sameModel !== undefined) judge.sameModel = j.sameModel;
    return judge;
  }

  // ── GET list ─────────────────────────────────────────────────
  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/folders/goals",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd } = request.query;
      if (rejectInvalidCwd(reply, cwd)) return;
      try {
        const data = await store.list(cwd!);
        return { success: true, data } satisfies ApiResponse;
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ── POST create ──────────────────────────────────────────────
  fastify.post<{
    Querystring: { cwd?: string };
    Body: { objective?: unknown; criteria?: unknown; budget?: unknown; judge?: unknown };
  }>(
    "/api/folders/goals",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd } = request.query;
      if (rejectInvalidCwd(reply, cwd)) return;
      const body = request.body ?? {};
      const objective = typeof body.objective === "string" ? body.objective.trim() : "";
      if (!objective) {
        reply.code(400);
        return { success: false, error: "objective is required" } satisfies ApiResponse;
      }
      const criteria = parseCriteria(body.criteria);
      if (criteria === null) {
        reply.code(400);
        return { success: false, error: "criteria must be an array of { text, done? }" } satisfies ApiResponse;
      }
      const budget = parseBudget(body.budget);
      if (budget === null) {
        reply.code(400);
        return { success: false, error: "budget must be { maxTurns?, maxSpendUsd? } numbers" } satisfies ApiResponse;
      }
      const judge = parseJudge(body.judge);
      if (judge === null) {
        reply.code(400);
        return { success: false, error: "judge must be { provider, modelId, sameModel? }" } satisfies ApiResponse;
      }
      try {
        const created = await store.create(cwd!, {
          objective,
          ...(criteria !== undefined ? { criteria } : {}),
          ...(budget !== undefined ? { budget } : {}),
          ...(judge !== undefined ? { judge } : {}),
        });
        reply.code(201);
        return { success: true, data: created } satisfies ApiResponse;
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ── PATCH update ─────────────────────────────────────────────
  fastify.patch<{
    Params: { id: string };
    Querystring: { cwd?: string };
    Body: { objective?: unknown; criteria?: unknown; budget?: unknown; judge?: unknown; status?: unknown };
  }>(
    "/api/folders/goals/:id",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd } = request.query;
      if (rejectInvalidCwd(reply, cwd)) return;
      const { id } = request.params;
      const body = request.body ?? {};
      const update: { objective?: string; criteria?: GoalCriterion[]; budget?: GoalBudget; judge?: GoalJudge; status?: GoalRecordStatus } = {};
      if (body.objective !== undefined) {
        if (typeof body.objective !== "string") {
          reply.code(400);
          return { success: false, error: "objective must be a string" } satisfies ApiResponse;
        }
        update.objective = body.objective;
      }
      if (body.status !== undefined) {
        if (typeof body.status !== "string" || !VALID_STATUS.has(body.status)) {
          reply.code(400);
          return { success: false, error: "invalid status" } satisfies ApiResponse;
        }
        update.status = body.status as GoalRecordStatus;
      }
      const criteria = parseCriteria(body.criteria);
      if (criteria === null) {
        reply.code(400);
        return { success: false, error: "criteria must be an array of { text, done? }" } satisfies ApiResponse;
      }
      if (criteria !== undefined) update.criteria = criteria;
      const budget = parseBudget(body.budget);
      if (budget === null) {
        reply.code(400);
        return { success: false, error: "budget must be { maxTurns?, maxSpendUsd? } numbers" } satisfies ApiResponse;
      }
      if (budget !== undefined) update.budget = budget;
      const judge = parseJudge(body.judge);
      if (judge === null) {
        reply.code(400);
        return { success: false, error: "judge must be { provider, modelId, sameModel? }" } satisfies ApiResponse;
      }
      if (judge !== undefined) update.judge = judge;
      try {
        const updated = await store.update(cwd!, id, update);
        return { success: true, data: updated } satisfies ApiResponse;
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ── DELETE goal ──────────────────────────────────────────────
  fastify.delete<{ Params: { id: string }; Querystring: { cwd?: string } }>(
    "/api/folders/goals/:id",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd } = request.query;
      if (rejectInvalidCwd(reply, cwd)) return;
      const { id } = request.params;
      try {
        const formerSessionIds = await store.delete(cwd!, id);
        for (const sid of formerSessionIds) applyGoalIdToSession(sid, null);
        return { success: true } satisfies ApiResponse;
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ── POST link | spawn session ────────────────────────────────
  fastify.post<{
    Params: { id: string };
    Querystring: { cwd?: string };
    Body: { sessionId?: unknown; spawn?: unknown; model?: unknown };
  }>(
    "/api/folders/goals/:id/sessions",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd } = request.query;
      if (rejectInvalidCwd(reply, cwd)) return;
      const { id } = request.params;
      const body = request.body ?? {};

      // Spawn path: { spawn: true, model? }
      if (body.spawn === true) {
        if (!spawnGoalSession) {
          reply.code(501);
          return { success: false, error: "spawn not supported" } satisfies ApiResponse;
        }
        try {
          // Validate the goal exists before spawning.
          const goals = await store.list(cwd!);
          if (!goals.some((g) => g.id === id)) throw new GoalNotFoundError(id);
          const model = typeof body.model === "string" ? body.model : undefined;
          const res = await spawnGoalSession(cwd!, id, model ? { model } : undefined);
          if (!res.success) {
            reply.code(500);
            return { success: false, error: res.message ?? "spawn failed" } satisfies ApiResponse;
          }
          return { success: true } satisfies ApiResponse;
        } catch (err) {
          return handleError(reply, err);
        }
      }

      // Link path: { sessionId }
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
      if (!sessionId) {
        reply.code(400);
        return { success: false, error: "sessionId or spawn:true required" } satisfies ApiResponse;
      }
      if (!sessionInCwd(sessionId, cwd!)) {
        reply.code(400);
        return { success: false, error: "sessionId is not a known session in this folder" } satisfies ApiResponse;
      }
      try {
        const updated = await store.linkSession(cwd!, id, sessionId);
        applyGoalIdToSession(sessionId, id);
        return { success: true, data: updated } satisfies ApiResponse;
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ── DELETE unlink session ────────────────────────────────────
  fastify.delete<{ Params: { id: string; sid: string }; Querystring: { cwd?: string } }>(
    "/api/folders/goals/:id/sessions/:sid",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd } = request.query;
      if (rejectInvalidCwd(reply, cwd)) return;
      const { id, sid } = request.params;
      try {
        const updated = await store.unlinkSession(cwd!, id, sid);
        applyGoalIdToSession(sid, null);
        return { success: true, data: updated } satisfies ApiResponse;
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );
}
