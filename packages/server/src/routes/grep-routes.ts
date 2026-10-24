/**
 * Content-search REST route (localhost-only): `GET /api/grep`.
 *
 * Prefers `ripgrep`, falls back to a bounded in-process scan. Applies the same
 * security gates as `/api/file`: `cwd` must be admitted by the shared cwd guard
 * (session, pinned or workspace folder, or a worktree / main checkout of a known
 * repository); every returned match path must resolve within `cwd` (and its
 * canonical form; traversal excluded).
 *
 * See change: split-editor-workspace, core-file-cwd-admission.
 */

import path from "node:path";
import { containmentAllows } from "@blackbelt-technology/pi-dashboard-shared/containment-guard.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import { grantedSubjects } from "../access/access-grants.js";
import { decidePassive } from "../access/containment-gate.js";
import { admitFileCwd, cwdAnchors } from "../lib/file-cwd-admission.js";
import { runGrep } from "../lib/grep.js";
import type { RouteAdmissionDeps } from "../lib/route-admission.js";
import { detectRipgrep } from "../ripgrep-detection.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import { sendGateFailure } from "./file-routes.js";
import type { NetworkGuard } from "./route-deps.js";

/** Minimum query length (mirrors the client min-3-char guard). */
const MIN_QUERY_LEN = 3;

export function registerGrepRoutes(
  fastify: FastifyInstance,
  deps: {
    sessionManager: SessionManager;
    networkGuard: NetworkGuard;
    /** Shared cwd admission. Absent → the known set is the `sessionManager`'s session cwds only. */
    routeAdmission?: RouteAdmissionDeps;
  },
) {
  const { sessionManager, networkGuard } = deps;
  const routeAdmission: RouteAdmissionDeps = deps.routeAdmission ?? {
    knownCwds: () => sessionManager.listAll().map((s) => s.cwd),
  };

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

      // Gate 1 — cwd must be admitted by the shared guard (mirrors /api/file).
      const admitted = await admitFileCwd(cwd, routeAdmission, { reply });
      if (!admitted.ok) return sendGateFailure(reply, admitted.failure);
      const anchors = cwdAnchors(admitted);

      let matches = await runGrep(admitted.cwd, q, { regex, rgPath: detectRipgrep() });

      // Gate 2 — containment: drop any match that resolves outside cwd. rg/JS
      // scan already stay under cwd, so this is a defensive backstop.
      // The grant subject list is hoisted OUT of the per-match loop: awaiting a
      // store read per match is the amplification design D16 exists to avoid
      // (N matches x 200 grants). This site filters rather than 403ing, so it
      // CONSUMES grants and can never originate one (design D12).
      const grantSubjects = grantedSubjects();
      const contained = await Promise.all(
        matches.map(async (m) => {
          const resolvedMatch = path.resolve(admitted.cwd, m.path);
          const verdict = await decidePassive(resolvedMatch, anchors, { allowGrant: true, grantSubjects });
          return containmentAllows(verdict, resolvedMatch) ? m : null;
        }),
      );
      matches = contained.filter((m): m is NonNullable<typeof m> => m !== null);

      return { success: true, data: { matches } } satisfies ApiResponse;
    },
  );
}
