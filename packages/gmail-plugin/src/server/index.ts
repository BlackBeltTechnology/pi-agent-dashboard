/**
 * Gmail plugin server entry (design D1). Wires the account store over
 * `ctx.credentials` (namespace `gmail`), the REST routes and the
 * `gmail/lease` request handler. Degrades to a 501 route set when the host
 * lacks the credential/OAuth seams. See change: add-gmail-plugin.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { resolveGoogleEndpoints } from "../shared/endpoints.js";
import { ACCOUNTS_TYPE, LEASE_TYPE } from "../shared/protocol.js";
import { AccountStore, summarize } from "./accounts.js";
import { createLeaseHandler } from "./lease.js";
import { mountGmailRoutes } from "./routes.js";
import { BROWSER_DEDICATED_SERVICE, type DedicatedBrowserService } from "./setup/browser-service.js";

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  if (!ctx.credentials) {
    ctx.logger.warn("[gmail] host has no plugin credential store; plugin inactive");
    return;
  }
  const endpoints = resolveGoogleEndpoints(process.env, (m) => ctx.logger.warn(m));
  const store = new AccountStore(ctx.credentials);
  // Both handlers are hub-local-only: `gmail/lease` returns a live OAuth access token and
  // `gmail/accounts` lists mailbox identities. The host refuses them (`origin_denied`) for a
  // remote-origin session or a deprecated admission. See change: harden-bridge-session-claim (D3).
  ctx.registerPiRequestHandler?.(LEASE_TYPE, createLeaseHandler({ store, endpoints, logger: ctx.logger }), {
    hubLocalOnly: true,
  });
  // Secret-free account list for `gmail_accounts` and account-required errors.
  ctx.registerPiRequestHandler?.(ACCOUNTS_TYPE, async () => (await store.list()).map(summarize), {
    hubLocalOnly: true,
  });
  await mountGmailRoutes(ctx.fastify, {
    store,
    oauth: ctx.oauth,
    endpoints,
    networkGuard: ctx.networkGuard,
    logger: ctx.logger,
    // No `dependsOn` on the browser plugin (hard + it ships disabled): look the service up per request.
    getBrowserService: () => ctx.consume<DedicatedBrowserService>(BROWSER_DEDICATED_SERVICE),
    config: {
      get: () => ctx.getPluginConfig<Record<string, unknown>>(),
      update: (partial) => ctx.updatePluginConfig(partial),
    },
  });
}
