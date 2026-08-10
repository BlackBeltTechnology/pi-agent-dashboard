/**
 * Content-search REST route (localhost-only): `GET /api/grep`.
 *
 * Prefers `ripgrep`, falls back to a bounded in-process scan. Applies the same
 * security gates as `/api/file`: `cwd` must be a known session path; every
 * returned match path must resolve within `cwd` (traversal excluded).
 *
 * See change: split-editor-workspace.
 */

import path from "node:path";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import { runGrep } from "../lib/grep.js";
import { isAllowed } from "../lib/path-containment.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import { detectRipgrep } from "../ripgrep-detection.js";
import type { NetworkGuard } from "./route-deps.js";

/** Minimum query length (mirrors the client min-3-char guard). */
const MIN_QUERY_LEN = 3;

export function registerGrepRoutes(
  fastify: FastifyInstance,
  deps: {
    sessionManager: SessionManager;
    networkGuard: NetworkGuard;
  },
) {
  const { sessionManager, networkGuard } = deps;

  fastify.get<{ Querystring: { cwd?: string; q?: string; regex?: string } }>(
    "/api/grep",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      const q = request.query.q;
      const regex = request.query.regex === "1" || request.query.regex === "true";

      if (!cwd || !q) {
        reply.code(400);
        return { success: false, error: "cwd and q parameters required" } satisfies ApiResponse;
      }
      if (q.length < MIN_QUERY_LEN) {
        reply.code(400);
        return { success: false, error: `q must be at least ${MIN_QUERY_LEN} characters` } satisfies ApiResponse;
      }

      // Gate 1 — cwd must be a known session path (mirrors /api/file).
      if (!sessionManager.listAll().some((s) => s.cwd === cwd)) {
        reply.code(403);
        return { success: false, error: "unknown session path" } satisfies ApiResponse;
      }

      let matches = await runGrep(cwd, q, { regex, rgPath: detectRipgrep() });

      // Gate 2 — containment: drop any match that resolves outside cwd. rg/JS
      // scan already stay under cwd, so this is a defensive backstop.
      const contained = await Promise.all(
        matches.map(async (m) => (await isAllowed(path.resolve(cwd, m.path), { anchors: [cwd] })) ? m : null),
      );
      matches = contained.filter((m): m is NonNullable<typeof m> => m !== null);

      return { success: true, data: { matches } } satisfies ApiResponse;
    },
  );
}
