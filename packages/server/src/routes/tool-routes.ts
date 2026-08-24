/**
 * REST routes for the tool registry.
 *
 *   GET    /api/tools                → list all resolutions
 *   GET    /api/tools/:name          → single resolution
 *   POST   /api/tools/rescan         → invalidate + refresh (all or one)
 *   PUT    /api/tools/:name          → set override path
 *   DELETE /api/tools/:name          → clear override
 *   POST   /api/tools/diagnostics    → text/plain export
 *
 * Every route is guarded by the same network guard used by /api/config.
 *
 * See change: consolidate-tool-resolution (specs/tool-settings-ui).
 */

import {
  isPiOverrideTool,
  validatePiOverridePath,
} from "@blackbelt-technology/pi-dashboard-shared/pi-installs/index.js";
import type {
  Resolution,
  ToolListEntry,
  ToolRegistry,
} from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { UnknownToolError } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import type { NetworkGuard } from "./route-deps.js";

export interface ToolRoutesDeps {
  registry: ToolRegistry;
  networkGuard: NetworkGuard;
}

/**
 * Format a plain-text diagnostics export. One tool per block, one line
 * per attempted strategy. Used by the Settings panel's "Export diagnostics"
 * action and by bug-report attachments.
 */
export function formatDiagnostics(tools: Resolution[]): string {
  const lines: string[] = [];
  lines.push(`# pi-dashboard tool diagnostics — ${new Date().toISOString()}`);
  lines.push("");
  for (const t of tools) {
    const header = t.ok
      ? `[ok]    ${t.name} (${t.source}) → ${t.path}`
      : `[miss]  ${t.name} → not found`;
    lines.push(header);
    for (const entry of t.tried) {
      lines.push(`          - ${entry.strategy}: ${entry.result}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function registerToolRoutes(
  fastify: FastifyInstance,
  { registry, networkGuard }: ToolRoutesDeps,
): void {
  // ── GET /api/tools ─────────────────────────────────────────────────
  fastify.get(
    "/api/tools",
    { preHandler: networkGuard },
    async () => {
      // `list()` rows carry each tool's static `installHints` (when
      // declared) so the Settings → Tools UI can render an `[Install ▾]`
      // dropdown on missing rows. See change:
      // register-bash-and-tool-install-help.
      return { success: true, data: { tools: registry.list() } } satisfies ApiResponse<{
        tools: ToolListEntry[];
      }>;
    },
  );

  // ── GET /api/tools/:name ───────────────────────────────────────────
  fastify.get<{ Params: { name: string } }>(
    "/api/tools/:name",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { name } = request.params;
      if (!registry.has(name)) {
        reply.status(404);
        return { success: false, error: `Unknown tool: ${name}` } satisfies ApiResponse;
      }
      return { success: true, data: registry.resolve(name) } satisfies ApiResponse<Resolution>;
    },
  );

  // ── POST /api/tools/rescan ─────────────────────────────────────────
  fastify.post<{ Body: { name?: string } }>(
    "/api/tools/rescan",
    { preHandler: networkGuard },
    async (request, reply) => {
      const name = request.body?.name;
      if (name !== undefined) {
        if (!registry.has(name)) {
          reply.status(404);
          return { success: false, error: `Unknown tool: ${name}` } satisfies ApiResponse;
        }
        registry.rescan(name);
      } else {
        registry.rescan();
      }
      return { success: true, data: { tools: registry.list() } } satisfies ApiResponse<{
        tools: ToolListEntry[];
      }>;
    },
  );

  // ── PUT /api/tools/:name ───────────────────────────────────────────
  fastify.put<{ Params: { name: string }; Body: { path?: string } }>(
    "/api/tools/:name",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { name } = request.params;
      const overridePath = request.body?.path;
      if (typeof overridePath !== "string" || !overridePath.trim()) {
        reply.status(400);
        return { success: false, error: "body.path is required (non-empty string)" } satisfies ApiResponse;
      }
      // The two pi consumers validate at the WRITE boundary: an override
      // becomes an executed binary / an imported module, and
      // `overrideStrategy` only checks `exists(p)`. A directory is illegal
      // for both (EACCES on spawn, ERR_UNSUPPORTED_DIR_IMPORT on import).
      // Only `pi` and `pi-coding-agent` adopt this, so no other tool's
      // override behaviour changes.
      // See change: select-pi-runtime-install (design D6).
      //
      // The persisted value is the validator's REALPATH'd path, matching what
      // `POST /api/pi/runtime` writes. Two write paths normalizing the same file
      // differently is the class of drift this change exists to remove, and the
      // sync/divergence predicates compare realpath'd directories anyway.
      let toPersist = overridePath.trim();
      if (isPiOverrideTool(name)) {
        const check = validatePiOverridePath(toPersist);
        if (!check.ok) {
          reply.status(400);
          return {
            success: false,
            error: `${check.reason} (failed check: ${check.failedCheck})`,
          } satisfies ApiResponse;
        }
        toPersist = check.resolvedPath ?? toPersist;
      }
      try {
        registry.setOverride(name, toPersist);
      } catch (err) {
        if (err instanceof UnknownToolError) {
          reply.status(404);
          return { success: false, error: err.message } satisfies ApiResponse;
        }
        throw err;
      }
      return { success: true, data: registry.resolve(name) } satisfies ApiResponse<Resolution>;
    },
  );

  // ── DELETE /api/tools/:name ────────────────────────────────────────
  fastify.delete<{ Params: { name: string } }>(
    "/api/tools/:name",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { name } = request.params;
      try {
        registry.clearOverride(name);
      } catch (err) {
        if (err instanceof UnknownToolError) {
          reply.status(404);
          return { success: false, error: err.message } satisfies ApiResponse;
        }
        throw err;
      }
      return { success: true, data: registry.resolve(name) } satisfies ApiResponse<Resolution>;
    },
  );

  // ── POST /api/tools/diagnostics ────────────────────────────────────
  fastify.post(
    "/api/tools/diagnostics",
    { preHandler: networkGuard },
    async (_request, reply) => {
      reply.type("text/plain; charset=utf-8");
      return formatDiagnostics(registry.list());
    },
  );
}
