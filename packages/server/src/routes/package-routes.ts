/**
 * REST routes for pi package management: search, readme, installed, install, remove, update, check-updates.
 */

import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import {
  attachPublishedVariants,
  enrichInstalledRows,
  resolvePublishedVariant,
} from "../package/installed-package-enricher.js";
import { fetchPackageMeta, fetchReadme, PackageNotFoundError, searchPackages } from "../package/npm-search-proxy.js";
import type { PackageEntry, PackageManagerWrapper } from "../package/package-manager-wrapper.js";
import {
  AlreadyAtDestinationError,
  InvalidMoveRequestError,
  InvalidResetRequestError,
  PackageOperationBusyError,
  UnsupportedSourceForDestinationError,
} from "../package/package-manager-wrapper.js";
import { parseSourceKind } from "../package/package-source-helpers.js";

/** npm-name lookup used for published-variant resolution. Cached in npm-search-proxy. */
const lookupNpm = (name: string) => fetchPackageMeta(name);

export function registerPackageRoutes(
  fastify: FastifyInstance,
  deps: {
    packageManagerWrapper: PackageManagerWrapper;
  },
) {
  const { packageManagerWrapper } = deps;

  // ── Search npm packages ─────────────────────────────────────────

  fastify.get<{ Querystring: { q?: string; type?: string } }>(
    "/api/packages/search",
    async (request) => {
      const { q, type } = request.query;
      try {
        const result = await searchPackages({ query: q, type });
        return { success: true, data: result } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, error: err.message } satisfies ApiResponse;
      }
    },
  );

  // ── Fetch package README ────────────────────────────────────────

  fastify.get<{ Querystring: { pkg: string } }>(
    "/api/packages/readme",
    async (request, reply) => {
      const { pkg } = request.query;
      if (!pkg) {
        reply.code(400);
        return { success: false, error: "pkg parameter required" } satisfies ApiResponse;
      }
      try {
        const result = await fetchReadme(pkg);
        return { success: true, data: result } satisfies ApiResponse;
      } catch (err: any) {
        if (err instanceof PackageNotFoundError) {
          reply.code(404);
          return { success: false, error: err.message } satisfies ApiResponse;
        }
        return { success: false, error: err.message } satisfies ApiResponse;
      }
    },
  );

  // ── List installed packages ─────────────────────────────────────

  fastify.get<{ Querystring: { scope?: string; cwd?: string } }>(
    "/api/packages/installed",
    async (request) => {
      const scope = request.query.scope === "local" ? "local" : "global";
      const cwd = request.query.cwd;
      try {
        const packages = await packageManagerWrapper.listInstalled(scope, cwd);
        const enriched = enrichInstalledRows(packages as any);
        // Attach publishedVariantSource/Version for local/git rows with a
        // resolvable published variant (recommended → offline; non-recommended
        // → cached npm lookup). Never blocks the list. See change: reset-override-to-npm.
        await attachPublishedVariants(enriched, { lookupNpm });
        return { success: true, data: enriched } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, error: err.message } satisfies ApiResponse;
      }
    },
  );

  // ── Install package ─────────────────────────────────────────────

  fastify.post<{ Body: { source: string; scope: string; cwd?: string } }>(
    "/api/packages/install",
    async (request, reply) => {
      const { source, scope, cwd } = request.body ?? {};
      if (!source) {
        reply.code(400);
        return { success: false, error: "source is required" } satisfies ApiResponse;
      }
      const effectiveScope = scope === "local" ? "local" as const : "global" as const;
      try {
        const operationId = await packageManagerWrapper.run({
          action: "install",
          source,
          scope: effectiveScope,
          cwd,
        });
        reply.code(202);
        return { success: true, data: { operationId } } satisfies ApiResponse;
      } catch (err: any) {
        if (err instanceof PackageOperationBusyError) {
          reply.code(409);
          return { success: false, error: err.message } satisfies ApiResponse;
        }
        return { success: false, error: err.message } satisfies ApiResponse;
      }
    },
  );

  // ── Remove package ──────────────────────────────────────────────

  fastify.post<{ Body: { source: string; scope: string; cwd?: string } }>(
    "/api/packages/remove",
    async (request, reply) => {
      const { source, scope, cwd } = request.body ?? {};
      if (!source) {
        reply.code(400);
        return { success: false, error: "source is required" } satisfies ApiResponse;
      }
      const effectiveScope = scope === "local" ? "local" as const : "global" as const;
      try {
        const operationId = await packageManagerWrapper.run({
          action: "remove",
          source,
          scope: effectiveScope,
          cwd,
        });
        reply.code(202);
        return { success: true, data: { operationId } } satisfies ApiResponse;
      } catch (err: any) {
        if (err instanceof PackageOperationBusyError) {
          reply.code(409);
          return { success: false, error: err.message } satisfies ApiResponse;
        }
        return { success: false, error: err.message } satisfies ApiResponse;
      }
    },
  );

  // ── Update packages ─────────────────────────────────────────────

  fastify.post<{ Body: { source?: string; scope: string; cwd?: string } }>(
    "/api/packages/update",
    async (request, reply) => {
      const { source, scope, cwd } = request.body ?? {};
      const effectiveScope = scope === "local" ? "local" as const : "global" as const;
      try {
        const operationId = await packageManagerWrapper.run({
          action: "update",
          source: source ?? "",
          scope: effectiveScope,
          cwd,
        });
        reply.code(202);
        return { success: true, data: { operationId } } satisfies ApiResponse;
      } catch (err: any) {
        if (err instanceof PackageOperationBusyError) {
          reply.code(409);
          return { success: false, error: err.message } satisfies ApiResponse;
        }
        return { success: false, error: err.message } satisfies ApiResponse;
      }
    },
  );

  // ── Check for updates ───────────────────────────────────────────

  // Move package between scopes (see change: unify-package-management-ui)
  fastify.post<{
    Body: {
      entry?: PackageEntry;
      fromScope?: string;
      fromCwd?: string;
      toScope?: string;
      toCwd?: string;
    };
  }>("/api/packages/move", async (request, reply) => {
    const body = request.body ?? {};
    const { entry, fromCwd, toCwd } = body;
    const fromScope = body.fromScope === "local" ? "local" : body.fromScope === "global" ? "global" : null;
    const toScope = body.toScope === "local" ? "local" : body.toScope === "global" ? "global" : null;

    if (!entry || (typeof entry !== "string" && (typeof entry !== "object" || !entry.source))) {
      reply.code(400);
      return { success: false, error: "entry is required (string or { source, ...filters })" } satisfies ApiResponse;
    }
    if (!fromScope || !toScope) {
      reply.code(400);
      return { success: false, error: "fromScope and toScope are required ('global' or 'local')" } satisfies ApiResponse;
    }

    try {
      const moveId = await packageManagerWrapper.move({
        entry: entry as PackageEntry,
        fromScope,
        fromCwd,
        toScope,
        toCwd,
      });
      const sourceStr = typeof entry === "string" ? entry : entry.source;
      const kind = parseSourceKind(sourceStr);
      const phases = kind === "abs-path" || kind === "rel-path"
        ? ["settings-edit" as const]
        : ["install" as const, "remove" as const];
      reply.code(202);
      return { success: true, data: { moveId, phases } } satisfies ApiResponse;
    } catch (err: any) {
      if (err instanceof InvalidMoveRequestError) {
        reply.code(400);
        return { success: false, error: err.message, code: "invalid_request" } as any;
      }
      if (err instanceof UnsupportedSourceForDestinationError) {
        reply.code(400);
        return { success: false, error: err.message, code: "unsupported_source_for_destination" } as any;
      }
      if (err instanceof AlreadyAtDestinationError) {
        reply.code(409);
        return { success: false, error: err.message, code: "already_at_destination" } as any;
      }
      if (err instanceof PackageOperationBusyError) {
        reply.code(409);
        return { success: false, error: err.message, code: "operation_in_flight" } as any;
      }
      reply.code(500);
      return { success: false, error: err?.message ?? String(err) } satisfies ApiResponse;
    }
  });

  // Reset a source-override package back to its published npm/git variant
  // (see change: reset-override-to-npm). Install-first / remove-second, atomic.
  fastify.post<{ Body: { source?: string; scope?: string; cwd?: string } }>(
    "/api/packages/reset-to-npm",
    async (request, reply) => {
      const { source, cwd } = request.body ?? {};
      const scope = request.body?.scope === "local" ? "local" as const : "global" as const;
      if (!source) {
        reply.code(400);
        return { success: false, error: "source is required" } satisfies ApiResponse;
      }
      // Authoritative server-side resolution: find the installed row and
      // resolve its published variant. Never trust a client-supplied target.
      try {
        const packages = await packageManagerWrapper.listInstalled(scope, cwd);
        const enriched = enrichInstalledRows(packages as any);
        const row = enriched.find((p) => p.source === source);
        if (!row) {
          reply.code(400);
          return { success: false, error: `source is not installed in ${scope} scope` } satisfies ApiResponse;
        }
        const variant = await resolvePublishedVariant(row, { lookupNpm });
        if (!variant) {
          reply.code(400);
          return { success: false, error: "no published variant resolves for this source" } satisfies ApiResponse;
        }
        const resetId = await packageManagerWrapper.reset({
          source,
          publishedSource: variant.source,
          scope,
          cwd,
        });
        reply.code(202);
        return {
          success: true,
          data: { resetId, publishedSource: variant.source, phases: ["install", "remove"] as const },
        } satisfies ApiResponse;
      } catch (err: any) {
        if (err instanceof InvalidResetRequestError) {
          reply.code(400);
          return { success: false, error: err.message, code: "invalid_request" } as any;
        }
        if (err instanceof PackageOperationBusyError) {
          reply.code(409);
          return { success: false, error: err.message, code: "operation_in_flight" } as any;
        }
        reply.code(500);
        return { success: false, error: err?.message ?? String(err) } satisfies ApiResponse;
      }
    },
  );

  fastify.post<{ Body: { cwd?: string } }>(
    "/api/packages/check-updates",
    async (request) => {
      const { cwd } = request.body ?? {};
      try {
        const updates = await packageManagerWrapper.checkUpdates(cwd);
        return { success: true, data: updates } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, error: err.message } satisfies ApiResponse;
      }
    },
  );
}
