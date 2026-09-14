/**
 * Session-related REST API routes.
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import type { EventStore } from "../persistence/memory-event-store.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import { decodeCursor, type SessionArchive } from "../session/session-archive.js";
import { buildSessionDiffCached, type SessionDiffResult } from "../session/session-diff.js";
import { SessionDiffCache } from "../session/session-diff-cache.js";
import type { RemoteTranscriptStore } from "../session/remote-transcript-store.js";
import { decideRetainedRead, readRetainedTranscript } from "../session/retained-transcript.js";
import { findSessionToolCallPayload } from "../session/session-file-reader.js";
import { originOf } from "../session/session-origin.js";
import type { NetworkGuard } from "./route-deps.js";

export function registerSessionRoutes(
  fastify: FastifyInstance,
  deps: {
    sessionManager: SessionManager;
    eventStore: EventStore;
    networkGuard: NetworkGuard;
    /** Archive index backing the on-demand listing/search/delete endpoints.
     *  See change: archive-sessions-lazy-load. */
    sessionArchive?: SessionArchive;
    /** Retention store backing `GET /api/sessions/:id/retained-transcript`.
     *  See change: serve-retained-remote-transcripts. */
    remoteTranscriptStore?: RemoteTranscriptStore;
  },
) {
  const { sessionManager, eventStore, networkGuard, sessionArchive, remoteTranscriptStore } = deps;

  // Per-server session-diff result cache + single-flight coordinator. Short TTL
  // so repeated UI polls of an unchanged session skip recompute, and concurrent
  // identical requests coalesce onto one git computation. See change:
  // fix-session-diff-eventloop-block.
  const sessionDiffCache = new SessionDiffCache<SessionDiffResult>();

  fastify.get("/api/sessions", async () => {
    const sessions = sessionManager.listAll();
    return { success: true, data: sessions } satisfies ApiResponse;
  });

  // On-demand listing of archived sessions, served from the in-memory index
  // (no disk IO). Query: cwd (absolute group path), limit (1-200, default 50),
  // cursor (opaque), q (substring, >= 3 chars). See change:
  // archive-sessions-lazy-load.
  fastify.get<{ Querystring: { cwd?: string; limit?: string; cursor?: string; q?: string } }>(
    "/api/sessions/archived",
    async (request, reply) => {
      const startedMs = Date.now();
      const { cwd, limit, cursor, q } = request.query;
      if (cwd !== undefined && (cwd === "" || !isAbsolute(cwd))) {
        reply.code(400);
        return { success: false, error: "cwd must be an absolute path" } satisfies ApiResponse;
      }
      if (cursor !== undefined && cursor !== "" && decodeCursor(cursor) === null) {
        reply.code(400);
        return { success: false, error: "invalid cursor" } satisfies ApiResponse;
      }
      const parsedLimit = typeof limit === "string" ? Number.parseInt(limit, 10) : Number.NaN;
      const effectiveLimit = Number.isFinite(parsedLimit)
        ? Math.min(200, Math.max(1, parsedLimit))
        : 50;
      const result = sessionArchive?.list({
        ...(cwd !== undefined ? { cwd } : {}),
        limit: effectiveLimit,
        ...(cursor !== undefined && cursor !== "" ? { cursor } : {}),
        ...(q !== undefined ? { q } : {}),
      }) ?? { items: [] };
      // P2: request-timing log for the listing endpoint (no threshold).
      console.debug(
        `[archive] GET /api/sessions/archived cwd=${cwd ?? "*"} limit=${effectiveLimit} ` +
          `q=${q ?? ""} → ${result.items.length} items in ${Date.now() - startedMs} ms`,
      );
      return { success: true, data: result } satisfies ApiResponse;
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/sessions/archived/:id",
    async (request, reply) => {
      const item = sessionArchive?.getById(request.params.id);
      if (!item) {
        reply.code(404);
        return { success: false, error: "session is not archived" } satisfies ApiResponse;
      }
      return { success: true, data: { item } } satisfies ApiResponse;
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    "/api/sessions/archived/:id",
    { preHandler: networkGuard },
    async (request, reply) => {
      const result = sessionArchive?.deleteArchived(request.params.id);
      if (!result?.ok) {
        reply.code(result?.notFound ? 404 : 500);
        return { success: false, error: result?.error ?? "archive unavailable" } satisfies ApiResponse;
      }
      return { success: true } satisfies ApiResponse;
    },
  );

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

  // The retained transcript of a REMOTE-origin session (D12 read half).
  //
  // Addressed by the route parameter alone. Any path-bearing query field is a
  // refusal, not a sanitisation target — the same rule, from the same module,
  // that the bridge applies to an inbound `transcript_request`.
  // See change: serve-retained-remote-transcripts (tasks 1.1, 1.2, 1.3).
  // `networkGuard`d like every other content-bearing session read in this file
  // (`session-file`, `session-change`, `session-diff`, `tool-result`). The
  // browser does not need this route — it gets retained history through
  // subscribe-time hydration over the authenticated WebSocket — so the route's
  // consumers are local, and a full-fidelity transcript is not a thing to hand
  // to any client that can merely reach the port.
  fastify.get<{ Params: { sessionId: string }; Querystring: Record<string, unknown> }>(
    "/api/sessions/:sessionId/retained-transcript",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { sessionId } = request.params;
      // SHAPE first, and BEFORE the session lookup. Answering a path-bearing
      // probe 404 for an unknown id and 400 for a known one would difference
      // two refusals into exactly the oracle the guard's ordering exists to
      // deny — the check has to run before anything observes the subject.
      const shape = decideRetainedRead({
        sessionId,
        query: request.query ?? {},
        // Not yet resolved; the origin arm is re-decided below once it is. This
        // call is here for its shape half only, and `remote` is the value that
        // lets the shape half be the only thing that can refuse.
        origin: { local: false },
      });
      if (!shape.allow) {
        reply.code(400);
        return { success: false, error: shape.reason } satisfies ApiResponse;
      }
      // Archived sessions are non-resident, so `sessionManager.get` misses —
      // and an archived remote session is exactly the case where the retained
      // copy is the ONLY copy, its origin host being long gone. Resolve origin
      // the same way cold hydration does. See change:
      // serve-retained-remote-transcripts.
      const session = sessionManager.get(sessionId);
      const archived = sessionArchive?.getById(sessionId);
      if (!session && !archived) {
        reply.code(404);
        return { success: false, error: "session not found" } satisfies ApiResponse;
      }
      const verdict = decideRetainedRead({
        sessionId,
        query: request.query ?? {},
        origin: originOf(session ?? { originDeviceId: archived?.originDeviceId }),
      });
      if (!verdict.allow) {
        // A legitimate shape aimed at a subject this route does not serve.
        reply.code(403);
        return { success: false, error: verdict.reason } satisfies ApiResponse;
      }
      if (!remoteTranscriptStore) {
        reply.code(503);
        return { success: false, error: "remote transcript retention is not enabled" } satisfies ApiResponse;
      }
      const retained = readRetainedTranscript(remoteTranscriptStore, sessionId, session?.contextWindow);
      // `state` rides alongside the entries rather than being inferred from
      // their emptiness: an empty COMPLETE transfer and a never-started one are
      // both zero entries and are not the same fact (task 1.2).
      return {
        success: true,
        data: { entries: retained.entries, state: retained.state },
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
      // A REMOTE session's `cwd` is a path on ANOTHER host. Confining to it
      // here is a check that does not travel: two machines with the same
      // username produce the same path, so this would happily serve an
      // unrelated local file as if it were the remote workspace's. Correctness
      // first, security second — and the origin comes from the credential the
      // bridge registered with, never from anything it claimed.
      // See change: add-pi-gateway-transport-identity (#E15, task 11.8).
      const origin = originOf(session);
      if (!origin.local) {
        reply.code(403);
        return {
          success: false,
          error: `session ${sessionId} was registered by remote device ${origin.deviceId ?? "unknown"}; its files are not on this host`,
        } satisfies ApiResponse;
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
