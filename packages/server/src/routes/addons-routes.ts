/**
 * Add-ons hub REST routes.
 *
 * GET  /api/addons/catalog              — features joined from installed packages,
 *                                         dashboard plugins, managed bridges and the
 *                                         recommended manifest (pure joiner in
 *                                         `addons/addons-catalog.ts`).
 * POST /api/addons/:featureId/toggle    — one switch per feature: plugin flip + global
 *                                         package entries into/out of the all-empty
 *                                         filter form, with restore records.
 *                                         Body { enabled, dryRun?, confirmToken? }.
 *
 * Locks (outer → inner): hub queue → `PackageManagerWrapper.runExclusive` (409 busy)
 * → global settings file → plugin config. A dry run takes none and writes nothing.
 *
 * See change: addons-hub-feature-catalog (design D1, D5, D13, D16).
 */
import path from "node:path";
import { admitCwd, releaseAdmission } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import type { AddonToggleRequest } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import { readRestoreStore } from "../addons/addon-toggle-restore.js";
import { folderToggle, gatherFolderCatalog } from "../addons/addons-folder-service.js";
import {
  type AddonsDeps,
  applyToggle,
  gatherCatalog,
  gcRestoreRecords,
  planToggle,
  settingsPathOf,
} from "../addons/addons-service.js";
import { PackageOperationBusyError } from "../package/package-manager-wrapper.js";
import { ADDONS_HUB_LOCK_KEY, PLUGIN_CONFIG_LOCK_KEY, withSettingsWriteLock } from "../pi/settings-write-lock.js";
import type { NetworkGuard } from "./route-deps.js";

export type AddonsRouteDeps = Omit<AddonsDeps, "log"> & {
  networkGuard: NetworkGuard;
  log?: AddonsDeps["log"];
};

/**
 * Folder mode `cwd` rules: absolute + normalised (400), then the shared
 * `admitCwd` guard (503 indeterminate, 403 refused). Returns the admission
 * token to release, or null after the reply was sent.
 */
async function admitFolderCwd(
  deps: AddonsDeps,
  cwd: unknown,
  reply: FastifyReply,
): Promise<{ cwd: string; token: Parameters<typeof releaseAdmission>[0] } | null> {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd) || path.normalize(cwd) !== cwd) {
    reply.status(400).send({ success: false, error: "cwd must be an absolute, normalised path" });
    return null;
  }
  const admission = await admitCwd(cwd, deps.knownCwds ?? deps.knownDirectories, deps.admitOptions);
  if (admission.kind === "indeterminate") {
    reply
      .status(503)
      .header("Retry-After", "1")
      .send({ error: "cwd-admission-unavailable", message: "cwd admission could not be decided right now", retryAfterMs: 1000 });
    return null;
  }
  if (admission.kind !== "admit") {
    reply.status(403).send({
      success: false,
      error: "cwd not allowed",
      reason: "cwd is not a known session or pinned directory.",
      hint: "Pin this directory to allow it, or open a session rooted in it.",
    });
    return null;
  }
  return { cwd, token: admission.token };
}

/** First problem with a toggle body, or null. */
function invalidToggleBody(body: Partial<AddonToggleRequest>): string | null {
  if (body.scope !== undefined && body.scope !== "global" && body.scope !== "local") return "body.scope must be 'local' or 'global'";
  if (typeof body.enabled !== "boolean") return "body.enabled must be boolean";
  if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") return "body.dryRun must be boolean";
  if (body.confirmToken !== undefined && typeof body.confirmToken !== "string") return "body.confirmToken must be string";
  return null;
}

/** `GET /api/addons/catalog?scope=local&cwd=` — a read: auth-gated, never trust-gated. */
async function folderCatalogReply(deps: AddonsDeps, cwd: unknown, reply: FastifyReply) {
  const admitted = await admitFolderCwd(deps, cwd, reply);
  if (!admitted) return reply;
  try {
    const { features, folder } = await gatherFolderCatalog(deps, admitted.cwd);
    return reply.status(200).send({ success: true, features, folder });
  } catch (err) {
    deps.log.error(`[addons] folder catalog failed: ${(err as Error)?.message ?? err}`);
    return reply.status(500).send({ success: false, error: (err as Error)?.message ?? String(err) });
  } finally {
    releaseAdmission(admitted.token);
  }
}

/** `POST /api/addons/:id/toggle` with `scope: "local"`: lock keys = hub queue, then the project settings file. */
async function folderToggleReply(
  deps: AddonsDeps,
  featureId: string,
  enabled: boolean,
  body: Partial<AddonToggleRequest>,
  reply: FastifyReply,
) {
  if (body.dryRun) return reply.status(400).send({ success: false, error: "dryRun is not supported for scope local" });
  if (body.removeUnowned !== undefined && typeof body.removeUnowned !== "boolean") {
    return reply.status(400).send({ success: false, error: "body.removeUnowned must be boolean" });
  }
  const admitted = await admitFolderCwd(deps, body.cwd, reply);
  if (!admitted) return reply;
  try {
    // Same lock key as the folder-scope resource toggle; the hub queue also keeps the
    // restore store's read-modify-write away from the global toggle.
    const projectFile = path.join(admitted.cwd, ".pi", "settings.json");
    const result = await withSettingsWriteLock(ADDONS_HUB_LOCK_KEY, () =>
      withSettingsWriteLock(projectFile, () =>
        folderToggle(deps, { cwd: admitted.cwd, featureId, enabled, removeUnowned: body.removeUnowned === true }),
      ),
    );
    return reply.status(result.status).send(result.body);
  } catch (err) {
    deps.log.error(`[addons] folder toggle ${featureId} failed: ${(err as Error)?.message ?? err}`);
    return reply.status(500).send({ success: false, error: (err as Error)?.message ?? String(err) });
  } finally {
    releaseAdmission(admitted.token);
  }
}

export function registerAddonsRoutes(fastify: FastifyInstance, routeDeps: AddonsRouteDeps) {
  const { networkGuard, ...rest } = routeDeps;
  const deps: AddonsDeps = { ...rest, log: rest.log ?? fastify.log };
  const log = deps.log;

  // ── Catalog ────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { scope?: string; cwd?: string } }>(
    "/api/addons/catalog",
    { preHandler: networkGuard },
    async (request, reply) => {
    const { scope, cwd } = request.query;
    if (scope !== undefined && scope !== "global" && scope !== "local") {
      return reply.status(400).send({ success: false, error: "scope must be 'local' or 'global'" });
    }
    if (scope === "local") return folderCatalogReply(deps, cwd, reply);
    try {
      const gathered = await gatherCatalog(deps);
      // Stale restore records (uninstall / reset / scope move) are dropped here.
      await withSettingsWriteLock(settingsPathOf(deps), async () => gcRestoreRecords(gathered, log));
      return reply.status(200).send({ success: true, features: gathered.features });
    } catch (err) {
      log.error(`[addons] catalog failed: ${(err as Error)?.message ?? err}`);
      return reply.status(500).send({ success: false, error: (err as Error)?.message ?? String(err) });
    }
  });

  // ── Toggle ─────────────────────────────────────────────────────────
  fastify.post<{ Params: { featureId: string }; Body: Partial<AddonToggleRequest> }>(
    "/api/addons/:featureId/toggle",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { featureId } = request.params;
      const body = request.body ?? {};
      const invalid = invalidToggleBody(body);
      if (invalid) return reply.status(400).send({ success: false, error: invalid });
      const enabled = body.enabled === true;

      if (body.scope === "local") return folderToggleReply(deps, featureId, enabled, body, reply);

      try {
        // Dry run: same computation, no locks, no writes.
        if (body.dryRun) {
          const g = await gatherCatalog(deps, { skipRegistry: true });
          const plan = planToggle(deps, g, readRestoreStore(log), featureId, enabled);
          if (!plan.ok) return reply.status(plan.status).send(plan.body);
          return reply
            .status(200)
            .send({ success: true, dryRun: true, ...plan.report, confirmToken: plan.token });
        }

        const result = await withSettingsWriteLock(ADDONS_HUB_LOCK_KEY, () =>
          deps.packageManagerWrapper.runExclusive(() =>
            withSettingsWriteLock(settingsPathOf(deps), () =>
              withSettingsWriteLock(PLUGIN_CONFIG_LOCK_KEY, async () => {
                const g = await gatherCatalog(deps, { skipRegistry: true });
                gcRestoreRecords(g, log);
                const store = readRestoreStore(log);
                const plan = planToggle(deps, g, store, featureId, enabled);
                if (!plan.ok) return { status: plan.status, body: plan.body };
                if (body.confirmToken && body.confirmToken !== plan.token) {
                  return {
                    status: 409,
                    body: { success: false, reason: "stale-confirmation", ...plan.report, confirmToken: plan.token },
                  };
                }
                return applyToggle(deps, g, store, plan);
              }),
            ),
          ),
        );
        return reply.status(result.status).send(result.body);
      } catch (err) {
        if (err instanceof PackageOperationBusyError) {
          return reply.status(409).send({ success: false, reason: "busy", error: err.message });
        }
        log.error(`[addons] toggle ${featureId} failed: ${(err as Error)?.message ?? err}`);
        return reply.status(500).send({ success: false, error: (err as Error)?.message ?? String(err) });
      }
    },
  );
}
