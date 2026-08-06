/**
 * Attachment-original REST route (localhost-only):
 * `GET /api/sessions/:sessionId/attachments/:attachmentId`.
 *
 * Serves the FULL-RESOLUTION bytes behind a fitted transcript image, for
 * click-to-zoom. This path is deliberately NOT load-bearing: the fitted
 * derivative is already inline in the event, so a failure here degrades only
 * the zoom view, never the message or its thumbnail (spec).
 *
 * Security gates, in order — each one closes a distinct attack:
 *  1. `networkGuard` — same authorisation as every other session-data route.
 *  2. Session must exist AND be known to this dashboard, else 404.
 *  3. `attachmentId` must be a 64-char lowercase-hex digest, else 400. Nothing
 *     from the request ever becomes a path component, so traversal is
 *     structurally impossible (X3).
 *  4. Recovery is scoped to THAT session's transcript, so a valid digest from
 *     another session is simply not found (X2).
 *  5. Only allow-listed raster types are served, always with `nosniff` and a
 *     `default-src 'none'; sandbox` CSP, so the response can never be
 *     interpreted as active content (E14/E15). Deliberately NO
 *     `Content-Disposition: attachment`: the bytes are rendered inline by the
 *     zoom overlay, and forcing a download would break that while adding
 *     nothing — the allow-list plus `nosniff` plus the sandbox CSP already
 *     stop the response being executed.
 *
 * See change: fit-attachments-for-display (task 5.7, D8).
 */
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import { findOriginalInTranscript, isValidAttachmentId } from "../attachments/original-store.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import type { NetworkGuard } from "./route-deps.js";

export function registerAttachmentRoutes(
  fastify: FastifyInstance,
  deps: {
    sessionManager: SessionManager;
    networkGuard: NetworkGuard;
  },
) {
  const { sessionManager, networkGuard } = deps;

  fastify.get<{ Params: { sessionId: string; attachmentId: string } }>(
    "/api/sessions/:sessionId/attachments/:attachmentId",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { sessionId, attachmentId } = request.params;

      const session = sessionManager.get(sessionId);
      if (!session?.sessionFile) {
        // Unknown session, or one with no transcript to recover from. Same
        // 404 either way — do not distinguish, so the endpoint cannot be used
        // to probe which session ids exist. This gate precedes the shape check
        // deliberately: answering 400 for a malformed id on a NON-existent
        // session would make the status code reveal which sessions are real.
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      }

      // Shape-check before the recovery path: a malformed id is a client error
      // and must never reach transcript scanning.
      if (!isValidAttachmentId(attachmentId)) {
        reply.code(400);
        return { success: false, error: "invalid attachment id" } satisfies ApiResponse;
      }

      const original = await findOriginalInTranscript(session.sessionFile, attachmentId);
      if (!original) {
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      }

      reply.header("Content-Type", original.mimeType);
      // Belt-and-braces against content sniffing and inline execution.
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
      // The bytes are content-addressed and therefore immutable, but they are
      // also PRIVATE user screenshots behind an auth check. Caching them for a
      // year wrote them to browser/proxy disk caches, where they outlive the
      // session and the credential that unlocked them (CWE-524). Immutability
      // is not a reason to persist someone's screen contents; re-fetch instead.
      reply.header("Cache-Control", "no-store, private");
      reply.header("Content-Length", String(original.bytes.length));
      return reply.send(original.bytes);
    },
  );
}
