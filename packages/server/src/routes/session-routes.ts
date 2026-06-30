/**
 * Session-related REST API routes.
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import type { EventStore } from "../memory-event-store.js";
import type { SessionManager } from "../memory-session-manager.js";
import { enrichWithVcsDiff, extractFileChanges } from "../session-diff.js";
import { loadSessionEntries } from "../session-file-reader.js";
import type { NetworkGuard } from "./route-deps.js";

/**
 * Strategy B (reduce-session-replay-traffic): extract the FULL untruncated
 * tool-result body for a JSONL entry. Reads the persisted session file, NOT the
 * 4 KB-truncated in-memory store, so an expanded stub reveals full fidelity.
 * Matches the key against the JSONL `entry.id` (disk-replay stubs) OR
 * `message.toolCallId` (live-path stubs, where the disk entry id is unknown) so
 * either replay origin resolves.
 */
function readToolResultBody(
  filePath: string,
  key: string,
): { result: string; isError: boolean } | null {
  const entry = loadSessionEntries(filePath).find(
    (e) => e.message?.role === "toolResult" && (e.id === key || e.message?.toolCallId === key),
  );
  if (!entry) return null;
  const content = entry.message?.content as unknown;
  const result = Array.isArray(content)
    ? (content as Array<{ type?: string; text?: string }>)
        .filter((c) => c?.type === "text")
        .map((c) => c.text ?? "")
        .join("")
    : typeof content === "string"
      ? content
      : "";
  return { result, isError: Boolean(entry.message?.isError) };
}

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

  // Strategy B full-fidelity tool body by JSONL entry id. Reads the persisted
  // session file (untruncated), unlike `/api/events/:sessionId/:seq` which is
  // backed by the 4 KB-truncated in-memory store. 404 on unknown session/entry
  // so an offline / stale expand degrades to preview + retry on the client.
  fastify.get<{ Params: { sessionId: string; entryId: string } }>(
    "/api/sessions/:sessionId/tool-result/:entryId",
    async (request, reply) => {
      const { sessionId, entryId } = request.params;
      const session = sessionManager.get(sessionId);
      if (!session?.sessionFile) {
        reply.code(404);
        return { success: false, error: "session not found" } satisfies ApiResponse;
      }
      const body = readToolResultBody(session.sessionFile, entryId);
      if (!body) {
        reply.code(404);
        return { success: false, error: "tool result not found" } satisfies ApiResponse;
      }
      return { success: true, data: body } satisfies ApiResponse;
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
      const result = enrichWithVcsDiff(session.cwd, files);
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
