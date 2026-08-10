/**
 * Session-related REST API routes.
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import type { EventStore } from "../persistence/memory-event-store.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import { buildSessionDiffCached, type SessionDiffResult } from "../session/session-diff.js";
import { SessionDiffCache } from "../session/session-diff-cache.js";
import { findSessionToolCallPayload } from "../session/session-file-reader.js";
import type { NetworkGuard } from "./route-deps.js";

export function registerSessionRoutes(
  fastify: FastifyInstance,
  deps: {
    sessionManager: SessionManager;
    eventStore: EventStore;
    networkGuard: NetworkGuard;
  },
) {
  const { sessionManager, eventStore, networkGuard } = deps;

  // Per-server session-diff result cache + single-flight coordinator. Short TTL
  // so repeated UI polls of an unchanged session skip recompute, and concurrent
  // identical requests coalesce onto one git computation. See change:
  // fix-session-diff-eventloop-block.
  const sessionDiffCache = new SessionDiffCache<SessionDiffResult>();

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

  // Full tool result lookup (localhost-only). The client renders only the
  // last N lines of large tool output; this returns the full stored result
  // for the "Show full output" affordance. 404 when the tool call is still
  // in flight or its event was evicted. See change:
  // adopt-pi-071-072-073-features.
  fastify.get<{ Params: { sessionId: string; toolCallId: string } }>(
    "/api/sessions/:sessionId/tool-result/:toolCallId",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { sessionId, toolCallId } = request.params;
      const event = eventStore.findToolEndEvent(sessionId, toolCallId);
      if (!event) {
        reply.code(404);
        return { error: "tool call still in flight or unknown" };
      }
      const data = (event.data ?? {}) as Record<string, unknown>;
      return { result: data.result ?? "", isError: data.isError === true };
    },
  );

  // Full session-authored Write/Edit payload from the on-disk JSONL, addressed
  // by (sessionId, toolCallId) — NEVER by filesystem path. Upgrades an
  // out-of-cwd (or any truncated) diff to full fidelity: the in-memory event
  // store caps strings at ~4 KB and collapses `edits` arrays >20, so this is
  // REQUIRED for correctness on large Writes / Edits, not merely an optimization.
  // The sessionFile is resolved via sessionManager (set at session creation),
  // never constructed from the sessionId string. Miss → 404, reads nothing else.
  // See change: opt-in-out-of-cwd-session-diffs.
  fastify.get<{ Params: { sessionId: string; toolCallId: string } }>(
    "/api/session-change/:sessionId/:toolCallId",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { sessionId, toolCallId } = request.params;
      const session = sessionManager.get(sessionId);
      if (!session?.sessionFile) {
        reply.code(404);
        return { success: false, error: "session not found" } satisfies ApiResponse;
      }
      const payload = findSessionToolCallPayload(session.sessionFile, toolCallId);
      if (!payload) {
        reply.code(404);
        return { success: false, error: "tool call not found" } satisfies ApiResponse;
      }
      return { success: true, data: payload } satisfies ApiResponse;
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
      const result = await buildSessionDiffCached(sessionId, events, session.cwd, sessionDiffCache);
      return {
        success: true,
        data: {
          files: result.files,
          otherChanges: result.otherChanges,
          isGitRepo: result.isGitRepo,
          vcsKind: result.vcsKind,
          diffBase: result.diffBase,
          baseLabel: result.baseLabel,
          totalAdditions: result.totalAdditions,
          totalDeletions: result.totalDeletions,
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
