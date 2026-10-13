/**
 * Folder project identity route (localhost-only): `GET /api/folder/project`.
 *
 * Returns `{ id, types, source, truncated? }` for an ADMITTED folder: the
 * declared `.pi/dashboard/project.json` plus marker-rule detection from loaded
 * + enabled plugins (see `../lib/folder-project.ts` for the bounds).
 *
 * Admission is the shared tri-state `admitCwd` (known session/pinned cwds +
 * git-derived checkout roots): refuse → 403, indeterminate → 503 +
 * `Retry-After`. It runs BEFORE any fs access and never prompts (a background
 * sidebar fetch must not raise an operator dialog — hence no `holdDenial`).
 * Read-only: never creates or modifies a file.
 *
 * See change: add-project-scoped-apps.
 */
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { type AdmitCwdOptions, admitCwd, releaseAdmission } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import type { FolderProject } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import type { FastifyInstance } from "fastify";
import { type ProjectRuleSource, resolveFolderProject } from "../lib/folder-project.js";
import type { NetworkGuard } from "./route-deps.js";

export interface FolderProjectRouteDeps {
  networkGuard: NetworkGuard;
  /** Known folders: session cwds + pinned directories. */
  knownCwds: () => string[];
  /** Rules of plugins that are loaded + enabled + fixture-allowed, at call time. */
  getRuleSources: () => ProjectRuleSource[];
  /** `admitCwd` options (host `onIndeterminate` logger; test seams). */
  admitOptions?: AdmitCwdOptions;
  /** Test seam: replaces the resolver. */
  resolve?: (cwd: string, sources: ProjectRuleSource[]) => Promise<FolderProject>;
  /** Called when a resolution reports `truncated` (debug log). */
  onTruncated?: (cwd: string) => void;
}

export function registerFolderProjectRoutes(fastify: FastifyInstance, deps: FolderProjectRouteDeps): void {
  const { networkGuard, knownCwds, getRuleSources } = deps;
  const resolve = deps.resolve ?? ((cwd, sources) => resolveFolderProject(cwd, sources));
  /** Simultaneous requests for one (admitted) cwd share one resolution. */
  const inFlight = new Map<string, Promise<FolderProject | "missing">>();

  const run = async (cwd: string): Promise<FolderProject | "missing"> => {
    // Admitted but deleted (or not a directory) → 404. `stat` follows a symlinked cwd
    // on purpose: the operator-admitted path is the folder being asked about.
    const isDir = await stat(cwd).then((s) => s.isDirectory(), () => false);
    if (!isDir) return "missing";
    const result = await resolve(cwd, getRuleSources());
    if (result.truncated) deps.onTruncated?.(cwd);
    return result;
  };

  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/folder/project",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      if (typeof cwd !== "string" || cwd.length === 0 || !isAbsolute(cwd)) {
        reply.code(400);
        return { success: false, error: "cwd must be an absolute path" };
      }

      // Admission first: nothing under `cwd` is touched before this verdict.
      const admission = await admitCwd(cwd, knownCwds, deps.admitOptions);
      if (admission.kind === "indeterminate") {
        reply.code(503).header("Retry-After", "1");
        return {
          error: "cwd-admission-unavailable",
          message: "cwd admission could not be decided right now",
          retryAfterMs: 1000,
        };
      }
      if (admission.kind !== "admit") {
        reply.code(403);
        return {
          success: false,
          error: "cwd not allowed",
          reason: "cwd is not a known session or pinned directory.",
          hint: "Pin this directory to allow it, or open a session rooted in it.",
        };
      }
      // The token is not handed downstream; it must not outlive this request.
      reply.raw.once("close", () => releaseAdmission(admission.token));

      let pending = inFlight.get(cwd);
      if (!pending) {
        pending = run(cwd).finally(() => inFlight.delete(cwd));
        inFlight.set(cwd, pending);
      }
      const result = await pending;
      if (result === "missing") {
        reply.code(404);
        return { success: false, error: "folder not found" };
      }
      return result;
    },
  );
}
