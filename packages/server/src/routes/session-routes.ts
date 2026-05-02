/**
 * Session-related REST API routes.
 */
import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import type { FastifyInstance } from "fastify";
import type { SessionManager } from "../memory-session-manager.js";
import type { EventStore } from "../memory-event-store.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { NetworkGuard } from "./route-deps.js";
import { extractFileChanges, enrichWithVcsDiff } from "../session-diff.js";

export function registerSessionRoutes(
  fastify: FastifyInstance,
  deps: {
    sessionManager: SessionManager;
    eventStore: EventStore;
    networkGuard: NetworkGuard;
  },
) {
  const { sessionManager, eventStore, networkGuard } = deps;

  fastify.get("/api/sessions", async () => {
    const sessions = sessionManager.listAll();
    return { success: true, data: sessions } satisfies ApiResponse;
  });

  fastify.get<{ Params: { sessionId: string; seq: string } }>(
    "/api/events/:sessionId/:seq",
    async (request) => {
      const { sessionId, seq } = request.params;
      const event = eventStore.getEvent(sessionId, parseInt(seq, 10));
      if (!event) {
        return { success: false, error: "Event not found" } satisfies ApiResponse;
      }
      return { success: true, data: event } satisfies ApiResponse;
    },
  );

  // Session file diff endpoint (localhost-only)
  fastify.get<{ Querystring: { sessionId?: string } }>(
    "/api/session-diff",
    { preHandler: networkGuard },
    async (request) => {
      const { sessionId } = request.query;
      if (!sessionId) {
        return { success: false, error: "sessionId required" } satisfies ApiResponse;
      }
      const session = sessionManager.get(sessionId);
      if (!session) {
        return { success: false, error: "session not found" } satisfies ApiResponse;
      }
      const events = eventStore.getEvents(sessionId, 0).map((e) => e.event);
      const files = extractFileChanges(events, session.cwd);
      const result = enrichWithVcsDiff(session.cwd, files, session.jjState);
      return {
        success: true,
        data: {
          files: result.enrichedFiles,
          isGitRepo: result.isGitRepo,
          vcsKind: result.vcsKind,
          diffBase: result.diffBase,
          baseLabel: result.baseLabel,
        },
      } satisfies ApiResponse;
    },
  );

  // Read a file within a session's cwd (localhost-only)
  fastify.get<{ Querystring: { sessionId?: string; path?: string } }>(
    "/api/session-file",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { sessionId, path: filePath } = request.query;
      if (!sessionId || !filePath) {
        reply.code(400);
        return { success: false, error: "sessionId and path required" } satisfies ApiResponse;
      }
      const session = sessionManager.get(sessionId);
      if (!session) {
        reply.code(404);
        return { success: false, error: "session not found" } satisfies ApiResponse;
      }
      // Resolve and ensure path is within cwd
      const absPath = isAbsolute(filePath) ? filePath : resolve(session.cwd, filePath);
      const rel = relative(session.cwd, absPath);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        reply.code(403);
        return { success: false, error: "path outside session directory" } satisfies ApiResponse;
      }
      try {
        const content = await readFile(absPath, "utf-8");
        return { success: true, data: { content } } satisfies ApiResponse;
      } catch {
        reply.code(404);
        return { success: false, error: "file not found" } satisfies ApiResponse;
      }
    },
  );
}
