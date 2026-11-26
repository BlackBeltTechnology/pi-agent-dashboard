/**
 * Google accounts plugin server entry (design D1). Wires the store over `ctx.credentials` (namespace
 * `google`), the connect service, the REST routes, the hub-local `google/lease` + `google/accounts` lanes
 * and the one in-process service `google.connect` (`importLegacyGmail`). Degrades to inactive when the host
 * lacks the credential seam. See change: add-google-connect.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { builtInFor, createSwitchReader } from "../shared/default-clients.js";
import { resolveGoogleEndpoints } from "../shared/endpoints.js";
import { ACCOUNTS_TYPE, CONNECT_SERVICE, LEASE_TYPE } from "../shared/protocol.js";
import type { ClientDeps } from "./clients.js";
import { ConnectService } from "./connect.js";
import { createLegacyImporter } from "./import.js";
import { createLeaseHandler } from "./lease.js";
import { PendingFlows } from "./pending-flows.js";
import { mountGoogleRoutes } from "./routes.js";
import { BROWSER_DEDICATED_SERVICE, type DedicatedBrowserService } from "./setup/browser-service.js";
import { GoogleStore, summarize } from "./store.js";

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  if (!ctx.credentials) {
    ctx.logger.warn("[google] host has no plugin credential store; plugin inactive");
    return;
  }
  const endpoints = resolveGoogleEndpoints(process.env, (m) => ctx.logger.warn(m));
  const store = new GoogleStore(ctx.credentials);
  const clients: ClientDeps = {
    store,
    builtIn: builtInFor(process.env, endpoints.overridden),
    switches: createSwitchReader(process.env, (m) => ctx.logger.warn(m)),
  };
  const pending = new PendingFlows();
  // Optional host seam (`auth.redirectBaseUrl` → tunnel → localhost); absent → web/return paths refuse.
  const dashboardBase = () => ctx.getDashboardBaseUrl?.();
  const connect = new ConnectService({ store, clients, endpoints, oauth: ctx.oauth, logger: ctx.logger, pending, dashboardBase });
  const lease = createLeaseHandler({ store, clients, endpoints, logger: ctx.logger });

  // Hub-local only: `google/lease` returns a live OAuth access token and `google/accounts` lists identities;
  // the host refuses both (`origin_denied`) for a remote-origin session. See change: harden-bridge-session-claim.
  ctx.registerPiRequestHandler?.(LEASE_TYPE, lease, { hubLocalOnly: true });
  ctx.registerPiRequestHandler?.(ACCOUNTS_TYPE, async () => (await store.list()).map(summarize), { hubLocalOnly: true });
  ctx.provide?.(CONNECT_SERVICE, createLegacyImporter({ store, logger: ctx.logger }));

  await mountGoogleRoutes(ctx.fastify, {
    store,
    clients,
    connect,
    networkGuard: ctx.networkGuard,
    logger: ctx.logger,
    dashboardBase,
    // No `dependsOn` on the browser plugin (hard + it ships disabled): look the service up per request.
    getBrowserService: () => ctx.consume<DedicatedBrowserService>(BROWSER_DEDICATED_SERVICE),
    leaseToken: async (account) => {
      const r = await lease({ account, product: "drive" });
      return { accessToken: r.accessToken, expiresAt: r.expiresAt };
    },
  });
}
