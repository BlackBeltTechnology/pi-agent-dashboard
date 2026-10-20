/**
 * craft-web-plugin · SERVER entry. Composition root: for every claimed app it
 *  - mounts the prepared web build via `ctx.serveApp` (`/apps/craft-<app>/`, per-request CSP,
 *    cross-origin-frame headers; a missing build answers 503 and a static GET never provisions),
 *  - registers the format-validator dispatcher (`validators/index.mjs`) for each of the app's EDIT claims with
 *    the live per-app enable switch (claim ids map to app ids; preview claims never write),
 * then mounts `status` / `prepare/:app` / `csp-report`.
 *
 * Opt-in plugin (`defaultEnabled: false`). The mount is restart-effective: after a live enable the
 * status route may be absent (404 → the client says "restart required").
 *
 * See change: edit-office-in-pane-with-craft-web (D1–D3, D5; tasks 4.1–4.5), extend-craft-web-to-all-apps (D1, D7).
 */
import path from "node:path";
import { getAppMountRegistry, type ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { provisionWeb } from "@blackbelt-technology/pi-dashboard-craft-apps/provision.js";
import { profileFor } from "../shared/app-profiles.js";
import { CLAIMED_APPS, mountId } from "./apps.js";
import { appEnabled, type CraftWebConfig } from "./config.js";
import { buildCsp, publicOrigin } from "./csp.js";
import { registerCraftWebRoutes } from "./routes.js";
import { createCraftWebService } from "./service.js";

/** Package-relative path of the worker-run format-validator dispatcher (routes on extension, D7). */
export const VALIDATOR_MODULE = "./src/server/validators/index.mjs";

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const getConfig = () => ctx.getPluginConfig<CraftWebConfig>();

  for (const app of CLAIMED_APPS) {
    try {
      ctx.serveApp({
        appId: mountId(app),
        dir: path.join(ctx.dataDir, `${app}-web`, "current"),
        csp: (request) => buildCsp(publicOrigin(request.headers), app),
        crossOriginFrame: true,
      });
    } catch (err) {
      ctx.logger.warn(`serveApp(${mountId(app)}) failed; ${app} stays unavailable until restart`, err);
    }
    for (const claim of profileFor(app)?.claims ?? []) {
      if (claim.mode !== "edit") continue;
      ctx.registerFileValidator({ claimId: claim.id, module: VALIDATOR_MODULE, enabled: () => appEnabled(getConfig(), app) });
    }
  }

  const service = createCraftWebService({
    dataDir: ctx.dataDir,
    logger: ctx.logger,
    getConfig,
    provisionWeb,
    isMounted: (app) => getAppMountRegistry().has(mountId(app)),
  });
  registerCraftWebRoutes(ctx.fastify, service);
}
