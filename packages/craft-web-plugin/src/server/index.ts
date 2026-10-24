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
import fs from "node:fs";
import path from "node:path";
import { getAppMountRegistry, type ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { provisionWeb } from "@blackbelt-technology/pi-dashboard-craft-apps/provision.js";
import { caseInsensitiveFilesystem } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import { CRAFT_APP_PROFILES, profileFor } from "../shared/app-profiles.js";
import { CONTROL_CLAIM, CONTROL_GONE, CONTROL_REQUEST, CONTROL_RESULT } from "../shared/control-protocol.js";
import { FAKECRAFT_APP_ID, FAKECRAFT_VERSION } from "../shared/fixture-profile.js";
import { CLAIMED_APPS, mountId } from "./apps.js";
import { appEnabled, type CraftWebConfig, liveControlEnabled } from "./config.js";
import { createControlRouter } from "./control-router.js";
import { buildCsp, publicOrigin } from "./csp.js";
import { fixtureEnabled, prepareFakecraft } from "./fixture.js";
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
        ...(profileFor(app)?.extraAssetTypes ? { extraTypes: profileFor(app)?.extraAssetTypes } : {}),
      });
    } catch (err) {
      ctx.logger.warn(`serveApp(${mountId(app)}) failed; ${app} stays unavailable until restart`, err);
    }
    for (const claim of profileFor(app)?.claims ?? []) {
      if (claim.mode !== "edit") continue;
      ctx.registerFileValidator({ claimId: claim.id, module: VALIDATOR_MODULE, enabled: () => appEnabled(getConfig(), app) });
    }
  }

  // Live-control test double (design D8): mount + status exist ONLY under PI_DASHBOARD_FIXTURE_PLUGINS=1.
  const fixture = fixtureEnabled();
  if (fixture) {
    try {
      ctx.serveApp({
        appId: mountId(FAKECRAFT_APP_ID),
        dir: await prepareFakecraft(ctx.dataDir),
        csp: (request) => buildCsp(publicOrigin(request.headers), FAKECRAFT_APP_ID),
        crossOriginFrame: true,
      });
    } catch (err) {
      ctx.logger.warn("fakecraft fixture failed to mount", err);
    }
  }

  const service = createCraftWebService({
    dataDir: ctx.dataDir,
    ...(fixture ? { fixtureApps: [{ app: FAKECRAFT_APP_ID, version: FAKECRAFT_VERSION }] } : {}),
    logger: ctx.logger,
    getConfig,
    provisionWeb,
    isMounted: (app) => getAppMountRegistry().has(mountId(app)),
  });
  registerCraftWebRoutes(ctx.fastify, service);
  registerLiveControl(ctx, getConfig, service, fixture);
}

/** Extension (lower-case, dotted) → app id, from the profiles' claims; telemetry label only. */
const APP_BY_EXT = new Map<string, string>([
  ...CRAFT_APP_PROFILES.flatMap((p) => p.claims.flatMap((c) => c.extensions.map((e) => [e, p.appId] as const))),
  [".fakecraft", FAKECRAFT_APP_ID],
]);

/**
 * Live agent control (add-craft-live-control): the bridge → server request lane `craft-web/control` plus the
 * browser claim / result / gone handlers of the router. Optional seams (`registerPiRequestHandler`,
 * `registerBrowserHandler`) are absent on older hosts: then the tool answers `no_handler` / `unavailable`.
 */
function registerLiveControl(ctx: ServerPluginContext, getConfig: () => CraftWebConfig | undefined, service: ReturnType<typeof createCraftWebService>, fixture: boolean): void {
  const router = createControlRouter({
    broadcast: (msg) => ctx.broadcastToSubscribers?.(msg),
    sessionCwd: (id) => {
      const s = ctx.sessionManager?.getSession(id) as { cwd?: unknown } | undefined;
      return typeof s?.cwd === "string" && s.cwd.length > 0 ? s.cwd : undefined;
    },
    liveControlEnabled: () => liveControlEnabled(getConfig()),
    realpath: (p) => {
      try {
        return fs.realpathSync(p);
      } catch {
        return undefined;
      }
    },
    caseInsensitive: caseInsensitiveFilesystem(),
    appForPath: (p) => APP_BY_EXT.get(path.extname(p).toLowerCase()),
    telemetry: (app, outcome, ms) => {
      service.reportTelemetry(app, { kind: "control", outcome, ms });
    },
    log: ctx.logger,
  });
  ctx.registerPiRequestHandler?.(CONTROL_REQUEST, (payload, meta) => router.request(payload, meta));
  // Injected test contexts and older hosts may lack the browser seam: then nothing can claim, and the tool says so.
  ctx.registerBrowserHandler?.(CONTROL_CLAIM, (msg, ws) => router.onClaim(msg, ws));
  ctx.registerBrowserHandler?.(CONTROL_RESULT, (msg, ws) => router.onResult(msg, ws));
  ctx.registerBrowserHandler?.(CONTROL_GONE, (msg, ws) => router.onGone(msg, ws));

  // Test-only driver of the `craft_control` lane for the browser E2E (no pi session / model needed): the
  // fixture flag gates it; it is unlisted in the REST route tiers (`route-tiers.ts`: unlisted ⇒ `operate`), and the fixture flag is the boundary. Never in production.
  if (fixture) {
    ctx.fastify.post<{ Body: { sessionId?: unknown } & Record<string, unknown> }>("/api/plugins/craft-web/fixture/control", async (request, reply) => {
      const { sessionId, ...payload } = request.body ?? {};
      if (typeof sessionId !== "string" || sessionId.length === 0) return reply.code(400).send({ ok: false, code: "denied", message: "sessionId required" });
      // A request can wait up to ~13 s for its answer while the server drops a socket idle for 10 s: keep it
      // alive with blank JSON whitespace. (A real pi session reaches the router over its own socket instead.)
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, { "content-type": "application/json" });
      const beat = setInterval(() => raw.write(" "), 2_000);
      try {
        raw.end(JSON.stringify(await router.request(payload, { sessionId })));
      } finally {
        clearInterval(beat);
      }
    });
  }
}
