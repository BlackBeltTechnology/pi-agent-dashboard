/**
 * OpenSpec change-grouping REST routes.
 *
 * Five endpoints under `/api/openspec/groups`. All accept a `cwd` query
 * parameter and validate it against the dashboard's known-cwd set
 * (sessions ∪ pinned directories) — same pattern as `pi-resource-file`
 * in `openspec-routes.ts`.
 *
 * See change: add-openspec-change-grouping (tasks 3.1–3.13).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { SessionManager } from "../session/memory-session-manager.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { NetworkGuard } from "./route-deps.js";
import type {
  ApiResponse,
  OpenSpecGroupsFile,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  ConcurrentEditError,
  GroupNotFoundError,
  UnknownGroupIdError,
  UnsupportedSchemaVersionError,
  type OpenSpecGroupStore,
} from "../openspec/openspec-group-store.js";

export interface OpenSpecGroupRoutesDeps {
  sessionManager: SessionManager;
  preferencesStore: PreferencesStore;
  networkGuard: NetworkGuard;
  store: OpenSpecGroupStore;
}

export function registerOpenSpecGroupRoutes(
  fastify: FastifyInstance,
  deps: OpenSpecGroupRoutesDeps,
): void {
  const { sessionManager, preferencesStore, networkGuard, store } = deps;

  /**
   * Validate `cwd` is non-empty AND in the dashboard's known-cwd set
   * (active or hidden sessions ∪ pinned directories). Returns true when the
   * reply has been short-circuited; false when the route should proceed.
   */
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

  /** Map known store errors to HTTP status codes. */
  function handleError(reply: FastifyReply, err: unknown): ApiResponse {
    if (err instanceof ConcurrentEditError) {
      reply.code(409);
      return {
        success: false,
        error: "Concurrent edit detected",
        data: err.current,
      } satisfies ApiResponse<OpenSpecGroupsFile>;
    }
    if (err instanceof UnsupportedSchemaVersionError) {
      reply.code(422);
      return { success: false, error: err.message } satisfies ApiResponse;
    }
    if (err instanceof GroupNotFoundError) {
      reply.code(404);
      return { success: false, error: "Group not found" } satisfies ApiResponse;
    }
    if (err instanceof UnknownGroupIdError) {
      reply.code(422);
      return { success: false, error: "Unknown groupId" } satisfies ApiResponse;
    }
    reply.code(500);
    const msg = err instanceof Error ? err.message : "internal error";
    return { success: false, error: msg } satisfies ApiResponse;
  }

  // ── GET /api/openspec/groups ─────────────────────────────────

  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/openspec/groups",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd } = request.query;
      if (rejectInvalidCwd(reply, cwd)) return;
      try {
        const data = await store.read(cwd!);
        return { success: true, data } satisfies ApiResponse;
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ── POST /api/openspec/groups ────────────────────────────────

  fastify.post<{
    Querystring: { cwd?: string };
    Body: { name?: unknown; color?: unknown };
  }>(
    "/api/openspec/groups",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd } = request.query;
      if (rejectInvalidCwd(reply, cwd)) return;
      const body = request.body ?? {};
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        reply.code(400);
        return { success: false, error: "name is required" } satisfies ApiResponse;
      }
      const color = typeof body.color === "string" ? body.color : undefined;
      try {
        const created = await store.createGroup(cwd!, { name, ...(color !== undefined ? { color } : {}) });
        reply.code(201);
        return { success: true, data: created } satisfies ApiResponse;
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ── PATCH /api/openspec/groups/:id ───────────────────────────

  fastify.patch<{
    Params: { id: string };
    Querystring: { cwd?: string };
    Body: { name?: unknown; color?: unknown; order?: unknown };
  }>(
    "/api/openspec/groups/:id",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd } = request.query;
      if (rejectInvalidCwd(reply, cwd)) return;
      const { id } = request.params;
      const body = request.body ?? {};
      const update: { name?: string; color?: string; order?: number } = {};
      if (body.name !== undefined) {
        if (typeof body.name !== "string") {
          reply.code(400);
          return { success: false, error: "name must be a string" } satisfies ApiResponse;
        }
        update.name = body.name;
      }
      if (body.color !== undefined) {
        if (typeof body.color !== "string") {
          reply.code(400);
          return { success: false, error: "color must be a string" } satisfies ApiResponse;
        }
        update.color = body.color;
      }
      if (body.order !== undefined) {
        if (typeof body.order !== "number" || !Number.isFinite(body.order)) {
          reply.code(400);
          return { success: false, error: "order must be a number" } satisfies ApiResponse;
        }
        update.order = body.order;
      }
      try {
        const updated = await store.updateGroup(cwd!, id, update);
        return { success: true, data: updated } satisfies ApiResponse;
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ── DELETE /api/openspec/groups/:id ──────────────────────────

  fastify.delete<{
    Params: { id: string };
    Querystring: { cwd?: string };
  }>(
    "/api/openspec/groups/:id",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd } = request.query;
      if (rejectInvalidCwd(reply, cwd)) return;
      const { id } = request.params;
      try {
        await store.deleteGroup(cwd!, id);
        return { success: true } satisfies ApiResponse;
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ── PUT /api/openspec/groups/assignments ─────────────────────

  fastify.put<{
    Querystring: { cwd?: string };
    Body: { changeName?: unknown; groupId?: unknown };
  }>(
    "/api/openspec/groups/assignments",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd } = request.query;
      if (rejectInvalidCwd(reply, cwd)) return;
      const body = request.body ?? {};
      if (typeof body.changeName !== "string" || body.changeName.length === 0) {
        reply.code(400);
        return { success: false, error: "changeName must be a non-empty string" } satisfies ApiResponse;
      }
      if (body.groupId !== null && typeof body.groupId !== "string") {
        reply.code(400);
        return { success: false, error: "groupId must be a string or null" } satisfies ApiResponse;
      }
      try {
        await store.setAssignment(cwd!, body.changeName, body.groupId as string | null);
        return { success: true } satisfies ApiResponse;
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ── PUT /api/openspec/groups/change-order ────────────────────

  fastify.put<{
    Querystring: { cwd?: string };
    Body: { groupId?: unknown; order?: unknown };
  }>(
    "/api/openspec/groups/change-order",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd } = request.query;
      if (rejectInvalidCwd(reply, cwd)) return;
      const body = request.body ?? {};
      if (typeof body.groupId !== "string" || body.groupId.length === 0) {
        reply.code(400);
        return { success: false, error: "groupId must be a non-empty string" } satisfies ApiResponse;
      }
      if (!Array.isArray(body.order) || body.order.some((x) => typeof x !== "string")) {
        reply.code(400);
        return { success: false, error: "order must be an array of strings" } satisfies ApiResponse;
      }
      try {
        await store.setChangeOrder(cwd!, body.groupId, body.order as string[]);
        return { success: true } satisfies ApiResponse;
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // Silence unused-import warning when types are only used at signature level.
  void (undefined as unknown as FastifyRequest);
}
