/**
 * REST routes for pi package management: search, readme, installed, install, remove, update, check-updates.
 */

import {
  listManagedBridges,
  listManagedPackageOwnership,
} from "@blackbelt-technology/pi-dashboard-shared/plugin-bridge-register.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import { admitOptionalCwd, sendCwdFailure } from "../lib/file-cwd-admission.js";
import type { RouteAdmissionDeps } from "../lib/route-admission.js";
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

/** Paths the dashboard recorded as its own bridges (either record suffices).
 * Never throws: an unreadable registry means nothing is flagged.
 * See change: addons-hub-declutter. */
function readManagedPaths(fastify: FastifyInstance): string[] {
  try {
    return [
      ...new Set([
        ...Object.values(listManagedBridges()),
        ...Object.keys(listManagedPackageOwnership()),
      ]),
    ];
  } catch (err: any) {
    fastify.log.warn(`[packages] could not read the dashboard bridge registry: ${err?.message ?? err}`);
    return [];
  }
}

export function registerPackageRoutes(
  fastify: FastifyInstance,
  deps: {
    packageManagerWrapper: PackageManagerWrapper;
    /**
     * Shared cwd admission (change: core-file-cwd-admission): a supplied `cwd` must be admitted;
     * no `cwd` keeps today's fallback. Absent → fail-closed (nothing is known).
     */
    routeAdmission?: RouteAdmissionDeps;
  },
) {
  const { packageManagerWrapper } = deps;
  const routeAdmission: RouteAdmissionDeps = deps.routeAdmission ?? {};

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
    async (request, reply) => {
      const scope = request.query.scope === "local" ? "local" : "global";
      const admitted = await admitOptionalCwd(request.query.cwd, routeAdmission, reply);
      if (!admitted.ok) return sendCwdFailure(reply, admitted.failure);
      const cwd = admitted.cwd;
      try {
        const packages = await packageManagerWrapper.listInstalled(scope, cwd);
        const managedPaths = scope === "global" ? readManagedPaths(fastify) : undefined;
        const enriched = enrichInstalledRows(packages as any, undefined, { managedPaths });
        if (managedPaths && managedPaths.length > 0 && !enriched.some((r) => r.dashboardManaged)) {
          fastify.log.warn(
            `[packages] dashboard bridge registry lists ${managedPaths.length} path(s) but none matches an installed row (settings file divergence?)`,
          );
        }
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
      const { source, scope } = request.body ?? {};
      if (!source) {
        reply.code(400);
        return { success: false, error: "source is required" } satisfies ApiResponse;
      }
      const effectiveScope = scope === "local" ? "local" as const : "global" as const;
      const admitted = await admitOptionalCwd(request.body?.cwd, routeAdmission, reply);
      if (!admitted.ok) return sendCwdFailure(reply, admitted.failure);
      const cwd = admitted.cwd;
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
      const { source, scope } = request.body ?? {};
      if (!source) {
        reply.code(400);
        return { success: false, error: "source is required" } satisfies ApiResponse;
      }
      const effectiveScope = scope === "local" ? "local" as const : "global" as const;
      const admitted = await admitOptionalCwd(request.body?.cwd, routeAdmission, reply);
      if (!admitted.ok) return sendCwdFailure(reply, admitted.failure);
      const cwd = admitted.cwd;
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
      const { source, scope } = request.body ?? {};
      const effectiveScope = scope === "local" ? "local" as const : "global" as const;
      const admitted = await admitOptionalCwd(request.body?.cwd, routeAdmission, reply);
      if (!admitted.ok) return sendCwdFailure(reply, admitted.failure);
      const cwd = admitted.cwd;
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
    const { entry } = body;
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

    // A local scope needs a string cwd: the wrapper's own check, run up front so a non-string value
    // answers `invalid_request` instead of reaching admission (core-file-cwd-admission D1).
    for (const [scopeValue, cwdValue, label] of [
      [fromScope, body.fromCwd, "fromCwd"],
      [toScope, body.toCwd, "toCwd"],
    ] as const) {
      if (scopeValue === "local" && (typeof cwdValue !== "string" || !cwdValue)) {
        reply.code(400);
        return { success: false, error: `${label} required when ${label.slice(0, -3)}Scope is local`, code: "invalid_request" } as any;
      }
    }
    // Both sides are admitted; a refusal beats an undecidable side.
    const from = await admitOptionalCwd(body.fromCwd, routeAdmission, reply);
    const to = await admitOptionalCwd(body.toCwd, routeAdmission, reply);
    const failed = [from, to].flatMap((a) => (a.ok ? [] : [a.failure]));
    if (failed.length > 0) return sendCwdFailure(reply, failed.find((f) => f.code !== 503) ?? failed[0]);
    const fromCwd = from.ok ? from.cwd : undefined;
    const toCwd = to.ok ? to.cwd : undefined;

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
      const { source } = request.body ?? {};
      const scope = request.body?.scope === "local" ? "local" as const : "global" as const;
      if (!source) {
        reply.code(400);
        return { success: false, error: "source is required" } satisfies ApiResponse;
      }
      // Local scope needs a string cwd (the wrapper's own check, run up front; see `move`).
      const rawCwd: unknown = request.body?.cwd;
      if (scope === "local" && (typeof rawCwd !== "string" || !rawCwd)) {
        reply.code(400);
        return { success: false, error: "cwd required when scope is local", code: "invalid_request" } as any;
      }
      const admitted = await admitOptionalCwd(rawCwd, routeAdmission, reply);
      if (!admitted.ok) return sendCwdFailure(reply, admitted.failure);
      const cwd = admitted.cwd;
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
    async (request, reply) => {
      const admitted = await admitOptionalCwd(request.body?.cwd, routeAdmission, reply);
      if (!admitted.ok) return sendCwdFailure(reply, admitted.failure);
      try {
        const updates = await packageManagerWrapper.checkUpdates(admitted.cwd);
        return { success: true, data: updates } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, error: err.message } satisfies ApiResponse;
      }
    },
  );
}
