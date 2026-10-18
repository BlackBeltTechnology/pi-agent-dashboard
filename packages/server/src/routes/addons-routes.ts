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
import type { AddonToggleRequest } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { FastifyInstance } from "fastify";
import { readRestoreStore } from "../addons/addon-toggle-restore.js";
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

export function registerAddonsRoutes(fastify: FastifyInstance, routeDeps: AddonsRouteDeps) {
  const { networkGuard, ...rest } = routeDeps;
  const deps: AddonsDeps = { ...rest, log: rest.log ?? fastify.log };
  const log = deps.log;

  // ── Catalog ────────────────────────────────────────────────────────
  fastify.get("/api/addons/catalog", { preHandler: networkGuard }, async (_request, reply) => {
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
      if (typeof body.enabled !== "boolean") {
        return reply.status(400).send({ success: false, error: "body.enabled must be boolean" });
      }
      if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
        return reply.status(400).send({ success: false, error: "body.dryRun must be boolean" });
      }
      if (body.confirmToken !== undefined && typeof body.confirmToken !== "string") {
        return reply.status(400).send({ success: false, error: "body.confirmToken must be string" });
      }
      const enabled = body.enabled;

      try {
        // Dry run: same computation, no locks, no writes.
        if (body.dryRun) {
          const g = await gatherCatalog(deps);
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
                const g = await gatherCatalog(deps);
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
